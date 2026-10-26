import { describe, expect, it } from "vitest";
import {
  createDeviceGrant,
  hashDeviceGrant,
  isGrantUsable,
  verifyDeviceGrant,
  encryptPushToken,
  decryptPushToken,
} from "../../modules/mobile-calling/device-auth.js";
import type { MobilePrincipal } from "../../modules/mobile-calling/contracts.js";
const principal: MobilePrincipal = {
  accountId: 1,
  vdnId: 10,
  userId: 20,
  loginSid: "session-1",
  bindingVersion: 4,
  deviceId: "device-1",
};
const record = () => {
  const grant = createDeviceGrant();
  return {
    grant,
    stored: {
      hash: grant.hash,
      principal,
      leaseId: "lease-1",
      leaseRevision: 2,
      expiresAtMs: 10000,
      revokedAtMs: null as number | null,
    },
  };
};
describe("device-scoped wake authorization", () => {
  it("stores a one-way hash and accepts the original unexpired secret", () => {
    const { grant, stored } = record();
    expect(grant.secret).not.toBe(grant.hash);
    expect(grant.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyDeviceGrant(stored, grant.secret, principal, 1000)).toBe(true);
    expect(hashDeviceGrant(grant.secret)).toBe(grant.hash);
  });
  it("rejects an incorrect secret without throwing", () => {
    const { stored } = record();
    expect(
      verifyDeviceGrant(stored, createDeviceGrant().secret, principal, 1000),
    ).toBe(false);
    expect(verifyDeviceGrant(stored, "", principal, 1000)).toBe(false);
    expect(isGrantUsable(stored, "not-a-hash", principal, 1000)).toBe(false);
  });
  it.each([
    ["accountId", 2],
    ["vdnId", 11],
    ["userId", 21],
    ["loginSid", "session-2"],
    ["bindingVersion", 5],
    ["deviceId", "device-2"],
  ] as const)("rejects a changed %s", (key, value) => {
    const { grant, stored } = record();
    expect(
      verifyDeviceGrant(
        stored,
        grant.secret,
        { ...principal, [key]: value },
        1000,
      ),
    ).toBe(false);
  });
  it("rejects revoked and expired grants at the exact boundary", () => {
    const { grant, stored } = record();
    expect(verifyDeviceGrant(stored, grant.secret, principal, 10000)).toBe(
      false,
    );
    expect(
      verifyDeviceGrant(
        { ...stored, revokedAtMs: 1 },
        grant.secret,
        principal,
        1000,
      ),
    ).toBe(false);
    expect(verifyDeviceGrant(stored, grant.secret, principal, Number.NaN)).toBe(
      false,
    );
  });
  it("never reuses a secret across two installations", () => {
    expect(createDeviceGrant().secret).not.toBe(createDeviceGrant().secret);
  });
});
describe("push token encryption at rest", () => {
  const key = Buffer.alloc(32, 7);
  it("round-trips only with the matching installation scope", () => {
    const encrypted = encryptPushToken(
      "private-provider-token",
      key,
      "app:prod:device-1",
    );
    expect(encrypted).not.toContain("private-provider-token");
    expect(decryptPushToken(encrypted, key, "app:prod:device-1")).toBe(
      "private-provider-token",
    );
    expect(() =>
      decryptPushToken(encrypted, key, "app:prod:device-2"),
    ).toThrow();
  });
  it("rejects modified ciphertext or the wrong encryption key", () => {
    const encrypted = encryptPushToken("private-provider-token", key, "scope");
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptPushToken(parts.join("."), key, "scope")).toThrow();
    expect(() =>
      decryptPushToken(encrypted, Buffer.alloc(32, 8), "scope"),
    ).toThrow();
  });
  it("rejects missing or short encryption keys", () => {
    expect(() => encryptPushToken("token", Buffer.alloc(8), "scope")).toThrow();
  });
});
