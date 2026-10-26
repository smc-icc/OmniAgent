import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  constants,
  createHash,
  generateKeyPairSync,
  verify,
  type KeyObject,
} from "node:crypto";
import { EventEmitter } from "node:events";
import {
  MANAGED_PUSH_CAPABILITIES,
  sendManagedPush,
  validatePushAccountFields,
  type ManagedPushAccount,
  type ManagedPushMessage,
  type ManagedPushProvider,
} from "../../shared/services/push-providers.js";
const http2 = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:http2", () => ({ connect: http2.connect }));
const NOW = 1_792_108_800_000;
const TOKEN = "synthetic-device-token";
const notification: ManagedPushMessage = {
  kind: "notification",
  title: "消息通知",
  body: "您有新的服务消息",
};
const call: ManagedPushMessage = {
  kind: "incoming_call",
  title: "来电",
  body: "来自坐席的来电",
  call_id: "call-123",
  call_id_type: 2,
  caller: "1001",
  called: "1002",
};
let rsa: { privateKey: KeyObject; publicKey: KeyObject };
let ec: { privateKey: KeyObject; publicKey: KeyObject };
let fields: Record<ManagedPushProvider, Record<string, string>>;
const providers: ManagedPushProvider[] = [
  "harmony",
  "fcm",
  "apns",
  "mipush",
  "hms",
  "oppo",
  "vivo",
  "honor",
];
const domestic: ManagedPushProvider[] = ["mipush", "hms", "oppo", "vivo"];
const pem = (key: KeyObject) =>
  key.export({ type: "pkcs8", format: "pem" }).toString();
