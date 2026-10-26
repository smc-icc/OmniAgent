import { managedPushRuntime, refreshManagedPushConfig } from './push-account-config.js';
import type { ManagedPushProvider } from './push-providers.js';
import { createSign, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect as http2Connect, type ClientHttp2Session } from 'node:http2';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../plugins/db.js';
import { env } from '../../config/env.js';

/**
 * 离线推送。移动 App 退到后台或被系统回收后，Socket 已不可达，
 * 来电必须靠高优先级/VoIP 推送把 App 拉起来注册并弹来电界面。
 *
 * 设备 token 复用 notification_subscriptions 表，subscription_type 区分厂商通道。
 */

export type PushProvider = ManagedPushProvider;

/** notification_subscriptions.subscription_type：0 预留给浏览器 Web Push。 */
export const PUSH_SUBSCRIPTION_TYPE: Record<PushProvider, number> = {
  fcm: 1,
  apns: 2,
  harmony: 3,
  mipush: 4,
  hms: 5,
  oppo: 6,
  vivo: 7,
  honor: 8,
};

const PROVIDER_BY_TYPE = new Map<number, PushProvider>(
  Object.entries(PUSH_SUBSCRIPTION_TYPE).map(([p, t]) => [t, p as PushProvider]),
);

export interface PushDevice {
  provider: PushProvider;
  token: string;
  voip: boolean;
  platform: string;
  bundleId: string;
}

export interface IncomingCallPush {
  kind: 'incoming_call';
  call_id: string;
  caller: string;
  called: string;
  /** CCS 的 CallIDType，App 关联双腿时要原样回传 */
  call_id_type: number;
  /** 业务标题，鸿蒙/Android 通知栏展示 */
  title: string;
  body: string;
}

function deviceIdentifier(provider: PushProvider, token: string): string {
  return `push:${provider}:${token}`;
}

export async function registerPushDevice(input: {
  userId: number;
  provider: PushProvider;
  token: string;
  voip?: boolean;
  platform?: string;
  appVersion?: string;
  bundleId?: string;
}): Promise<{ identifier: string }> {
  const identifier = deviceIdentifier(input.provider, input.token);
  const attributes = {
    provider: input.provider,
    token: input.token,
    voip: input.voip === true,
    platform: input.platform ?? '',
    app_version: input.appVersion ?? '',
    bundle_id: input.bundleId || 'com.smcloud.omniagent',
  };
  await prisma.notification_subscriptions.upsert({
    where: { identifier },
    create: {
      user_id: input.userId,
      subscription_type: PUSH_SUBSCRIPTION_TYPE[input.provider],
      subscription_attributes: attributes,
      identifier,
    },
    // 同一 token 换绑到新坐席：必须改 user_id，否则来电推给上一个人
    update: {
      user_id: input.userId,
      subscription_type: PUSH_SUBSCRIPTION_TYPE[input.provider],
      subscription_attributes: attributes,
    },
  });
  return { identifier };
}

export async function unregisterPushDevice(userId: number, token: string): Promise<void> {
  await prisma.notification_subscriptions.deleteMany({
    where: {
      user_id: userId,
      identifier: { in: (Object.keys(PUSH_SUBSCRIPTION_TYPE) as PushProvider[]).map((p) => deviceIdentifier(p, token)) },
    },
  });
}

export async function listPushDevices(userId: number): Promise<PushDevice[]> {
  const subs = await prisma.notification_subscriptions.findMany({
    where: { user_id: userId, subscription_type: { in: Object.values(PUSH_SUBSCRIPTION_TYPE) } },
  });
  const devices: PushDevice[] = [];
  for (const sub of subs) {
    const provider = PROVIDER_BY_TYPE.get(sub.subscription_type);
    if (!provider) continue;
    const attrs = (sub.subscription_attributes ?? {}) as Record<string, unknown>;
    const token = String(attrs.token ?? '');
    if (!token) continue;
    devices.push({
      provider,
      token,
      voip: attrs.voip === true,
      platform: String(attrs.platform ?? ''),
      bundleId: String(attrs.bundle_id || 'com.smcloud.omniagent'),
    });
  }
  return devices;
}

/** token 被厂商判定为失效时清掉，避免每次来电都重试一轮。 */
async function dropDevice(provider: PushProvider, token: string): Promise<void> {
  await prisma.notification_subscriptions
    .deleteMany({ where: { identifier: deviceIdentifier(provider, token) } })
    .catch(() => undefined);
}

