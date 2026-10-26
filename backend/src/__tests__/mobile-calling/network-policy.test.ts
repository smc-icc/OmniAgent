import { describe, expect, it } from "vitest";
import {
  acceptsNetworkProof,
  remainingRecoveryMs,
  advanceNetworkGeneration,
  beginRecovery,
  recoveryEffects,
} from "../../modules/mobile-network/network-policy.js";
import type { RecoveryContext } from "../../modules/mobile-network/contracts.js";

const current = {
  runtimeId: "runtime-2",
  networkEpoch: 3,
  connectionGeneration: 8,
};
describe("network recovery epochs and deadlines", () => {
  it("rejects a ready callback from the old network", () => {
    expect(acceptsNetworkProof(current, { ...current, networkEpoch: 2 })).toBe(
      false,
    );
  });
  it("rejects a callback from a terminated process", () => {
    expect(
      acceptsNetworkProof(current, { ...current, runtimeId: "runtime-1" }),
    ).toBe(false);
  });
  it("rejects a stale server connection generation", () => {
    expect(
      acceptsNetworkProof(current, { ...current, connectionGeneration: 7 }),
    ).toBe(false);
  });
  it("accepts only the current verified connection", () => {
    expect(acceptsNetworkProof(current, { ...current })).toBe(true);
  });
  it("has only two seconds left after switching in the sixth second", () => {
    expect(remainingRecoveryMs(8000, 6000)).toBe(2000);
    expect(remainingRecoveryMs(8000, 8001)).toBe(0);
  });
  it("does not start recovery just because the bearer label changes", () => {
    expect(advanceNetworkGeneration(current, "same-path", "same-path")).toEqual(
      current,
    );
  });
  it("invalidates the connection proof when the actual route changes", () => {
    expect(advanceNetworkGeneration(current, "wifi-path", "cell-path")).toEqual(
      {
        runtimeId: "runtime-2",
        networkEpoch: 4,
        connectionGeneration: 0,
      },
    );
  });
  it("keeps the first media recovery deadline across repeated network changes", () => {
    const first = beginRecovery(null, current, 1000, true, false, 15000);
    const second = beginRecovery(
      first,
      { ...current, networkEpoch: 4 },
      9000,
      true,
      false,
      15000,
    );
    expect(first.deadlineMonoMs).toBe(16000);
    expect(second.deadlineMonoMs).toBe(16000);
  });
  it("never extends the original pending offer deadline", () => {
    expect(
      beginRecovery(null, current, 6000, false, false, 8000, 8000)
        .deadlineMonoMs,
    ).toBe(8000);
  });
  it("does not hang up healthy media when the business websocket is disconnected", () => {
    const context: RecoveryContext = {
      generation: current,
      deadlineMonoMs: 15000,
      businessCallConnected: true,
      mediaHealthy: true,
    };
    expect(recoveryEffects(context, 20000)).toEqual([]);
  });
  it("ends a failed established call without requesting another ACD offer", () => {
    const context: RecoveryContext = {
      generation: current,
      deadlineMonoMs: 15000,
      businessCallConnected: true,
      mediaHealthy: false,
    };
    expect(recoveryEffects(context, 15000)).toEqual(["end_call"]);
  });
  it("fails the pending offer when the unconnected phone cannot recover", () => {
    expect(
      recoveryEffects(
        {
          generation: current,
          deadlineMonoMs: 8000,
          businessCallConnected: false,
          mediaHealthy: false,
        },
        8000,
      ),
    ).toEqual(["fail_offer"]);
  });
});