const account = (provider: ManagedPushProvider): ManagedPushAccount => ({
  id: `account-${provider}`,
  provider,
  name: "Fixture",
  bundle_id: "com.example.agent",
  enabled: true,
  fields: { ...fields[provider] },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const transport = (...responses: Response[]) =>
  vi.fn<typeof fetch>().mockImplementation(async () => {
    const r = responses.shift();
    if (!r) throw Error("Extra request");
    return r;
  });
const bodyAt = (f: ReturnType<typeof transport>, i = 0) =>
  JSON.parse(String(f.mock.calls[i][1]!.body));
const formAt = (f: ReturnType<typeof transport>, i = 0) =>
  new URLSearchParams(String(f.mock.calls[i][1]!.body));
const headersAt = (f: ReturnType<typeof transport>, i = 0) =>
  new Headers(f.mock.calls[i][1]!.headers);
function jwtParts(jwt: string) {
  const [h, c, s] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    claims: JSON.parse(Buffer.from(c, "base64url").toString()),
    unsigned: Buffer.from(`${h}.${c}`),
    signature: Buffer.from(s, "base64url"),
  };
}
function apnsFixture(status = 200, body = "", stall = false) {
  const session = Object.assign(new EventEmitter(), {
    request: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
  });
  const request = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    setEncoding: vi.fn(),
  });
  session.request.mockReturnValue(request);
  request.end.mockImplementation(() => {
    if (!stall)
      queueMicrotask(() => {
        request.emit("response", {
          ":status": status,
          "apns-id": "1a283ba3-773e-444a-9b4e-39e390b85408",
        });
        if (body) request.emit("data", body);
        request.emit("end");
      });
  });
  http2.connect.mockReturnValue(session);
  return { session, request };
}
beforeAll(() => {
  rsa = generateKeyPairSync("rsa", { modulusLength: 4096 });
  ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  fields = {
    harmony: {
      project_id: "123456789",
      app_id: "987654321",
      service_account_json: JSON.stringify({
        project_id: "123456789",
        key_id: "fixture-kid",
        sub_account: "fixture-sub",
        private_key: pem(rsa.privateKey),
      }),
    },
    fcm: {
      project_id: "fixture-project",
      service_account_json: JSON.stringify({
        type: "service_account",
        project_id: "fixture-project",
        client_email: "push@fixture-project.iam.gserviceaccount.com",
        private_key: pem(rsa.privateKey),
        token_uri: "https://attacker.invalid/token",
      }),
    },
    apns: {
      bundle_id: "com.example.agent",
      key_id: "ABCDEFGHIJ",
      team_id: "KLMNOPQRST",
      private_key: pem(ec.privateKey),
      production: "false",
    },
    mipush: {
      app_id: "12345",
      app_key: "fixture-mi-key",
      app_secret: "fixture-mi-secret",
    },
    hms: {
      app_id: "12345",
      client_id: "54321",
      client_secret: "fixture-hms-secret",
    },
    oppo: {
      app_key: "fixture-oppo-key",
      master_secret: "fixture-oppo-secret",
      channel_id: "service",
    },
    vivo: {
      app_id: "12345",
      app_key: "fixture-vivo-key",
      app_secret: "fixture-vivo-secret",
    },
    honor: {
      app_id: "12345",
      client_id: "54321",
      client_secret: "fixture-honor-secret",
    },
  };
}, 20_000);
beforeEach(() => http2.connect.mockReset());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("fields", () => {
  it.each(providers)("accepts exact spec fields for %s", (p) =>
    expect(() => validatePushAccountFields(p, fields[p])).not.toThrow(),
  );
  it.each(providers)("requires every %s field", (p) => {
    for (const key of Object.keys(fields[p])) {
      const f = { ...fields[p] };
      delete f[key];
      expect(() => validatePushAccountFields(p, f)).toThrow(
        /^Invalid push account fields$/,
      );
    }
  });
  it.each([
    "not json",
    "null",
    "[]",
    '{"client_id":"APIclient-secret","public_key":"PUBLIC-secret"}',
    '{"private_key":"secret-bad-key"}',
  ])("rejects wrong Harmony credentials safely: %s", (raw) => {
    expect(() =>
      validatePushAccountFields("harmony", {
        ...fields.harmony,
        service_account_json: raw,
      }),
    ).toThrow(/^Invalid push account fields$/);
  });
  it("rejects public/weak keys, missing sub_account and mismatched Harmony projects", () => {
    const service = JSON.parse(fields.harmony.service_account_json),
      weak = generateKeyPairSync("rsa", { modulusLength: 2048 });
    for (const change of [
      {
        private_key: rsa.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
      { private_key: pem(weak.privateKey) },
      { sub_account: "" },
      { project_id: "11111" },
    ])
      expect(() =>
        validatePushAccountFields("harmony", {
          ...fields.harmony,
          service_account_json: JSON.stringify({ ...service, ...change }),
        }),
      ).toThrow(/^Invalid push account fields$/);
  });
  it("rejects wrong FCM schema, non-P256 APNs keys and invalid production", () => {
    expect(() =>
      validatePushAccountFields("fcm", {
        ...fields.fcm,
        service_account_json: JSON.stringify({
          ...JSON.parse(fields.fcm.service_account_json),
          type: "authorized_user",
        }),
      }),
    ).toThrow();
    expect(() =>
      validatePushAccountFields("apns", {
        ...fields.apns,
        private_key: pem(rsa.privateKey),
      }),
    ).toThrow();
    expect(() =>
      validatePushAccountFields("apns", {
        ...fields.apns,
        production: "truthy",
      }),
    ).toThrow();
  });
  it("rejects path/header injection, unsafe numeric IDs and unexpected fields/providers", () => {
    expect(() =>
      validatePushAccountFields("harmony", {
        ...fields.harmony,
        project_id: "../other?x",
      }),
    ).toThrow();
    expect(() =>
      validatePushAccountFields("mipush", {
        ...fields.mipush,
        app_secret: "secret\r\ninjected:yes",
      }),
    ).toThrow();
    expect(() =>
      validatePushAccountFields("vivo", {
        ...fields.vivo,
        app_id: "9007199254740999",
      }),
    ).toThrow();
    expect(() =>
      validatePushAccountFields("hms", {
        ...fields.hms,
        endpoint: "https://attacker.invalid",
      }),
    ).toThrow();
    expect(() =>
      validatePushAccountFields("__proto__" as ManagedPushProvider, {}),
    ).toThrow();
  });
});
describe("Harmony", () => {
  it("cryptographically verifies PS256 salt32, project URL and the proven notification schema", async () => {
    const f = transport(json({ code: "80000000", requestId: "request-123" }));
    expect(
      await sendManagedPush(account("harmony"), TOKEN, notification, {
        fetch: f,
        now: () => NOW,
      }),
    ).toEqual({ accepted: true, code: "80000000", requestId: "request-123" });
    expect(f.mock.calls[0][0]).toBe(
      "https://push-api.cloud.huawei.com/v3/123456789/messages:send",
    );
    const j = jwtParts(headersAt(f).get("authorization")!.slice(7));
    expect(j.header).toEqual({ alg: "PS256", typ: "JWT", kid: "fixture-kid" });
    expect(j.claims).toEqual({
      iss: "fixture-sub",
      aud: "https://oauth-login.cloud.huawei.com/oauth2/v3/token",
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
    expect(j.signature.length).toBe(512);
    expect(
      verify(
        "sha256",
        j.unsigned,
        {
          key: rsa.publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
        j.signature,
      ),
    ).toBe(true);
    expect(headersAt(f).get("push-type")).toBe("0");
    expect(bodyAt(f)).toEqual({
      payload: {
        notification: {
          category: "IM",
          title: notification.title,
          body: notification.body,
          clickAction: { actionType: 0 },
        },
      },
      target: { token: [TOKEN] },
      pushOptions: { testMessage: false },
    });
  });
  it("uses official call push-type 10, string extraData and 45 second TTL", async () => {
    const f = transport(json({ code: "80000000" }));
    await sendManagedPush(account("harmony"), TOKEN, call, { fetch: f });
    expect(headersAt(f).get("push-type")).toBe("10");
    expect(bodyAt(f)).toEqual({
      payload: { extraData: JSON.stringify(call) },
      target: { token: [TOKEN] },
      pushOptions: { testMessage: false, ttl: 45 },
    });
  });
});
describe("FCM", () => {
  it("verifies RS256 OAuth JWT and stringifies high priority call data", async () => {
    const f = transport(
      json({ access_token: "access" }),
      json({ name: "projects/fixture-project/messages/1" }),
    );
    expect(
      (
        await sendManagedPush(account("fcm"), TOKEN, call, {
          fetch: f,
          now: () => NOW,
        })
      ).accepted,
    ).toBe(true);
    expect(f.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    const j = jwtParts(formAt(f).get("assertion")!);
    expect(j.header.alg).toBe("RS256");
    expect(j.claims).toEqual({
      iss: "push@fixture-project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
    expect(verify("sha256", j.unsigned, rsa.publicKey, j.signature)).toBe(true);
    expect(f.mock.calls[1][0]).toBe(
      "https://fcm.googleapis.com/v1/projects/fixture-project/messages:send",
    );
    expect(bodyAt(f, 1)).toEqual({
      message: {
        token: TOKEN,
        data: { ...call, call_id_type: "2" },
        android: { priority: "HIGH", ttl: "45s", direct_boot_ok: true },
      },
    });
    expect(headersAt(f, 1).get("authorization")).toBe("Bearer access");
  });
  it("targets an explicitly configured different project and sends notification payload", async () => {
    const a = account("fcm");
    a.fields.project_id = "target-project";
    const f = transport(
      json({ access_token: "access" }),
      json({ name: "projects/target-project/messages/2" }),
    );
    await sendManagedPush(a, TOKEN, notification, { fetch: f });
    expect(f.mock.calls[1][0]).toBe(
      "https://fcm.googleapis.com/v1/projects/target-project/messages:send",
    );
    expect(bodyAt(f, 1).message.notification).toEqual({
      title: notification.title,
      body: notification.body,
    });
  });
  it.each([
    [{ error: { status: "NOT_FOUND" } }, false],
    [{ error: { status: "INVALID_ARGUMENT" } }, false],
    [
      {
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "UNREGISTERED",
            },
          ],
        },
      },
      true,
    ],
  ])("only structured UNREGISTERED invalidates token", async (b, invalid) => {
    const f = transport(json({ access_token: "access" }), json(b, 404));
    expect(
      (await sendManagedPush(account("fcm"), TOKEN, call, { fetch: f }))
        .invalidToken === true,
    ).toBe(invalid);
  });
});
describe("APNs HTTP/2", () => {
  it("verifies ES256 P1363 JWT and VoIP topic, priority and expiration", async () => {
    const { request, session } = apnsFixture();
    expect(
      (
        await sendManagedPush(account("apns"), "ab".repeat(32), call, {
          now: () => NOW,
        })
      ).accepted,
    ).toBe(true);
    expect(http2.connect).toHaveBeenCalledWith(
      "https://api.sandbox.push.apple.com",
    );
    const h = session.request.mock.calls[0][0];
    expect(h).toMatchObject({
      ":method": "POST",
      ":path": `/3/device/${"ab".repeat(32)}`,
      "apns-topic": "com.example.agent.voip",
      "apns-push-type": "voip",
      "apns-priority": "10",
      "apns-expiration": "0",
    });
    const j = jwtParts(h.authorization.slice(7));
    expect(j.header).toEqual({ alg: "ES256", typ: "JWT", kid: "ABCDEFGHIJ" });
    expect(j.claims).toEqual({ iss: "KLMNOPQRST", iat: NOW / 1000 });
    expect(j.signature.length).toBe(64);
    expect(
      verify(
        "sha256",
        j.unsigned,
        { key: ec.publicKey, dsaEncoding: "ieee-p1363" },
        j.signature,
      ),
    ).toBe(true);
    expect(JSON.parse(request.end.mock.calls[0][0])).toEqual(call);
    expect(session.close).toHaveBeenCalled();
  });
  it("sends production ordinary aps alerts with the normal topic", async () => {
    const { session, request } = apnsFixture(),
      a = account("apns");
    a.fields.production = "true";
    await sendManagedPush(a, "cd".repeat(32), notification);
    expect(http2.connect).toHaveBeenCalledWith("https://api.push.apple.com");
    expect(session.request.mock.calls[0][0]).toMatchObject({
      "apns-topic": "com.example.agent",
      "apns-push-type": "alert",
    });
    expect(JSON.parse(request.end.mock.calls[0][0]).aps.alert).toEqual({
      title: notification.title,
      body: notification.body,
    });
  });
  it.each([
    [410, "Unregistered", true],
    [400, "BadDeviceToken", true],
    [403, "InvalidProviderToken", false],
  ])("classifies %s/%s", async (s, reason, invalid) => {
    apnsFixture(s, JSON.stringify({ reason }));
    const r = await sendManagedPush(account("apns"), "ab".repeat(32), call);
    expect(r.accepted).toBe(false);
    expect(r.invalidToken === true).toBe(invalid);
  });
  it("rejects missing status, malformed JSON and truncated streams safely", async () => {
    apnsFixture(0);
    expect(
      (await sendManagedPush(account("apns"), "ab".repeat(32), call)).accepted,
    ).toBe(false);
    apnsFixture(400, "bad json");
    expect(
      (await sendManagedPush(account("apns"), "ab".repeat(32), call)).accepted,
    ).toBe(false);
    const { request } = apnsFixture(200, "", true),
      pending = sendManagedPush(account("apns"), "ab".repeat(32), call);
    request.emit("close");
    expect((await pending).accepted).toBe(false);
  });
  it("handles session errors and bounds stalled sessions", async () => {
    let fixture = apnsFixture(200, "", true);
    const failed = sendManagedPush(account("apns"), "ab".repeat(32), call);
    fixture.session.emit("error", Error("private network detail"));
    expect(await failed).toMatchObject({
      accepted: false,
      code: "NETWORK_ERROR",
    });
    vi.useFakeTimers();
    fixture = apnsFixture(200, "", true);
    const pending = sendManagedPush(account("apns"), "ab".repeat(32), call);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ accepted: false, code: "TIMEOUT" });
    expect(fixture.session.destroy).toHaveBeenCalled();
    expect(fixture.request.close).toHaveBeenCalled();
  });
});
describe("domestic notification requests", () => {
  it("MiPush appsecret header and exact regid form", async () => {
    const f = transport(
      json({ code: 0, result: "ok", data: { id: "mi-message" } }),
    );
    expect(
      (
        await sendManagedPush(account("mipush"), TOKEN, notification, {
          fetch: f,
        })
      ).accepted,
    ).toBe(true);
    expect(f.mock.calls[0][0]).toBe(
      "https://api.xmpush.xiaomi.com/v3/message/regid",
    );
    expect(headersAt(f).get("authorization")).toBe("key=fixture-mi-secret");
    expect(Object.fromEntries(formAt(f))).toEqual({
      registration_id: TOKEN,
      restricted_package_name: "com.example.agent",
      payload: JSON.stringify(notification),
      title: notification.title,
      description: notification.body,
      pass_through: "0",
      notify_type: "-1",
      "extra.notify_effect": "1",
    });
  });
  it("HMS client ID auth, app ID URL and notification click_action", async () => {
    const f = transport(
      json({ access_token: "access" }),
      json({ code: "80000000", requestId: "hms-request" }),
    );
    expect(
      (await sendManagedPush(account("hms"), TOKEN, notification, { fetch: f }))
        .accepted,
    ).toBe(true);
    expect(f.mock.calls[0][0]).toBe(
      "https://oauth-login.cloud.huawei.com/oauth2/v3/token",
    );
    expect(Object.fromEntries(formAt(f))).toEqual({
      grant_type: "client_credentials",
      client_id: "54321",
      client_secret: "fixture-hms-secret",
    });
    expect(f.mock.calls[1][0]).toBe(
      "https://push-api.cloud.huawei.com/v1/12345/messages:send",
    );
    expect(bodyAt(f, 1)).toEqual({
      validate_only: false,
      message: {
        token: [TOKEN],
        notification: { title: notification.title, body: notification.body },
        android: { notification: { click_action: { type: 3 } } },
      },
    });
  });
  it("OPPO SHA256 auth and exact unicast form", async () => {
    const f = transport(
      json({ code: 0, data: { auth_token: "access" } }),
      json({ code: 0, data: { messageId: "oppo-message" } }),
    );
    expect(
      (
        await sendManagedPush(account("oppo"), TOKEN, notification, {
          fetch: f,
          now: () => NOW,
        })
      ).accepted,
    ).toBe(true);
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      "https://api.push.oppomobile.com/server/v1/auth",
      "https://api.push.oppomobile.com/server/v1/message/notification/unicast",
    ]);
    expect(Object.fromEntries(formAt(f))).toEqual({
      app_key: "fixture-oppo-key",
      timestamp: String(NOW),
      sign: createHash("sha256")
        .update(`fixture-oppo-key${NOW}fixture-oppo-secret`)
        .digest("hex"),
    });
    expect(formAt(f, 1).get("auth_token")).toBe("access");
    expect(headersAt(f, 1).get("auth_token")).toBeNull();
    expect(JSON.parse(formAt(f, 1).get("message")!)).toEqual({
      target_type: 2,
      target_value: TOKEN,
      notification: {
        app_message_id: expect.any(String),
        title: notification.title,
        content: notification.body,
        click_action_type: 0,
        channel_id: "service",
      },
    });
  });
  it("vivo MD5 auth and exact single send", async () => {
    const f = transport(
      json({ result: 0, authToken: "access" }),
      json({ result: 0, taskId: "vivo-task" }),
    );
    expect(
      (
        await sendManagedPush(account("vivo"), TOKEN, notification, {
          fetch: f,
          now: () => NOW,
        })
      ).accepted,
    ).toBe(true);
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      "https://api-push.vivo.com.cn/message/auth",
      "https://api-push.vivo.com.cn/message/send",
    ]);
    expect(bodyAt(f)).toEqual({
      appId: 12345,
      appKey: "fixture-vivo-key",
      timestamp: NOW,
      sign: createHash("md5")
        .update(`12345fixture-vivo-key${NOW}fixture-vivo-secret`)
        .digest("hex"),
    });
    expect(headersAt(f, 1).get("authToken")).toBe("access");
    expect(bodyAt(f, 1)).toEqual({
      appId: 12345,
      regId: TOKEN,
      title: notification.title,
      content: notification.body,
      notifyType: 4,
      skipType: 1,
      requestId: expect.any(String),
    });
  });
  it("Honor remains explicitly unsupported until the current response contract is verified", async () => {
    for (const message of [notification, call]) {
      const f = vi.fn<typeof fetch>();
      expect(
        await sendManagedPush(account("honor"), TOKEN, message, { fetch: f }),
      ).toMatchObject({ accepted: false, code: "UNSUPPORTED_PROVIDER" });
      expect(f).not.toHaveBeenCalled();
    }
    expect(MANAGED_PUSH_CAPABILITIES.honor).toMatchObject({
      notification: false,
      incoming_call: false,
    });
  });
  it.each(domestic)(
    "%s refuses incoming-call before IO and advertises notification-only",
    async (p) => {
      const f = vi.fn<typeof fetch>();
      expect(MANAGED_PUSH_CAPABILITIES[p]).toMatchObject({
        notification: true,
        incoming_call: false,
      });
      expect(
        await sendManagedPush(account(p), TOKEN, call, { fetch: f }),
      ).toMatchObject({ accepted: false, code: "UNSUPPORTED_MESSAGE_KIND" });
      expect(f).not.toHaveBeenCalled();
    },
  );
});
describe("safety", () => {
  it.each(providers)(
    "disabled %s sends nothing even with invalid config",
    async (p) => {
      const a = account(p);
      a.enabled = false;
      a.fields = {};
      const f = vi.fn<typeof fetch>();
      expect(await sendManagedPush(a, TOKEN, call, { fetch: f })).toMatchObject(
        { accepted: false, code: "ACCOUNT_DISABLED" },
      );
      expect(f).not.toHaveBeenCalled();
      expect(http2.connect).not.toHaveBeenCalled();
    },
  );
  it("never leaks credentials, token, raw vendor errors or network errors and never logs", async () => {
    const logs = ["log", "warn", "error", "info", "debug"].map((m) =>
      vi.spyOn(console, m as "log").mockImplementation(() => {}),
    );
    const secret = `${TOKEN} ${fields.harmony.service_account_json}`;
    for (const response of [
      json({ code: secret, requestId: secret, msg: secret }, 403),
      json({ code: "80200001", msg: secret }, 401),
    ]) {
      const r = await sendManagedPush(account("harmony"), TOKEN, notification, {
        fetch: transport(response),
      });
      expect(JSON.stringify(r)).not.toContain(TOKEN);
      expect(JSON.stringify(r)).not.toContain("PRIVATE KEY");
      expect(r.accepted).toBe(false);
    }
    const f = vi.fn<typeof fetch>().mockRejectedValue(Error(secret));
    expect(
      await sendManagedPush(account("harmony"), TOKEN, notification, {
        fetch: f,
      }),
    ).toMatchObject({ accepted: false, code: "NETWORK_ERROR" });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "null",
    "[]",
    "{}",
    "not-json",
    '{"code":true}',
    '{"code":{"value":"80000000"}}',
  ])("rejects invalid Harmony response: %s", async (raw) => {
    expect(
      (
        await sendManagedPush(account("harmony"), TOKEN, notification, {
          fetch: transport(new Response(raw)),
        })
      ).accepted,
    ).toBe(false);
  });
  it("rejects malformed OAuth tokens without a send request", async () => {
    for (const p of ["fcm", "hms", "oppo", "vivo"] as const) {
      const f = transport(
        json({
          code: 0,
          result: 0,
          access_token: 42,
          authToken: 42,
          data: { auth_token: 42 },
        }),
      );
      expect(
        (await sendManagedPush(account(p), TOKEN, notification, { fetch: f }))
          .accepted,
      ).toBe(false);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it("does not follow redirects or accept HTTP errors carrying a success code", async () => {
    const f = transport(json({ code: "80000000" }, 302));
    expect(
      (
        await sendManagedPush(account("harmony"), TOKEN, notification, {
          fetch: f,
        })
      ).accepted,
    ).toBe(false);
    expect(f.mock.calls[0][1]?.redirect).toBe("error");
  });
  it("aborts hung fetch and body even if a transport ignores cancellation", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const f = vi.fn<typeof fetch>().mockImplementation(async (_u, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    });
    const pending = sendManagedPush(account("harmony"), TOKEN, notification, {
      fetch: f,
    });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ accepted: false, code: "TIMEOUT" });
    expect(signal?.aborted).toBe(true);
    const stalled = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const bodyPending = sendManagedPush(
      account("harmony"),
      TOKEN,
      notification,
      { fetch: stalled },
    );
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await bodyPending).toMatchObject({
      accepted: false,
      code: "TIMEOUT",
    });
  });
  it("validates tokens/call IDs and returns safe config errors before IO", async () => {
    const f = vi.fn<typeof fetch>();
    for (const t of ["", "token,other", "token;other", "token\nheader"])
      expect(
        (
          await sendManagedPush(account("harmony"), t, notification, {
            fetch: f,
          })
        ).accepted,
      ).toBe(false);
    expect(
      (
        await sendManagedPush(
          account("harmony"),
          TOKEN,
          { ...call, call_id: undefined },
          { fetch: f },
        )
      ).accepted,
    ).toBe(false);
    const a = account("harmony");
    a.fields.service_account_json = "private-secret-invalid";
    expect(
      await sendManagedPush(a, TOKEN, notification, { fetch: f }),
    ).toMatchObject({ accepted: false, code: "INVALID_ACCOUNT" });
    expect(f).not.toHaveBeenCalled();
  });
  it("bounds response bytes and strips echoed success IDs", async () => {
    expect(
      (
        await sendManagedPush(account("harmony"), TOKEN, notification, {
          fetch: transport(new Response("x".repeat(70_000))),
        })
      ).accepted,
    ).toBe(false);
    expect(
      JSON.stringify(
        await sendManagedPush(account("harmony"), TOKEN, notification, {
          fetch: transport(json({ code: "80000000", requestId: TOKEN })),
        }),
      ),
    ).not.toContain(TOKEN);
  });
});

