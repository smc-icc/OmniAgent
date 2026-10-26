import { describe, expect, it } from "vitest";
import {
  buildNetworkProfile,
  createTurnCredentials,
} from "../../modules/mobile-network/network-profile.js";
const config = {
  version: 1,
  sipEndpoints: [
    {
      id: "primary",
      host: "sip.example.test",
      port: 5061,
      transport: "tls",
      serviceDomain: "voice.example.test",
      priority: 0,
    },
  ],
  stunServers: [{ host: "turn.example.test", port: 3478 }],
  turnServers: [
    { host: "turn.example.test", port: 3478, transport: "udp" },
    { host: "turn.example.test", port: 443, transport: "tls" },
  ],
  cellularAllowed: true,
  roamingAllowed: false,
  activeRecoveryTimeoutMs: 15000,
};
const scope = {
  attemptId: "offer-1",
  deviceId: "device-1",
  authorizationValidUntilMs: 2000000,
};
const capabilities = { turnUdp: true, turnTcp: true, turnTlsVerified: false };
describe("native network profile and bounded relay credentials", () => {
  it("does not mint TURN credentials without an authorized call scope", () => {
    const profile = buildNetworkProfile(config, {
      nowMs: 1000000,
      capabilities,
      turnSecret: "s".repeat(32),
    });
    expect(profile.turnServers).toEqual([]);
    expect(JSON.stringify(profile)).not.toContain("ssssssss");
  });
  it("does not advertise PJSUA2 TURN TLS without verified certificate handling", () => {
    const profile = buildNetworkProfile(config, {
      nowMs: 1000000,
      capabilities,
      turnSecret: "s".repeat(32),
      scope,
    });
    expect(profile.turnServers.map((s) => s.transport)).toEqual(["udp"]);
  });
  it("uses coturn time-limited credentials with the fixed protocol vector", () => {
    const credentials = createTurnCredentials(
      scope,
      "s".repeat(32),
      1000000,
      600,
    );
    expect(credentials).toEqual({
      username: "1600:offer-1:device-1",
      credential: "/iIH2l1kN3GBCZfwieE8aL6pGp0=",
      expiresAtMs: 1600000,
    });
  });
  it("refuses credentials for expired authorization or an excessive lifetime", () => {
    expect(() =>
      createTurnCredentials(scope, "s".repeat(32), 2000000, 600),
    ).toThrow();
    expect(() =>
      createTurnCredentials(scope, "s".repeat(32), 1000000, 86400),
    ).toThrow();
  });
  it("does not downgrade a misconfigured SIP endpoint to plaintext", () => {
    expect(() =>
      buildNetworkProfile(
        {
          ...config,
          sipEndpoints: [{ ...config.sipEndpoints[0], transport: "udp" }],
        },
        { nowMs: 1000000, capabilities },
      ),
    ).toThrow();
  });
  it("rejects endpoint hosts that are actually URLs or contain a command/path", () => {
    for (const host of [
      "https://sip.example.test",
      "sip.example.test/path",
      "sip.example.test@other.test",
      "sip.example.test;bad",
    ]) {
      expect(() =>
        buildNetworkProfile(
          { ...config, sipEndpoints: [{ ...config.sipEndpoints[0], host }] },
          { nowMs: 1000000, capabilities },
        ),
      ).toThrow();
    }
  });
  it("keeps user cellular and roaming restrictions in the native policy", () => {
    const profile = buildNetworkProfile(
      { ...config, cellularAllowed: false },
      { nowMs: 1000000, capabilities },
    );
    expect(profile.cellularAllowed).toBe(false);
    expect(profile.roamingAllowed).toBe(false);
  });
});