// ── JWT 工具（不引入额外依赖）──

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwt(header: object, claims: object, privateKeyPem: string, algorithm: 'RSA-SHA256' | 'SHA256', ecdsa: boolean): string {
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign(algorithm);
  signer.update(unsigned);
  const key = createPrivateKey(privateKeyPem);
  const signature = ecdsa
    ? signer.sign({ key, dsaEncoding: 'ieee-p1363' })
    : signer.sign(key);
  return `${unsigned}.${base64url(signature)}`;
}

// ── FCM HTTP v1 ──

interface FcmServiceAccount { client_email: string; private_key: string; project_id?: string }

let fcmAccount: FcmServiceAccount | null | undefined;
let fcmToken: { value: string; expiresAt: number } | null = null;

function loadFcmAccount(): FcmServiceAccount | null {
  if (fcmAccount !== undefined) return fcmAccount;
  const raw = env.PUSH_FCM_CREDENTIALS.trim();
  if (!raw) {
    fcmAccount = null;
    return null;
  }
  try {
    const json = raw.startsWith('{') ? raw : readFileSync(raw, 'utf8');
    const parsed = JSON.parse(json) as FcmServiceAccount;
    fcmAccount = parsed.client_email && parsed.private_key ? parsed : null;
  } catch {
    fcmAccount = null;
  }
  return fcmAccount;
}

async function fcmAccessToken(): Promise<string | null> {
  const account = loadFcmAccount();
  if (!account) return null;
  if (fcmToken && fcmToken.expiresAt > Date.now() + 60_000) return fcmToken.value;

  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
    'RSA-SHA256',
    false,
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) {
    console.warn('[push] FCM token failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  fcmToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}

async function sendFcm(token: string, call: IncomingCallPush): Promise<boolean> {
  const accessToken = await fcmAccessToken();
  const projectId = env.PUSH_FCM_PROJECT_ID || loadFcmAccount()?.project_id || '';
  if (!accessToken || !projectId) return false;

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        // data-only + high priority：由 App 自己弹全屏来电界面，避免系统通知折叠
        data: {
          kind: call.kind,
          call_id: call.call_id,
          call_id_type: String(call.call_id_type),
          caller: call.caller,
          called: call.called,
        },
        android: {
          priority: 'HIGH',
          ttl: '45s',
          direct_boot_ok: true,
        },
      },
    }),
  });
  if (res.ok) return true;
  const text = await res.text().catch(() => '');
  if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text)) {
    await dropDevice('fcm', token);
  }
  console.warn('[push] FCM send failed', res.status, text);
  return false;
}

// ── APNs VoIP（HTTP/2 + ES256 token）──

let apnsSession: ClientHttp2Session | null = null;
let apnsJwt: { value: string; expiresAt: number } | null = null;

