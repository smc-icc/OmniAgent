import { createHash } from "node:crypto";
import {
  dispatchMobileJob,
  type MobileExecutionPorts,
} from "./push-dispatcher.js";
import { MysqlMobileRepository } from "./repository.js";

function ackId(jobId: string): string {
  const bytes = createHash("sha256")
    .update("omni-mobile-job-ack:")
    .update(jobId)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export interface MobileWorkerPorts extends MobileExecutionPorts {
  revokeLease?(
    payload: Record<string, unknown>,
    operationId: string,
  ): Promise<void>;
}

/** One bounded unit of work. An app-owned runner must arrange scheduling and shutdown. */
export async function runMobileOutboxOnce(
  repository: MysqlMobileRepository,
  ports: MobileWorkerPorts,
  options: { workerId: string; clock: () => number; claimMs?: number },
): Promise<boolean> {
  const job = await repository.claimOutbox(
    options.workerId,
    options.clock(),
    options.claimMs ?? 15000,
  );
  if (!job) return false;
  try {
    if (job.kind === "revoke_lease") {
      if (!ports.revokeLease) throw new Error("ccs_revocation_not_available");
      await ports.revokeLease(job.payload, job.jobId);
      await repository.settleOutbox(
        job.jobId,
        job.claimToken,
        { status: "completed" },
        options.clock(),
      );
      return true;
    }
    const attempt = job.attemptId
      ? await repository.getAttempt(job.attemptId)
      : null;
    if (!attempt) {
      await repository.settleOutbox(
        job.jobId,
        job.claimToken,
        { status: "suppressed", code: "attempt_not_found" },
        options.clock(),
      );
      return true;
    }
    const result = await dispatchMobileJob(
      job,
      attempt,
      ports,
      options.clock(),
    );
    if (result.trustedEvent) {
      await repository.applyEvent(
        attempt.attemptId,
        {
          eventId: ackId(job.jobId),
          deviceId: attempt.state.deviceId,
          leaseRevision: attempt.state.leaseRevision,
          kind: result.trustedEvent,
        },
        options.clock(),
      );
    }
    const nowMs = options.clock();
    if (result.status === "retryable_failure") {
      const next = nowMs + 500;
      await repository.settleOutbox(
        job.jobId,
        job.claimToken,
        job.attempts < 2 && next < job.deadlineMs
          ? {
              status: "retry",
              nextAttemptAtMs: next,
              code: result.code ?? "provider_retry",
            }
          : {
              status: "failed",
              code: result.code ?? "provider_retry_exhausted",
            },
        nowMs,
      );
    } else {
      const status =
        result.status === "permanent_failure"
          ? "failed"
          : result.status === "provider_accepted" ||
              result.status === "duplicate"
            ? "completed"
            : result.status;
      await repository.settleOutbox(
        job.jobId,
        job.claimToken,
        {
          status,
          code:
            result.status === "provider_accepted"
              ? "provider_accepted"
              : result.code,
          providerMessageId: result.providerMessageId,
        },
        nowMs,
      );
    }
    return true;
  } catch {
    const nowMs = options.clock(),
      next = nowMs + 500;
    // No raw HTTP, SQL, token or credential errors are persisted as diagnostics.
    await repository.settleOutbox(
      job.jobId,
      job.claimToken,
      job.attempts < 2 && next < job.deadlineMs
        ? {
            status: "retry",
            nextAttemptAtMs: next,
            code: "mobile_execution_failed",
          }
        : { status: "failed", code: "mobile_execution_failed" },
      nowMs,
    );
    return true;
  }
}
