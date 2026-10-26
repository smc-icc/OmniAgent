import { describe, expect, it } from "vitest";
import {
  applyCallEvent,
  canRouteMobile,
} from "../../modules/mobile-calling/call-policy.js";
import type {
  CallEvent,
  MobileAttempt,
} from "../../modules/mobile-calling/contracts.js";

const attempt = (overrides: Partial<MobileAttempt> = {}): MobileAttempt => ({
  attemptId: "attempt-1",
  offerId: "offer-1",
  deviceId: "device-1",
  leaseId: "lease-1",
  leaseRevision: 4,
  expiresAtMs: 30000,
  wakeDeadlineMs: 8000,
  sipReady: false,
  acceptRequested: false,
  legCreated: false,
  acceptAuthorized: false,
  connected: false,
  terminal: null,
  ...overrides,
});
const event = (
  kind: CallEvent["kind"],
  overrides: Partial<CallEvent> = {},
): CallEvent => ({
  eventId: "event-1",
  deviceId: "device-1",
  leaseRevision: 4,
  kind,
  ...overrides,
});

describe("mobile offer lifecycle", () => {
  it("does not recreate an agent leg after customer cancellation", () => {
    const result = applyCallEvent(
      attempt({ terminal: "cancelled" }),
      event("sip_ready"),
      2000,
    );
    expect(result.state.terminal).toBe("cancelled");
    expect(result.effects).toEqual([]);
  });
  it("ignores an old device even when its ready message arrives first", () => {
    const result = applyCallEvent(
      attempt(),
      event("sip_ready", { deviceId: "old-device" }),
      1000,
    );
    expect(result.state.sipReady).toBe(false);
    expect(result.effects).toEqual([]);
  });
  it("ignores a stale lease revision after extension rebinding", () => {
    const result = applyCallEvent(
      attempt(),
      event("accept", { leaseRevision: 3 }),
      1000,
    );
    expect(result.state.acceptRequested).toBe(false);
    expect(result.effects).toEqual([]);
  });
  it("prepares exactly one leg when ready is delivered twice", () => {
    const first = applyCallEvent(attempt(), event("sip_ready"), 1000);
    const second = applyCallEvent(
      first.state,
      event("sip_ready", { eventId: "event-2" }),
      1001,
    );
    expect(first.effects).toEqual(["prepare_leg"]);
    expect(second.effects).toEqual([]);
  });
  it("latches early acceptance and grants it only after the leg exists", () => {
    const accepted = applyCallEvent(attempt(), event("accept"), 500);
    expect(accepted.state.acceptRequested).toBe(true);
    expect(accepted.effects).toEqual([]);
    const ready = applyCallEvent(accepted.state, event("sip_ready"), 1000);
    expect(ready.effects).toEqual(["prepare_leg"]);
    const leg = applyCallEvent(ready.state, event("leg_created"), 1500);
    expect(leg.effects).toEqual(["authorize_accept"]);
  });
  it("does not treat an enqueued authorization request as a CCS acceptance permit", () => {
    const requested = applyCallEvent(
      attempt({ sipReady: true, legCreated: true }),
      event("accept"),
      2000,
    );
    expect(requested.effects).toEqual(["authorize_accept"]);
    expect(requested.state.acceptAuthorized).toBe(false);
    expect(
      applyCallEvent(requested.state, event("connected"), 2100).state.connected,
    ).toBe(false);
    const approved = applyCallEvent(
      requested.state,
      event("accept_authorized"),
      2200,
    );
    expect(approved.state.acceptAuthorized).toBe(true);
    expect(
      applyCallEvent(approved.state, event("connected"), 2300).state.connected,
    ).toBe(true);
  });
  it("does not grant a second answer when the accept action is retried", () => {
    const result = applyCallEvent(
      attempt({
        sipReady: true,
        legCreated: true,
        acceptRequested: true,
        acceptAuthorized: true,
      }),
      event("accept"),
      2000,
    );
    expect(result.effects).toEqual([]);
  });
  it("rejects a late ready at the original wake deadline", () => {
    const result = applyCallEvent(attempt(), event("sip_ready"), 8000);
    expect(result.state.terminal).toBe("wake_timeout");
    expect(result.effects).toEqual(["end_native", "fail_offer"]);
  });
  it("does not extend preparation to the ringing deadline while leg creation is still queued", () => {
    const result = applyCallEvent(
      attempt({ sipReady: true }),
      event("timeout"),
      8000,
    );
    expect(result.state.terminal).toBe("wake_timeout");
    expect(result.effects).toEqual(["end_native", "fail_offer"]);
  });
  it("does not run a wake timeout before its deadline", () => {
    const result = applyCallEvent(attempt(), event("timeout"), 7999);
    expect(result.state.terminal).toBeNull();
    expect(result.effects).toEqual([]);
  });
  it("uses the offer deadline once the phone is ready", () => {
    const ready = attempt({ sipReady: true, legCreated: true });
    expect(
      applyCallEvent(ready, event("accept"), 12000).state.terminal,
    ).toBeNull();
    const expired = applyCallEvent(ready, event("accept"), 30000);
    expect(expired.state.terminal).toBe("expired");
    expect(expired.effects).toEqual(["end_native", "fail_offer"]);
  });
  it("customer cancellation ends the device without requeueing the caller", () => {
    const result = applyCallEvent(attempt(), event("cancel"), 1000);
    expect(result.state.terminal).toBe("cancelled");
    expect(result.effects).toEqual(["end_native"]);
  });
  it("declining before answer requests the correct offer failure path", () => {
    const result = applyCallEvent(attempt(), event("decline"), 1000);
    expect(result.state.terminal).toBe("declined");
    expect(result.effects).toEqual(["end_native", "fail_offer"]);
  });
  it("does not expire a connected call at the old ringing deadline", () => {
    const result = applyCallEvent(
      attempt({
        connected: true,
        sipReady: true,
        legCreated: true,
        acceptRequested: true,
        acceptAuthorized: true,
      }),
      event("timeout"),
      60000,
    );
    expect(result.state.terminal).toBeNull();
    expect(result.effects).toEqual([]);
  });
  it("cannot enter connected before acceptance is authorized", () => {
    const result = applyCallEvent(
      attempt({ sipReady: true, legCreated: true }),
      event("connected"),
      1000,
    );
    expect(result.state.connected).toBe(false);
  });
  it("ending an established call never sends it back to ACD", () => {
    const result = applyCallEvent(
      attempt({ connected: true }),
      event("end"),
      60000,
    );
    expect(result.state.terminal).toBe("ended");
    expect(result.effects).toEqual(["end_native"]);
  });
  it("does not mutate the saved input while applying an event", () => {
    const before = attempt();
    applyCallEvent(before, event("sip_ready"), 1000);
    expect(before.sipReady).toBe(false);
  });
  it("rejects non-finite clocks rather than silently keeping a stale offer alive", () => {
    expect(() =>
      applyCallEvent(attempt(), event("sip_ready"), Number.NaN),
    ).toThrow();
  });
});

describe("mobile routing eligibility", () => {
  const base = {
    onDuty: true,
    identityValid: true,
    nowMs: 1000,
    leaseExpiresAtMs: 9000,
    sipRegistered: false,
    certifiedWake: true,
    failureLatched: false,
  };
  it("allows a certified sleeping device without an idle SIP registration", () => {
    expect(canRouteMobile(base)).toBe(true);
  });
  it.each([
    ["ended duty", { onDuty: false }],
    ["revoked identity", { identityValid: false }],
    ["uncertified push", { certifiedWake: false }],
    ["failed wake", { failureLatched: true }],
    ["known broken network", { knownNetworkFailure: true }],
    ["expired shift", { nowMs: 9000 }],
  ])("does not route to %s", (_, overrides) => {
    expect(canRouteMobile({ ...base, ...overrides })).toBe(false);
  });
  it("permits a ready foreground phone without claiming certified background wake", () => {
    expect(
      canRouteMobile({ ...base, certifiedWake: false, sipRegistered: true }),
    ).toBe(true);
  });
});
