import type { NetworkGeneration, RecoveryContext } from "./contracts.js";

const validGeneration = (g: NetworkGeneration) =>
  Boolean(g.runtimeId) &&
  Number.isSafeInteger(g.networkEpoch) &&
  g.networkEpoch >= 0 &&
  Number.isSafeInteger(g.connectionGeneration) &&
  g.connectionGeneration >= 0;

export function acceptsNetworkProof(
  expected: NetworkGeneration,
  received: NetworkGeneration,
): boolean {
  return (
    validGeneration(expected) &&
    validGeneration(received) &&
    expected.connectionGeneration > 0 &&
    expected.runtimeId === received.runtimeId &&
    expected.networkEpoch === received.networkEpoch &&
    expected.connectionGeneration === received.connectionGeneration
  );
}

export function remainingRecoveryMs(
  deadlineMonoMs: number,
  nowMonoMs: number,
): number {
  if (!Number.isFinite(deadlineMonoMs) || !Number.isFinite(nowMonoMs))
    throw new RangeError("Invalid monotonic clock");
  return Math.max(0, deadlineMonoMs - nowMonoMs);
}

export function advanceNetworkGeneration(
  current: NetworkGeneration,
  previousPath: string,
  nextPath: string,
): NetworkGeneration {
  if (!validGeneration(current))
    throw new RangeError("Invalid network generation");
  if (previousPath === nextPath) return { ...current };
  if (current.networkEpoch === Number.MAX_SAFE_INTEGER)
    throw new RangeError("Network epoch exhausted");
  return {
    runtimeId: current.runtimeId,
    networkEpoch: current.networkEpoch + 1,
    connectionGeneration: 0,
  };
}

export function beginRecovery(
  previous: RecoveryContext | null,
  generation: NetworkGeneration,
  nowMonoMs: number,
  businessCallConnected: boolean,
  mediaHealthy: boolean,
  timeoutMs: number,
  offerDeadlineMonoMs?: number,
): RecoveryContext {
  if (
    !validGeneration(generation) ||
    !Number.isFinite(nowMonoMs) ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 0 ||
    (offerDeadlineMonoMs !== undefined && !Number.isFinite(offerDeadlineMonoMs))
  )
    throw new RangeError("Invalid recovery context");
  if (previous && previous.generation.runtimeId !== generation.runtimeId)
    throw new Error("Cannot reuse a monotonic deadline from another runtime");
  let deadlineMonoMs =
    previous && !previous.mediaHealthy
      ? previous.deadlineMonoMs
      : nowMonoMs + timeoutMs;
  if (!businessCallConnected && offerDeadlineMonoMs !== undefined)
    deadlineMonoMs = Math.min(deadlineMonoMs, offerDeadlineMonoMs);
  return {
    generation: { ...generation },
    deadlineMonoMs,
    businessCallConnected,
    mediaHealthy,
  };
}

export function recoveryEffects(
  context: RecoveryContext,
  nowMonoMs: number,
): Array<"end_call" | "fail_offer"> {
  if (
    context.mediaHealthy ||
    remainingRecoveryMs(context.deadlineMonoMs, nowMonoMs) > 0
  )
    return [];
  return [context.businessCallConnected ? "end_call" : "fail_offer"];
}
