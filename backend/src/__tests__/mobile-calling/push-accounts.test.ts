import { describe, it, expect } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import Fastify from "fastify";
import {
  createPushAccountRuntime,
  type PushAccountSnapshot,
  type PushAccountRepository,
} from "../../shared/services/push-account-runtime.js";
import { createPushAccountRoutes } from "../../modules/platform_config/push-accounts.routes.js";
const key = randomBytes(32).toString("base64");
const id = "abcf0000-1111-4111-8111-111111111111";
function row(enabled = true) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  c.setAAD(Buffer.from(`push:v1:${id}:harmony:com.smcloud.omniagent`));
  const b = Buffer.concat([
    c.update(
      JSON.stringify({
        project_id: "12345",
        service_account_json: "secret-account-value",
      }),
    ),
    c.final(),
  ]);
  return {
    id,
    provider: "harmony" as const,
    name: "Harmony",
    bundle_id: "com.smcloud.omniagent",
    enabled,
    updated_at: "2026-10-16T00:00:00Z",
    credentials: [
      "v1",
      iv.toString("base64url"),
      c.getAuthTag().toString("base64url"),
      b.toString("base64url"),
    ].join(":"),
  };
}
function fixture() {
  let snapshot: PushAccountSnapshot | null = null;
  let serial = Promise.resolve();
  const sent: unknown[] = [];
  const repo: PushAccountRepository = {
    read: async () => snapshot,
    transaction: (run) => {
      const task = serial.then(() =>
        run({
          read: async () => snapshot,
          write: async (s) => {
            snapshot = structuredClone(s);
          },
        }),
      );
      serial = task.then(
        () => {},
        () => {},
      );
      return task;
    },
  };
  const runtime = createPushAccountRuntime({
    key: () => key,
    repository: repo,
    validate: () => {},
    send: async (a, t, m) => {
      sent.push({ a, t, m });
      return { accepted: true, code: "80000000" };
    },
  });
  return { repo, runtime, sent };
}
describe("Conf managed push snapshots", () => {
  it("decrypts interoperable Conf envelope, persists encrypted bytes and omits secrets in reads", async () => {
    const f = fixture();
    await f.runtime.synchronize({ revision: 1, accounts: [row()] });
    const stored = await f.repo.read();
    expect(JSON.stringify(stored)).not.toContain("secret-account-value");
    const list = await f.runtime.list();
    expect(list.accounts[0]?.fields.project_id).toBe("12345");
    expect(list.accounts[0]?.fields.service_account_json).toBeUndefined();
    expect(list.accounts[0]?.configured_fields).toContain(
      "service_account_json",
    );
    expect(f.runtime.configured()).toBe(true);
  });
  it("rejects stale or conflicting revisions; identical retries are idempotent", async () => {
    const f = fixture(),
      s = { revision: 2, accounts: [row()] };
    await f.runtime.synchronize(s);
    await f.runtime.synchronize(s);
    await expect(
      f.runtime.synchronize({ revision: 1, accounts: [] }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      f.runtime.synchronize({ revision: 2, accounts: [] }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await f.repo.read())?.accounts.length).toBe(1);
  });
  it("serializes concurrent revisions and never rolls the snapshot backwards", async () => {
    const f = fixture();
    await Promise.allSettled([
      f.runtime.synchronize({ revision: 3, accounts: [row()] }),
      f.runtime.synchronize({ revision: 2, accounts: [] }),
    ]);
    expect((await f.repo.read())?.revision).toBe(3);
  });
  it("disabled managed account suppresses environment fallback and receives no sends", async () => {
    const f = fixture();
    await f.runtime.synchronize({ revision: 1, accounts: [row(false)] });
    expect(
      await f.runtime.dispatch(
        "harmony",
        "test-device",
        "com.smcloud.omniagent",
        { kind: "notification", title: "Test", body: "Test" },
      ),
    ).toMatchObject({ accepted: false, reason: "account_disabled" });
    expect(f.sent).toHaveLength(0);
    expect(
      await f.runtime.dispatch("fcm", "test-device", "com.smcloud.omniagent", {
        kind: "notification",
        title: "Test",
        body: "Test",
      }),
    ).toBeNull();
  });
  it("loads DB configuration after process restart and uses replacement immediately", async () => {
    const f = fixture();
    await f.runtime.synchronize({ revision: 1, accounts: [row()] });
    const restarted = createPushAccountRuntime({
      key: () => key,
      repository: f.repo,
      validate: () => {},
      send: async () => ({ accepted: true }),
    });
    await restarted.refresh();
    expect(restarted.configured()).toBe(true);
    expect(
      (
        await restarted.dispatch("harmony", "device", "com.smcloud.omniagent", {
          kind: "notification",
          title: "Test",
          body: "Test",
        })
      )?.accepted,
    ).toBe(true);
    await f.runtime.synchronize({ revision: 2, accounts: [row(false)] });
    expect(
      (
        await restarted.dispatch("harmony", "device", "com.smcloud.omniagent", {
          kind: "notification",
          title: "Test",
          body: "Test",
        })
      )?.accepted,
    ).toBe(false);
  });
  it("rejects tampered ciphertext or duplicate enabled application scope without changing stored version", async () => {
    const f = fixture(),
      r = row();
    await f.runtime.synchronize({ revision: 1, accounts: [r] });
    await expect(
      f.runtime.synchronize({
        revision: 2,
        accounts: [{ ...r, id: "cdef0000-1111-4111-8111-111111111111" }],
      }),
    ).rejects.toThrow();
    await expect(
      f.runtime.synchronize({ revision: 2, accounts: [r, r] }),
    ).rejects.toThrow();
    expect((await f.repo.read())?.revision).toBe(1);
  });
});
describe("push configuration protected transport", () => {
  it("has no dev auth bypass, validates bodies, and returns only safe config metadata", async () => {
    const f = fixture(),
      app = Fastify();
    await app.register(createPushAccountRoutes(f.runtime, () => "sync-secret"));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/platform-config/push-accounts/sync",
          payload: { revision: 1, accounts: [row()] },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/platform-config/push-accounts/test",
          payload: { id, token: "device-token-123456" },
        })
      ).statusCode,
    ).toBe(401);
    const headers = { "x-platform-sync-token": "sync-secret" };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/platform-config/push-accounts/sync",
          headers,
          payload: { revision: 1, accounts: [row()] },
        })
      ).statusCode,
    ).toBe(200);
    const listing = await app.inject({
      url: "/api/platform-config/push-accounts",
      headers,
    });
    expect(listing.statusCode).toBe(200);
    expect(listing.body).not.toContain("secret-account-value");
    const invalid = await app.inject({
      method: "POST",
      url: "/api/platform-config/push-accounts/test",
      headers,
      payload: { id, token: "device-token-123456", kind: "incoming_call" },
    });
    expect(invalid.statusCode).toBe(400);
    const send = await app.inject({
      method: "POST",
      url: "/api/platform-config/push-accounts/test",
      headers,
      payload: { id, token: "device-token-123456" },
    });
    expect(send.statusCode).toBe(200);
    expect(send.json()).toMatchObject({
      accepted: true,
      device_confirmed: false,
    });
    expect(send.body).not.toContain("device-token-123456");
    await app.close();
  });
  it("returns 503 when shared secret is absent", async () => {
    const f = fixture(),
      app = Fastify();
    await app.register(createPushAccountRoutes(f.runtime, () => ""));
    expect(
      (await app.inject({ url: "/api/platform-config/push-accounts" }))
        .statusCode,
    ).toBe(503);
    await app.close();
  });
});