function apnsAuthToken(): string | null {
  if (!env.PUSH_APNS_KEY || !env.PUSH_APNS_KEY_ID || !env.PUSH_APNS_TEAM_ID) return null;
  if (apnsJwt && apnsJwt.expiresAt > Date.now() + 60_000) return apnsJwt.value;
  const keyPem = env.PUSH_APNS_KEY.includes('BEGIN')
    ? env.PUSH_APNS_KEY.replace(/\\n/g, '\n')
    : readFileSync(env.PUSH_APNS_KEY, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const value = signJwt(
    { alg: 'ES256', kid: env.PUSH_APNS_KEY_ID, typ: 'JWT' },
    { iss: env.PUSH_APNS_TEAM_ID, iat: now },
    keyPem,
    'SHA256',
    true,
  );
  // Apple 要求 token 不超过 1 小时，实际按 50 分钟轮换
  apnsJwt = { value, expiresAt: Date.now() + 50 * 60_000 };
  return value;
}

function apnsConnection(): ClientHttp2Session {
  if (apnsSession && !apnsSession.closed && !apnsSession.destroyed) return apnsSession;
  const host = env.PUSH_APNS_PRODUCTION ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
  apnsSession = http2Connect(`https://${host}:443`);
  apnsSession.on('error', (err) => console.warn('[push] APNs session error', err.message));
  apnsSession.on('close', () => { apnsSession = null; });
  return apnsSession;
}

async function sendApnsVoip(token: string, call: IncomingCallPush): Promise<boolean> {
  const auth = apnsAuthToken();
  if (!auth || !env.PUSH_APNS_BUNDLE_ID) return false;

  const payload = JSON.stringify({
    kind: call.kind,
    call_id: call.call_id,
    call_id_type: call.call_id_type,
    caller: call.caller,
    called: call.called,
  });

  return new Promise<boolean>((resolve) => {
    const req = apnsConnection().request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${auth}`,
      // VoIP 必须用 bundle-id.voip 作为 topic，且 push-type=voip、priority=10
      'apns-topic': `${env.PUSH_APNS_BUNDLE_ID}.voip`,
      'apns-push-type': 'voip',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 45),
      'apns-id': randomUUID(),
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    let status = 0;
    let body = '';
    req.on('response', (headers) => { status = Number(headers[':status'] ?? 0); });
    req.on('data', (chunk) => { body += chunk; });
    req.on('error', (err) => {
      console.warn('[push] APNs send error', err.message);
      resolve(false);
    });
    req.on('end', () => {
      if (status === 200) return resolve(true);
      if (status === 410 || /BadDeviceToken|Unregistered/.test(body)) void dropDevice('apns', token);
      console.warn('[push] APNs send failed', status, body);
      resolve(false);
    });
    req.end(payload);
  });
}

// ── 鸿蒙 Push Kit ──

let harmonyToken: { value: string; expiresAt: number } | null = null;

async function harmonyAccessToken(): Promise<string | null> {
  if (!env.PUSH_HARMONY_CLIENT_ID || !env.PUSH_HARMONY_CLIENT_SECRET) return null;
  if (harmonyToken && harmonyToken.expiresAt > Date.now() + 60_000) return harmonyToken.value;

  const res = await fetch('https://oauth-login.cloud.huawei.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.PUSH_HARMONY_CLIENT_ID,
      client_secret: env.PUSH_HARMONY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    console.warn('[push] Harmony token failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  harmonyToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return harmonyToken.value;
}

async function sendHarmony(token: string, call: IncomingCallPush): Promise<boolean> {
  const accessToken = await harmonyAccessToken();
  if (!accessToken) return false;

  const res = await fetch(
    `https://push-api.cloud.huawei.com/v3/${env.PUSH_HARMONY_CLIENT_ID}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: {
          notification: {
            category: 'VOIP',
            title: call.title,
            body: call.body,
            clickAction: { actionType: 0 },
            extraData: JSON.stringify({
              kind: call.kind,
              call_id: call.call_id,
              call_id_type: call.call_id_type,
              caller: call.caller,
              called: call.called,
            }),
          },
        },
        target: { token: [token] },
        pushOptions: { testMessage: false },
      }),
    },
  );
  const text = await res.text().catch(() => '');
  if (res.ok && /"code"\s*:\s*"80000000"/.test(text)) return true;
  if (/80300007|80300008/.test(text)) await dropDevice('harmony', token);
  console.warn('[push] Harmony send failed', res.status, text);
  return false;
}

export function pushConfigured(): boolean {
  return Boolean(
    managedPushRuntime.configured()
    || loadFcmAccount()
    || (env.PUSH_APNS_KEY && env.PUSH_APNS_BUNDLE_ID)
    || env.PUSH_HARMONY_CLIENT_ID,
  );
}

/**
 * 给该坐席的全部已注册设备发来电推送。
 * 任一通道成功即算送达（同一坐席通常只有一台手机在线）。
 */
export async function pushIncomingCall(userId: number, call: IncomingCallPush): Promise<number> {
  try { await refreshManagedPushConfig(); } catch { return 0; }
  if (!pushConfigured()) return 0;
  const devices = await listPushDevices(userId).catch(() => [] as PushDevice[]);
  if (devices.length === 0) return 0;

  const results = await Promise.all(devices.map(async (device) => {
    try {
      const managed = await managedPushRuntime.dispatch(device.provider, device.token, device.bundleId, call);
      if (managed !== null) {
        if (managed.invalidToken) await dropDevice(device.provider, device.token);
        return managed.accepted;
      }
      if (device.provider === 'fcm') return await sendFcm(device.token, call);
      if (device.provider === 'apns') return await sendApnsVoip(device.token, call);
      if (device.provider === 'harmony') return await sendHarmony(device.token, call);
      return false;
    } catch (err) {
      console.warn('[push] send threw', device.provider, (err as Error).message);
      return false;
    }
  }));
  const delivered = results.filter(Boolean).length;
  console.log(`[push] incoming_call user=${userId} devices=${devices.length} delivered=${delivered}`);
  return delivered;
}

export function closePushTransports(): void {
  apnsSession?.close();
  apnsSession = null;
}
