import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { applyCallEvent } from "../../modules/mobile-calling/call-policy.js";
import { acceptsNetworkProof } from "../../modules/mobile-network/network-policy.js";
import type {
  CallEffect,
  CallEvent,
  MobileAttempt,
} from "../../modules/mobile-calling/contracts.js";
const calls = JSON.parse(
  await readFile(
    new URL(
      "../../../../frontend/native/contracts/mobile-call-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
for (const fixture of calls.cases)
  it("shared native contract: " + fixture.name, () => {
    let state: MobileAttempt = { ...calls.base, ...fixture.overrides };
    const effects: CallEffect[] = [];
    for (const [i, e] of fixture.events.entries()) {
      const event: CallEvent = {
        deviceId: "device-1",
        leaseRevision: 4,
        eventId: "event-" + i,
        ...e,
      };
      const result = applyCallEvent(state, event, e.atMs);
      state = result.state;
      effects.push(...result.effects);
    }
    expect(effects).toEqual(fixture.want.effects);
    expect(state.terminal).toBe(fixture.want.terminal);
    expect(state.acceptAuthorized).toBe(fixture.want.acceptAuthorized);
  });
const network = JSON.parse(
  await readFile(
    new URL(
      "../../../../frontend/native/contracts/mobile-network-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
for (const fixture of network.cases)
  it("shared network contract: " + fixture.name, () => {
    expect(acceptsNetworkProof(network.generation, fixture.proof)).toBe(
      fixture.accepted,
    );
  });