describe("transport isolation and vendor failures", () => {
  it.each(["mipush", "hms", "oppo", "vivo"] as const)(
    "%s never returns vendor error text or echoed IDs",
    async (provider) => {
      const secret = TOKEN + "PRIVATE-ERROR-CONTENT";
      const errorBody = {
        code: secret,
        result: secret,
        reason: secret,
        desc: secret,
        msg: secret,
        requestId: secret,
        data: { messageId: secret, id: secret },
      };
      const auth =
        provider === "vivo"
          ? json({ result: 0, authToken: "access" })
          : provider === "oppo"
            ? json({ code: 0, data: { auth_token: "access" } })
            : json({ access_token: "access" });
      const f =
        provider === "mipush"
          ? transport(json(errorBody, 403))
          : transport(auth, json(errorBody, 403));
      const result = await sendManagedPush(
        account(provider),
        TOKEN,
        notification,
        { fetch: f },
      );
      expect(result).toMatchObject({ accepted: false });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(result.requestId).toBeUndefined();
      for (const [, init] of f.mock.calls) {
        expect(init?.redirect).toBe("error");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
      }
    },
  );
  it("suppresses APNs raw reason and echoed response IDs", async () => {
    apnsFixture(
      400,
      JSON.stringify({ reason: TOKEN, details: fields.apns.private_key }),
    );
    const result = await sendManagedPush(
      account("apns"),
      "ab".repeat(32),
      call,
    );
    expect(result).toMatchObject({
      accepted: false,
      code: "PROVIDER_REJECTED",
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
    expect(result.requestId).toBeUndefined();
  });
  it("shares one deadline across authentication and send", async () => {
    vi.useFakeTimers();
    let sendSignal: AbortSignal | undefined;
    const f = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        return json({ access_token: "access" });
      })
      .mockImplementationOnce(async (_url, init) => {
        sendSignal = init?.signal ?? undefined;
        return new Promise(() => {});
      });
    const pending = sendManagedPush(account("hms"), TOKEN, notification, {
      fetch: f,
    });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ accepted: false, code: "TIMEOUT" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(sendSignal?.aborted).toBe(true);
  });
  it("does not reuse an OAuth token across accounts or credential updates", async () => {
    const first = transport(
      json({ access_token: "first-access" }),
      json({ name: "projects/fixture-project/messages/1" }),
    );
    const second = transport(
      json({ access_token: "second-access" }),
      json({ name: "projects/target-project/messages/2" }),
    );
    const a = account("fcm");
    await sendManagedPush(a, TOKEN, notification, { fetch: first });
    a.fields.project_id = "target-project";
    await sendManagedPush(a, TOKEN, notification, { fetch: second });
    expect(headersAt(first, 1).get("authorization")).toBe(
      "Bearer first-access",
    );
    expect(headersAt(second, 1).get("authorization")).toBe(
      "Bearer second-access",
    );
  });
  it("vivo includes appId on send for authentication/app consistency", async () => {
    const f = transport(
      json({ result: 0, authToken: "access" }),
      json({ result: 0, taskId: "vivo-task" }),
    );
    await sendManagedPush(account("vivo"), TOKEN, notification, { fetch: f });
    expect(bodyAt(f, 1).appId).toBe(12345);
  });
});
