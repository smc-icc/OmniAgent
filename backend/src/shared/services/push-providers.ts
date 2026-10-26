import {
  constants,
  createHash,
  createPrivateKey,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  connect as http2Connect,
  type ClientHttp2Session,
  type ClientHttp2Stream,
} from "node:http2";

export type ManagedPushProvider =
  "harmony" | "fcm" | "apns" | "mipush" | "hms" | "oppo" | "vivo" | "honor";
export interface ManagedPushAccount {
  id: string;
  provider: ManagedPushProvider;
  name: string;
  bundle_id: string;
  enabled: boolean;
  fields: Record<string, string>;
}
export interface ManagedPushMessage {
  kind: "incoming_call" | "notification";
  title: string;
  body: string;
  call_id?: string;
  call_id_type?: number | string;
  caller?: string;
  called?: string;
}
/** Acceptance is by the provider, never proof of device delivery or cold-start. */
export interface PushSendResult {
  accepted: boolean;
  invalidToken?: boolean;
  code?: string;
  requestId?: string;
  reason?: string;
}
export interface ManagedPushOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

export const MANAGED_PUSH_CAPABILITIES = Object.freeze({
  harmony: {
    notification: true,
    incoming_call: true,
    note: "In-app call push requires Huawei entitlement and client integration; wake is not guaranteed.",
  },
  fcm: {
    notification: true,
    incoming_call: true,
    note: "High priority data requires client integration; delivery and wake are not guaranteed.",
  },
  apns: {
    notification: true,
    incoming_call: true,
    note: "VoIP requires a PushKit token and CallKit integration; alerts require an ordinary APNs token.",
  },
  mipush: {
    notification: true,
    incoming_call: false,
    note: "Ordinary notification only; no verified incoming-call wake transport.",
  },
  hms: {
    notification: true,
    incoming_call: false,
    note: "Ordinary Android notification only; no verified incoming-call wake transport.",
  },
  oppo: {
    notification: true,
    incoming_call: false,
    note: "Ordinary notification only; configured channel must exist in the client.",
  },
  vivo: {
    notification: true,
    incoming_call: false,
    note: "Ordinary notification only; subject to vendor classification and quotas.",
  },
  honor: {
    notification: false,
    incoming_call: false,
    note: "Transport disabled pending verification of the current official server API contract.",
  },
} satisfies Record<
  ManagedPushProvider,
  { notification: boolean; incoming_call: boolean; note: string }
>);

