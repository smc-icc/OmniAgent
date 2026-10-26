import type {
  CallEffect,
  CallEvent,
  MobileAttempt,
  Terminal,
} from "./contracts.js";

/** Pure policy; effects must be durably claimed and executed by the coordinator. */
export function applyCallEvent(
  before: MobileAttempt,
  event: CallEvent,
  nowMs: number,
): {
  state: MobileAttempt;
  effects: CallEffect[];
} {
  if (
    ![nowMs, before.expiresAtMs, before.wakeDeadlineMs].every(Number.isFinite)
  ) {
    throw new RangeError("Call deadlines and clock must be finite");
  }
  const state = { ...before };
  const effects: CallEffect[] = [];
  if (
    state.terminal ||
    event.deviceId !== state.deviceId ||
    event.leaseRevision !== state.leaseRevision
  ) {
    return { state, effects };
  }
  const finish = (terminal: Terminal, failOffer = false) => {
    state.terminal = terminal;
    effects.push("end_native");
    if (failOffer) effects.push("fail_offer");
    return { state, effects };
  };
  // A cancelled caller must never be requeued, even if cancellation is late.
  if (event.kind === "cancel") return finish("cancelled");
  if (event.kind === "end")
    return finish(state.connected ? "ended" : "declined", !state.connected);
  if (!state.connected) {
    if (nowMs >= state.expiresAtMs) return finish("expired", true);
    if (!state.legCreated && nowMs >= state.wakeDeadlineMs)
      return finish("wake_timeout", true);
  }
  switch (event.kind) {
    case "decline":
      return finish(state.connected ? "ended" : "declined", !state.connected);
    case "timeout":
      return { state, effects };
    case "sip_ready":
      if (!state.sipReady && !state.connected) {
        state.sipReady = true;
        if (!state.legCreated) effects.push("prepare_leg");
      }
      break;
    case "leg_created":
      if (state.sipReady) state.legCreated = true;
      break;
    case "accept":
      state.acceptRequested = true;
      break;
    case "accept_authorized":
      if (
        state.acceptRequested &&
        state.sipReady &&
        state.legCreated &&
        state.acceptAuthorizationRequested
      ) {
        state.acceptAuthorized = true;
        state.acceptPermitExpiresAtMs = Math.min(
          nowMs + 5000,
          state.expiresAtMs,
        );
      }
      break;
    case "connected":
      if (
        state.acceptAuthorized &&
        state.legCreated &&
        state.sipReady &&
        (state.acceptPermitExpiresAtMs === undefined ||
          nowMs < state.acceptPermitExpiresAtMs)
      )
        state.connected = true;
      break;
  }
  if (
    state.sipReady &&
    state.legCreated &&
    state.acceptRequested &&
    !state.acceptAuthorized &&
    !state.acceptAuthorizationRequested &&
    !state.connected
  ) {
    state.acceptAuthorizationRequested = true;
    effects.push("authorize_accept");
  }
  return { state, effects };
}

export function canRouteMobile(input: {
  onDuty: boolean;
  identityValid: boolean;
  nowMs: number;
  leaseExpiresAtMs: number;
  sipRegistered: boolean;
  certifiedWake: boolean;
  failureLatched: boolean;
  knownNetworkFailure?: boolean;
}): boolean {
  return (
    input.onDuty &&
    input.identityValid &&
    !input.failureLatched &&
    !input.knownNetworkFailure &&
    Number.isFinite(input.nowMs) &&
    Number.isFinite(input.leaseExpiresAtMs) &&
    input.nowMs < input.leaseExpiresAtMs &&
    (input.sipRegistered || input.certifiedWake)
  );
}
