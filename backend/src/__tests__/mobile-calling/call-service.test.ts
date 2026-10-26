import { describe, expect, it } from "vitest";
import {
  dispatchMobileJob,
  type MobileExecutionPorts,
} from "../../modules/mobile-calling/push-dispatcher.js";
import type { MobileAttempt } from "../../modules/mobile-calling/contracts.js";
import type {
  OutboxJob,
  StoredAttempt,
} from "../../modules/mobile-calling/repository.js";
const state: MobileAttempt = {
  attemptId: "a1",
  offerId: "o1",
  deviceId: "d1",
  leaseId: "l1",
  leaseRevision: 1,
  expiresAtMs: 30000,
  wakeDeadlineMs: 8000,
  sipReady: false,
  acceptRequested: false,
  legCreated: false,
  acceptAuthorized: false,
  connected: false,
  terminal: null,
};
const saved = (overrides: Partial<MobileAttempt> = {}): StoredAttempt => ({
  attemptId: "a1",
  offerId: "o1",
  leaseId: "l1",
  state: { ...state, ...overrides },
  context: {
    agentId: 20,
    vdnId: 10,
    callId: 100,
    callIdType: 0,
    offeredType: 1,
  },
  connectionGeneration: 0,
});
const job = (kind: string, attempts = 1): OutboxJob => ({
  jobId: "j1",
  attemptId: "a1",
  kind,
  payload: { attemptId: "a1" },
  claimToken: "claim-1",
  attempts,
  deadlineMs: 8000,
});
function lab() {
  const operations: Array<{ action: string; key: string }> = [];
  const pushes: unknown[] = [];
  const ports: MobileExecutionPorts = {
    ccs: {
      async currentOffer(offerId) {
        return {
          offerId,
          active: true,
          leaseId: "l1",
          leaseRevision: 1,
          agentId: 20,
          vdnId: 10,
        };
      },
      async action(input) {
        operations.push({ action: input.action, key: input.operationId });
        return { status: "ok" };
      },
    },
    async getToken() {
      return { provider: "fcm", token: "private-token" };
    },
    providers: {
      fcm: {
        async send(_token, envelope) {
          pushes.push(envelope);
          return {
            status: "provider_accepted",
            providerMessageId: "provider-1",
          };
        },
      },
    },
    async notifyNative() {},
  };
  return { ports, operations, pushes };
}
describe("durable mobile job execution", () => {
  it("does not send a queued push after customer cancellation", async () => {
    const labState = lab();
    const result = await dispatchMobileJob(
      job("push"),
      saved({ terminal: "cancelled" }),
      labState.ports,
      1000,
    );
    expect(result.status).toBe("suppressed");
    expect(labState.pushes).toHaveLength(0);
  });
  it("checks the current CCS offer before sending a stale ready job", async () => {
    const labState = lab();
    labState.ports.ccs.currentOffer = async () => ({
      offerId: "new-offer",
      active: true,
      leaseId: "l1",
      leaseRevision: 1,
      agentId: 20,
      vdnId: 10,
    });
    const result = await dispatchMobileJob(
      job("prepare_leg"),
      saved({ sipReady: true }),
      labState.ports,
      1000,
    );
    expect(result.status).toBe("suppressed");
    expect(labState.operations).toHaveLength(0);
  });
  it("uses the same operation id when an already-executed CCS call is retried", async () => {
    const labState = lab();
    await dispatchMobileJob(
      job("prepare_leg", 1),
      saved({ sipReady: true }),
      labState.ports,
      1000,
    );
    await dispatchMobileJob(
      job("prepare_leg", 2),
      saved({ sipReady: true }),
      labState.ports,
      1500,
    );
    expect(labState.operations).toEqual([
      { action: "prepare_leg", key: "j1" },
      { action: "prepare_leg", key: "j1" },
    ]);
  });
  it("treats provider acceptance as transport evidence only", async () => {
    const labState = lab();
    const result = await dispatchMobileJob(
      job("push"),
      saved(),
      labState.ports,
      1000,
    );
    expect(result.status).toBe("provider_accepted");
    expect(result.trustedEvent).toBeUndefined();
    expect(labState.pushes).toHaveLength(1);
    expect(JSON.stringify(labState.pushes)).not.toContain("private-token");
  });
  it("does not issue an acceptance acknowledgement if CCS reports a stale offer", async () => {
    const labState = lab();
    labState.ports.ccs.action = async () => ({ status: "stale" });
    const result = await dispatchMobileJob(
      job("authorize_accept"),
      saved({
        sipReady: true,
        legCreated: true,
        acceptRequested: true,
        acceptAuthorizationRequested: true,
      }),
      labState.ports,
      1000,
    );
    expect(result.trustedEvent).toBeUndefined();
    expect(result.status).toBe("suppressed");
  });
  it("only creates an acceptance acknowledgement after a successful CCS operation", async () => {
    const labState = lab();
    const result = await dispatchMobileJob(
      job("authorize_accept"),
      saved({
        sipReady: true,
        legCreated: true,
        acceptRequested: true,
        acceptAuthorizationRequested: true,
      }),
      labState.ports,
      1000,
    );
    expect(result.trustedEvent).toBe("accept_authorized");
    expect(labState.operations).toEqual([{ action: "accept", key: "j1" }]);
  });
  it("does not dial a still-queued agent leg after the hard preparation deadline", async () => {
    const labState = lab();
    const result = await dispatchMobileJob(
      { ...job("prepare_leg"), deadlineMs: 30000 },
      saved({ sipReady: true }),
      labState.ports,
      8000,
    );
    expect(result.status).toBe("expired");
    expect(labState.operations).toHaveLength(0);
  });
  it("does not create a fresh push after the initial wake budget expires", async () => {
    const labState = lab();
    const result = await dispatchMobileJob(
      job("push"),
      saved(),
      labState.ports,
      8000,
    );
    expect(result.status).toBe("expired");
    expect(labState.pushes).toHaveLength(0);
  });
  it("fails a pending offer after identity revocation even though its native state is terminal", async () => {
    const labState = lab();
    const result = await dispatchMobileJob(
      { ...job("fail_offer"), deadlineMs: 70000 },
      saved({ terminal: "superseded" }),
      labState.ports,
      9000,
    );
    expect(result.status).toBe("completed");
    expect(labState.operations).toEqual([
      { action: "wake_timeout", key: "j1" },
    ]);
  });
  it("never requeues an established call as a no-answer failure", async () => {
    const labState = lab();
    const result = await dispatchMobileJob(
      job("fail_offer"),
      saved({ connected: true }),
      labState.ports,
      1000,
    );
    expect(result.status).toBe("suppressed");
    expect(labState.operations).toHaveLength(0);
  });
});