const FIELD_NAMES: Record<ManagedPushProvider, readonly string[]> = {
  harmony: ["project_id", "app_id", "service_account_json"],
  fcm: ["project_id", "service_account_json"],
  apns: ["bundle_id", "key_id", "team_id", "private_key", "production"],
  mipush: ["app_id", "app_key", "app_secret"],
  hms: ["app_id", "client_id", "client_secret"],
  oppo: ["app_key", "master_secret", "channel_id"],
  vivo: ["app_id", "app_key", "app_secret"],
  honor: ["app_id", "client_id", "client_secret"],
};
const SEND_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 65_536;
const OAUTH_HUAWEI = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
const OAUTH_GOOGLE = "https://oauth2.googleapis.com/token";
const BUNDLE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidResponse();
  return value as JsonObject;
}
function serviceAccount(raw: string): JsonObject {
  return object(JSON.parse(raw));
}
function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 65_536)
    throw new InvalidResponse();
  return value;
}
function keyFromPem(raw: string): KeyObject {
  return createPrivateKey(raw.replace(/\\n/g, "\n"));
}
function rsaKey(raw: string, bits: number): KeyObject {
  const key = keyFromPem(raw);
  if (
    key.asymmetricKeyType !== "rsa" ||
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < bits
  )
    throw new InvalidResponse();
  return key;
}
function numericId(value: unknown): boolean {
  return typeof value === "string" && /^[1-9]\d{0,31}$/.test(value);
}
/** Only private JSON/PEM strings are accepted. No paths, custom URLs, or raw parse errors escape. */
export function validatePushAccountFields(
  provider: ManagedPushProvider,
  fields: Record<string, string>,
): void {
  try {
    if (
      !own(FIELD_NAMES, provider) ||
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields)
    )
      throw new Error();
    const names = FIELD_NAMES[provider];
    if (Object.keys(fields).some((key) => !names.includes(key)))
      throw new Error();
    for (const name of names) {
      if (!own(fields, name)) throw new Error();
      requiredString(fields[name]);
      if (
        name !== "private_key" &&
        name !== "service_account_json" &&
        /[\x00-\x20\x7f]/.test(fields[name])
      )
        throw new Error();
    }
    if (provider === "harmony") {
      const sa = serviceAccount(fields.service_account_json);
      if (
        !numericId(fields.project_id) ||
        !numericId(fields.app_id) ||
        sa.project_id !== fields.project_id
      )
        throw new Error();
      for (const k of ["key_id", "sub_account", "private_key"])
        requiredString(sa[k]);
      const key = rsaKey(String(sa.private_key), 4096);
      if (key.asymmetricKeyDetails?.modulusLength !== 4096) throw new Error();
    } else if (provider === "fcm") {
      const sa = serviceAccount(fields.service_account_json);
      if (
        sa.type !== "service_account" ||
        !/^[a-z][a-z0-9-]{3,62}$/.test(fields.project_id) ||
        !/^[^\s@]+@[^\s@]+$/.test(requiredString(sa.client_email))
      )
        throw new Error();
      rsaKey(requiredString(sa.private_key), 2048);
    } else if (provider === "apns") {
      const key = keyFromPem(fields.private_key);
      if (
        key.asymmetricKeyType !== "ec" ||
        key.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
        !BUNDLE.test(fields.bundle_id) ||
        !/^[A-Za-z0-9]{10}$/.test(fields.key_id) ||
        !/^[A-Za-z0-9]{10}$/.test(fields.team_id) ||
        !["true", "false"].includes(fields.production)
      )
        throw new Error();
    } else {
      if (own(fields, "app_id") && !numericId(fields.app_id)) throw new Error();
      if (provider === "vivo" && !Number.isSafeInteger(Number(fields.app_id)))
        throw new Error();
    }
  } catch {
    throw new Error("Invalid push account fields");
  }
}

