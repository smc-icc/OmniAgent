import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { mobileNativeCallRoutes } from "../../modules/mobile-calling/routes.js";
import type { MobileCallService } from "../../modules/mobile-calling/call-service.js";
const id = "11111111-1111-4111-8111-111111111111";
const secret = "x".repeat(43);
function service(): Pick<
  MobileCallService,
  "bootstrap" | "nativeEvent" | "state"
> {
  return {
    async bootstrap(attemptId, _grant, network) {
      return {
        attemptId,
        offerId: id,
        operationToken: secret,
        operationTokenExpiresAtMs: 120000,
        expiresAtMs: 30000,
        wakeDeadlineMs: 8000,
        generation: { ...network, connectionGeneration: 1 },
        credentials: { username: "test", password: "sensitive-sip" },
      };
    },
    async nativeEvent() {
      throw new Error("registration_not_verified");
    },
    async state(attemptId) {
      return {
        attemptId,
        offerId: id,
        terminal: null,
        connected: false,
        acceptAuthorized: false,
        acceptPermitExpiresAtMs: null,
        generation: undefined,
        expiresAtMs: 30000,
      };
    },
  };
}
async function app(enabled = true) {
  const a = Fastify();
  await a.register(mobileNativeCallRoutes, { service: service(), enabled });
  return a;
}
describe("native capability HTTP boundary", () => {
  it("does not let a business bearer token invoke a native bootstrap", async () => {
    const a = await app();
    try {
      const r = await a.inject({
        method: "POST",
        url: `/api/mobile/calls/${id}/bootstrap`,
        headers: { authorization: "Bearer " + secret },
        payload: { runtimeId: "runtime-1", networkEpoch: 0 },
      });
      expect(r.statusCode).toBe(401);
      expect(r.body).not.toContain("sensitive-sip");
    } finally {
      await a.close();
    }
  });
  it("marks credential responses as non-cacheable", async () => {
    const a = await app();
    try {
      const r = await a.inject({
        method: "POST",
        url: `/api/mobile/calls/${id}/bootstrap`,
        headers: { authorization: "MobileDevice " + secret },
        payload: { runtimeId: "runtime-1", networkEpoch: 0 },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.json().credentials.username).toBe("test");
    } finally {
      await a.close();
    }
  });
  it("rejects a device that tries to submit the server-only authorization acknowledgement", async () => {
    const a = await app();
    try {
      const r = await a.inject({
        method: "POST",
        url: `/api/mobile/calls/${id}/events`,
        headers: { authorization: "MobileCall " + secret },
        payload: {
          eventId: id,
          kind: "accept_authorized",
          generation: {
            runtimeId: "runtime-1",
            networkEpoch: 0,
            connectionGeneration: 1,
          },
        },
      });
      expect(r.statusCode).toBe(400);
    } finally {
      await a.close();
    }
  });
  it("rejects account and VDN selectors in a native payload", async () => {
    const a = await app();
    try {
      const r = await a.inject({
        method: "POST",
        url: `/api/mobile/calls/${id}/bootstrap`,
        headers: { authorization: "MobileDevice " + secret },
        payload: { runtimeId: "runtime-1", networkEpoch: 0, vdnId: 999 },
      });
      expect(r.statusCode).toBe(400);
    } finally {
      await a.close();
    }
  });
  it("keeps the new protocol unavailable until its deployment gate is enabled", async () => {
    const a = await app(false);
    try {
      const r = await a.inject({
        method: "GET",
        url: `/api/mobile/calls/${id}`,
        headers: { authorization: "MobileCall " + secret },
      });
      expect(r.statusCode).toBe(503);
    } finally {
      await a.close();
    }
  });
});
