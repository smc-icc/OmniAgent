import type {
  CallEvent,
  NativeProvider,
  NativePushProvider,
  PushOutcome,
} from "./contracts.js";
import type { OutboxJob, StoredAttempt } from "./repository.js";

export interface CurrentMobileOffer {
  offerId: string;
  active: boolean;
  leaseId: string;
  leaseRevision: number;
  agentId: number;
  vdnId: number;
}
export interface MobileCcsPort {
  currentOffer(offerId: string): Promise<CurrentMobileOffer | null>;
  action(input: {
    operationId: string;
    offerId: string;
    attemptId: string;
    leaseRevision: number;
    agentId: number;
    vdnId: number;
    action: "prepare_leg" | "accept" | "decline" | "wake_timeout" | "end";
  }): Promise<{ status: "ok" | "stale" }>;
}
export interface MobileExecutionPorts {
  ccs: MobileCcsPort;
  getToken(
    deviceId: string,
  ): Promise<{ provider: NativeProvider; token: string } | null>;
  providers: Partial<Record<NativeProvider, NativePushProvider>>;
  /** Implement via already-active control signaling. Never manufacture a VoIP cancellation push. */
  notifyNative(attempt: StoredAttempt): Promise<void>;
}
export interface DispatchResult {
  status:
    | "completed"
    | "suppressed"
    | "expired"
    | "retryable_failure"
    | "permanent_failure"
    | "provider_accepted"
    | "duplicate";
  code?: string;
  providerMessageId?: string;
  trustedEvent?: CallEvent["kind"];
}

/** Caller must own an unexpired durable job claim. CCS must also deduplicate operationId atomically. */
export async function dispatchMobileJob(
  job: OutboxJob,
  attempt: StoredAttempt,
  ports: MobileExecutionPorts,
  nowMs: number,
): Promise<DispatchResult> {
  if (job.attemptId !== attempt.attemptId)
    throw new Error("job_attempt_mismatch");
  const state = attempt.state;
  if (nowMs >= job.deadlineMs) return { status: "expired" };
  if (job.kind === "end_native") {
    await ports.notifyNative(attempt);
    return { status: "completed" };
  }
  if (job.kind === "fail_offer" && state.connected)
    return { status: "suppressed" };
  if (state.terminal && job.kind !== "fail_offer")
    return { status: "suppressed" };
  if (
    ["push", "prepare_leg"].includes(job.kind) &&
    nowMs >= state.wakeDeadlineMs
  )
    return { status: "expired" };
  const offer = await ports.ccs.currentOffer(attempt.offerId);
  if (
    !offer ||
    !offer.active ||
    offer.offerId !== attempt.offerId ||
    offer.leaseId !== attempt.leaseId ||
    offer.leaseRevision !== state.leaseRevision ||
    offer.agentId !== attempt.context.agentId ||
    offer.vdnId !== attempt.context.vdnId
  )
    return { status: "suppressed" };
  if (job.kind === "push") {
    const target = await ports.getToken(state.deviceId);
    if (!target)
      return { status: "permanent_failure", code: "device_token_missing" };
    const provider = ports.providers[target.provider];
    if (!provider)
      return { status: "permanent_failure", code: "provider_not_enabled" };
    const outcome: PushOutcome = await provider.send(target.token, {
      version: 2,
      attemptId: attempt.attemptId,
      offerId: attempt.offerId,
      callUuid: attempt.offerId,
      eventId: job.jobId,
      expiresAtMs: Math.min(state.expiresAtMs, state.wakeDeadlineMs),
      displayCaller: "",
    });
    return outcome;
  }
  let action: Parameters<MobileCcsPort["action"]>[0]["action"];
  if (job.kind === "prepare_leg") {
    if (!state.sipReady || state.legCreated || state.connected)
      return { status: "suppressed" };
    action = "prepare_leg";
  } else if (job.kind === "authorize_accept") {
    if (
      !state.sipReady ||
      !state.legCreated ||
      !state.acceptRequested ||
      !state.acceptAuthorizationRequested ||
      state.connected
    )
      return { status: "suppressed" };
    action = "accept";
  } else if (job.kind === "fail_offer") {
    action = state.terminal === "declined" ? "decline" : "wake_timeout";
  } else return { status: "permanent_failure", code: "unknown_mobile_job" };
  const result = await ports.ccs.action({
    operationId: job.jobId,
    offerId: attempt.offerId,
    attemptId: attempt.attemptId,
    leaseRevision: state.leaseRevision,
    agentId: attempt.context.agentId,
    vdnId: attempt.context.vdnId,
    action,
  });
  if (result.status !== "ok") return { status: "suppressed" };
  return {
    status: "completed",
    ...(action === "prepare_leg"
      ? { trustedEvent: "leg_created" as const }
      : action === "accept"
        ? { trustedEvent: "accept_authorized" as const }
        : {}),
  };
}