class InvalidResponse extends Error {}
class ProviderRejected extends Error {}
class DeadlineExceeded extends Error {}
const failure = (
  code: string,
  reason: string,
  invalidToken = false,
): PushSendResult => ({
  accepted: false,
  code,
  reason,
  ...(invalidToken ? { invalidToken: true } : {}),
});
function jwt(
  header: object,
  claims: object,
  key: KeyObject,
  mode: "pss" | "rsa" | "ec",
): string {
  const unsigned = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  const signature = sign(
    "sha256",
    Buffer.from(unsigned),
    mode === "pss"
      ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }
      : mode === "ec"
        ? { key, dsaEncoding: "ieee-p1363" }
        : key,
  );
  return `${unsigned}.${signature.toString("base64url")}`;
}
interface Context {
  fetch: typeof fetch;
  now: number;
  signal: AbortSignal;
  safeId: (value: unknown) => string | undefined;
}
function accepted(
  ctx: Context,
  code?: string,
  requestId?: unknown,
): PushSendResult {
  const id = ctx.safeId(requestId);
  return {
    accepted: true,
    ...(code ? { code } : {}),
    ...(id ? { requestId: id } : {}),
  };
}
async function readJson(
  response: Response,
  signal: AbortSignal,
): Promise<JsonObject> {
  if (!response.body) throw new InvalidResponse();
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DeadlineExceeded();
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new InvalidResponse();
      }
      chunks.push(part.value);
    }
    try {
      return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new InvalidResponse();
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
async function post(
  ctx: Context,
  url: string,
  body: object | URLSearchParams,
  headers: Record<string, string> = {},
) {
  if (ctx.signal.aborted) throw new DeadlineExceeded();
  const form = body instanceof URLSearchParams;
  const response = await ctx.fetch(url, {
    method: "POST",
    redirect: "error",
    signal: ctx.signal,
    headers: {
      "Content-Type": form
        ? "application/x-www-form-urlencoded"
        : "application/json",
      ...headers,
    },
    body: form ? body : JSON.stringify(body),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await readJson(response, ctx.signal),
  };
}
function accessToken(value: unknown): string {
  const token = requiredString(value);
  if (token.length > 16_384 || /[\s\x00-\x1f\x7f]/.test(token))
    throw new InvalidResponse();
  return token;
}
async function oauth(
  ctx: Context,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const r = await post(ctx, url, new URLSearchParams(params));
  if (!r.ok) throw new ProviderRejected();
  return accessToken(r.body.access_token);
}

// Official HarmonyOS Push Kit references (scenario examples and call payload):
// https://developer.huawei.com/consumer/en/doc/harmonyos-references/push-scenariozed-api-request-example
// https://developer.huawei.com/consumer/en/doc/harmonyos-references/push-scenariozed-api-request-param
// https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/push-voip
async function harmony(
  a: ManagedPushAccount,
  token: string,
  message: ManagedPushMessage,
  ctx: Context,
): Promise<PushSendResult> {
  const sa = serviceAccount(a.fields.service_account_json),
    iat = Math.floor(ctx.now / 1000);
  const auth = jwt(
    { alg: "PS256", typ: "JWT", kid: sa.key_id },
    { iss: sa.sub_account, aud: OAUTH_HUAWEI, iat, exp: iat + 3600 },
    rsaKey(String(sa.private_key), 4096),
    "pss",
  );
  const incoming = message.kind === "incoming_call";
  const r = await post(
    ctx,
    `https://push-api.cloud.huawei.com/v3/${a.fields.project_id}/messages:send`,
    {
      payload: incoming
        ? { extraData: JSON.stringify(message) }
        : {
            notification: {
              category: "IM",
              title: message.title,
              body: message.body,
              clickAction: { actionType: 0 },
            },
          },
      target: { token: [token] },
      pushOptions: { testMessage: false, ...(incoming ? { ttl: 45 } : {}) },
    },
    { Authorization: `Bearer ${auth}`, "push-type": incoming ? "10" : "0" },
  );
  return r.ok && r.body.code === "80000000"
    ? accepted(ctx, "80000000", r.body.requestId)
    : failure("PROVIDER_REJECTED", "Provider rejected push request");
}
// https://firebase.google.com/docs/cloud-messaging/auth-server
// https://firebase.google.com/docs/cloud-messaging/error-codes
// Firebase HTTP v1 uses OAuth service-account assertions. token_uri in JSON is never trusted.
async function fcm(
  a: ManagedPushAccount,
  token: string,
  message: ManagedPushMessage,
  ctx: Context,
): Promise<PushSendResult> {
  const sa = serviceAccount(a.fields.service_account_json),
    iat = Math.floor(ctx.now / 1000);
  const assertion = jwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: OAUTH_GOOGLE,
      iat,
      exp: iat + 3600,
    },
    rsaKey(String(sa.private_key), 2048),
    "rsa",
  );
  const auth = await oauth(ctx, OAUTH_GOOGLE, {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const incoming = message.kind === "incoming_call";
  const data = Object.fromEntries(
    Object.entries(message)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  const r = await post(
    ctx,
    `https://fcm.googleapis.com/v1/projects/${a.fields.project_id}/messages:send`,
    {
      message: {
        token,
        data,
        ...(incoming
          ? { android: { priority: "HIGH", ttl: "45s", direct_boot_ok: true } }
          : { notification: { title: message.title, body: message.body } }),
      },
    },
    { Authorization: `Bearer ${auth}` },
  );
  if (
    r.ok &&
    typeof r.body.name === "string" &&
    /^projects\/[^/]+\/messages\/[^/]+$/.test(r.body.name)
  )
    return accepted(ctx, undefined, r.body.name);
  const error = r.body.error;
  const details =
    error && typeof error === "object"
      ? (error as JsonObject).details
      : undefined;
  const invalid =
    Array.isArray(details) &&
    details.some(
      (detail) =>
        detail &&
        typeof detail === "object" &&
        detail["@type"] ===
          "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
        detail.errorCode === "UNREGISTERED",
    );
  return failure(
    invalid ? "UNREGISTERED" : "PROVIDER_REJECTED",
    "Provider rejected push request",
    invalid,
  );
}
// https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
// Apple provider API requires HTTP/2, ES256 P1363, and the appropriate PushKit/alert token.
function apns(
  a: ManagedPushAccount,
  token: string,
  message: ManagedPushMessage,
  ctx: Context,
): Promise<PushSendResult> {
  const iat = Math.floor(ctx.now / 1000),
    incoming = message.kind === "incoming_call";
  const auth = jwt(
    { alg: "ES256", typ: "JWT", kid: a.fields.key_id },
    { iss: a.fields.team_id, iat },
    keyFromPem(a.fields.private_key),
    "ec",
  );
  return new Promise((resolve) => {
    let session: ClientHttp2Session | undefined,
      request: ClientHttp2Stream | undefined;
    let done = false,
      status = 0,
      responseId: unknown,
      bytes = 0;
    const chunks: Buffer[] = [];
    const finish = (result: PushSendResult, destroy = false) => {
      if (done) return;
      done = true;
      ctx.signal.removeEventListener("abort", abort);
      try {
        request?.close();
      } catch {
        /* Cleanup cannot expose transport details. */
      }
      try {
        if (destroy) session?.destroy();
        else session?.close();
      } catch {
        /* Cleanup only. */
      }
      resolve(result);
    };
    const abort = () =>
      finish(failure("TIMEOUT", "Push request timed out"), true);
    const network = () =>
      finish(failure("NETWORK_ERROR", "Push transport failed"), true);
    ctx.signal.addEventListener("abort", abort, { once: true });
    if (ctx.signal.aborted) {
      abort();
      return;
    }
    try {
      session = http2Connect(
        a.fields.production === "true"
          ? "https://api.push.apple.com"
          : "https://api.sandbox.push.apple.com",
      );
      session.on("error", network);
      session.on("close", () => {
        if (!done) network();
      });
      request = session.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${auth}`,
        "apns-topic": `${a.fields.bundle_id}${incoming ? ".voip" : ""}`,
        "apns-push-type": incoming ? "voip" : "alert",
        "apns-priority": "10",
        "apns-expiration": "0",
        "content-type": "application/json",
      });
      request.on("error", network);
      request.on("aborted", network);
      request.on("close", () => {
        if (!done) network();
      });
      request.on("response", (headers) => {
        status = Number(headers[":status"]);
        responseId = headers["apns-id"];
      });
      request.on("data", (chunk: Buffer | string) => {
        const data = Buffer.from(chunk);
        bytes += data.length;
        if (bytes > MAX_RESPONSE_BYTES)
          finish(
            failure("INVALID_RESPONSE", "Invalid provider response"),
            true,
          );
        else chunks.push(data);
      });
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (status === 200 && !raw.trim()) {
          finish(accepted(ctx, undefined, responseId));
          return;
        }
        let reason: unknown;
        try {
          reason = object(JSON.parse(raw)).reason;
        } catch {
          finish(failure("INVALID_RESPONSE", "Invalid provider response"));
          return;
        }
        const invalid =
          (status === 410 && reason === "Unregistered") ||
          (status === 400 && reason === "BadDeviceToken");
        finish(
          failure(
            invalid ? String(reason) : "PROVIDER_REJECTED",
            "Provider rejected push request",
            invalid,
          ),
        );
      });
      request.end(
        JSON.stringify(
          incoming
            ? message
            : {
                aps: {
                  alert: { title: message.title, body: message.body },
                  sound: "default",
                },
              },
        ),
      );
    } catch {
      network();
    }
  });
}

// Xiaomi official HTTP v3 regid API. app_secret authenticates the app; package restricts the target.
async function mipush(
  a: ManagedPushAccount,
  token: string,
  m: ManagedPushMessage,
  ctx: Context,
): Promise<PushSendResult> {
  const r = await post(
    ctx,
    "https://api.xmpush.xiaomi.com/v3/message/regid",
    new URLSearchParams({
      registration_id: token,
      restricted_package_name: a.bundle_id,
      payload: JSON.stringify(m),
      title: m.title,
      description: m.body,
      pass_through: "0",
      notify_type: "-1",
      "extra.notify_effect": "1",
    }),
    { Authorization: `key=${a.fields.app_secret}` },
  );
  return r.ok && r.body.code === 0 && r.body.result === "ok"
    ? accepted(ctx, "0", (r.body.data as JsonObject | undefined)?.id)
    : failure("PROVIDER_REJECTED", "Provider rejected push request");
}
async function hms(
  a: ManagedPushAccount,
  token: string,
  m: ManagedPushMessage,
  ctx: Context,
): Promise<PushSendResult> {
  const auth = await oauth(ctx, OAUTH_HUAWEI, {
    grant_type: "client_credentials",
    client_id: a.fields.client_id,
    client_secret: a.fields.client_secret,
  });
  const r = await post(
    ctx,
    `https://push-api.cloud.huawei.com/v1/${a.fields.app_id}/messages:send`,
    {
      validate_only: false,
      message: {
        token: [token],
        notification: { title: m.title, body: m.body },
        android: { notification: { click_action: { type: 3 } } },
      },
    },
    { Authorization: `Bearer ${auth}` },
  );
  return r.ok && r.body.code === "80000000"
    ? accepted(ctx, "80000000", r.body.requestId)
    : failure("PROVIDER_REJECTED", "Provider rejected push request");
}
// OPPO official server API v1.7, sections 3.1 and 4.1:
// https://storepic.oppomobile.com/openplat/resource/201908/23/OPPO%E6%8E%A8%E9%80%81%E5%B9%B3%E5%8F%B0%E6%9C%8D%E5%8A%A1%E7%AB%AFAPI-V1.7.pdf
// auth_token is a common FORM parameter (not a header).
async function oppo(
  a: ManagedPushAccount,
  token: string,
  m: ManagedPushMessage,
  ctx: Context,
): Promise<PushSendResult> {
  const timestamp = String(ctx.now);
  const auth = await post(
    ctx,
    "https://api.push.oppomobile.com/server/v1/auth",
    new URLSearchParams({
      app_key: a.fields.app_key,
      timestamp,
      sign: createHash("sha256")
        .update(a.fields.app_key + timestamp + a.fields.master_secret)
        .digest("hex"),
    }),
  );
  if (!auth.ok || auth.body.code !== 0) throw new ProviderRejected();
  const authToken = accessToken(object(auth.body.data).auth_token);
  const r = await post(
    ctx,
    "https://api.push.oppomobile.com/server/v1/message/notification/unicast",
    new URLSearchParams({
      auth_token: authToken,
      message: JSON.stringify({
        target_type: 2,
        target_value: token,
        notification: {
          app_message_id: randomUUID(),
          title: m.title,
          content: m.body,
          click_action_type: 0,
          channel_id: a.fields.channel_id,
        },
      }),
    }),
  );
  return r.ok && r.body.code === 0
    ? accepted(ctx, "0", (r.body.data as JsonObject | undefined)?.messageId)
    : failure("PROVIDER_REJECTED", "Provider rejected push request");
}
async function vivo(
  a: ManagedPushAccount,
  token: string,
  m: ManagedPushMessage,
  ctx: Context,
): Promise<PushSendResult> {
  const auth = await post(ctx, "https://api-push.vivo.com.cn/message/auth", {
    appId: Number(a.fields.app_id),
    appKey: a.fields.app_key,
    timestamp: ctx.now,
    sign: createHash("md5")
      .update(
        a.fields.app_id + a.fields.app_key + ctx.now + a.fields.app_secret,
      )
      .digest("hex"),
  });
  if (!auth.ok || auth.body.result !== 0) throw new ProviderRejected();
  const r = await post(
    ctx,
    "https://api-push.vivo.com.cn/message/send",
    {
      appId: Number(a.fields.app_id),
      regId: token,
      title: m.title,
      content: m.body,
      notifyType: 4,
      skipType: 1,
      requestId: randomUUID(),
    },
    { authToken: accessToken(auth.body.authToken) },
  );
  return r.ok && r.body.result === 0
    ? accepted(ctx, "0", r.body.taskId)
    : failure("PROVIDER_REJECTED", "Provider rejected push request");
}

/** Pure account-based send: no env, filesystem credentials, DB, logs, or global auth cache. */
export async function sendManagedPush(
  account: ManagedPushAccount,
  token: string,
  message: ManagedPushMessage,
  options: ManagedPushOptions = {},
): Promise<PushSendResult> {
  if (!account || account.enabled !== true)
    return failure("ACCOUNT_DISABLED", "Push account is disabled");
  try {
    validatePushAccountFields(account.provider, account.fields);
    if (
      !BUNDLE.test(account.bundle_id) ||
      (account.provider === "apns" &&
        account.bundle_id !== account.fields.bundle_id)
    )
      throw new Error();
  } catch {
    return failure("INVALID_ACCOUNT", "Invalid push account fields");
  }
  if (
    !message ||
    !["notification", "incoming_call"].includes(message.kind) ||
    typeof message.title !== "string" ||
    typeof message.body !== "string" ||
    message.title.length > 4096 ||
    message.body.length > 16_384 ||
    (message.kind === "incoming_call" &&
      (!message.call_id || typeof message.call_id !== "string"))
  )
    return failure("INVALID_MESSAGE", "Invalid push message");
  if (
    typeof token !== "string" ||
    !token ||
    token.length > 4096 ||
    /[\s\x00-\x1f\x7f,;]/.test(token) ||
    (account.provider === "apns" && !/^[a-fA-F0-9]{32,512}$/.test(token))
  )
    return failure("INVALID_TOKEN", "Invalid push token");
  const capability = MANAGED_PUSH_CAPABILITIES[account.provider];
  if (!capability.notification)
    return failure(
      "UNSUPPORTED_PROVIDER",
      "Provider transport is not verified",
    );
  if (message.kind === "incoming_call" && !capability.incoming_call)
    return failure(
      "UNSUPPORTED_MESSAGE_KIND",
      "Provider supports ordinary notifications only",
    );
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DeadlineExceeded());
      controller.abort();
    }, SEND_TIMEOUT_MS);
  });
  try {
    const now = (options.now ?? Date.now)();
    if (!Number.isFinite(now) || now < 0)
      return failure("INVALID_MESSAGE", "Invalid push request time");
    const sensitive = [token, ...Object.values(account.fields)];
    for (const name of ["service_account_json"]) {
      if (account.fields[name]) {
        try {
          sensitive.push(
            ...Object.values(serviceAccount(account.fields[name])).filter(
              (v): v is string => typeof v === "string",
            ),
          );
        } catch {
          /* Validated above. */
        }
      }
    }
    const ctx: Context = {
      fetch: options.fetch ?? globalThis.fetch,
      signal: controller.signal,
      now,
      safeId: (value) =>
        typeof value === "string" &&
        /^[A-Za-z0-9_./:-]{1,256}$/.test(value) &&
        !sensitive.some((secret) => secret && value.includes(secret))
          ? value
          : undefined,
    };
    const adapters = { harmony, fcm, apns, mipush, hms, oppo, vivo };
    return await Promise.race([
      adapters[account.provider as keyof typeof adapters](
        account,
        token,
        message,
        ctx,
      ),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof DeadlineExceeded || controller.signal.aborted)
      return failure("TIMEOUT", "Push request timed out");
    if (error instanceof InvalidResponse || error instanceof SyntaxError)
      return failure("INVALID_RESPONSE", "Invalid provider response");
    if (error instanceof ProviderRejected)
      return failure("PROVIDER_REJECTED", "Provider rejected push request");
    return failure("NETWORK_ERROR", "Push transport failed");
  } finally {
    clearTimeout(timer);
  }
}
