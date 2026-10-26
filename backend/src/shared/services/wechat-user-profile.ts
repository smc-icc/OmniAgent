import { getWechatMpAccessToken, getWecomAccessToken } from './wechat-token-cache.js';

const CACHE_TTL_MS = 60 * 60 * 1000;
const profileCache = new Map<string, { name: string; expiresAt: number }>();

function cacheGet(key: string): string | undefined {
  const hit = profileCache.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    profileCache.delete(key);
    return undefined;
  }
  return hit.name;
}

function cacheSet(key: string, name: string): void {
  profileCache.set(key, { name, expiresAt: Date.now() + CACHE_TTL_MS });
}

function pickDisplayName(...candidates: Array<string | undefined | null>): string | undefined {
  for (const c of candidates) {
    const trimmed = String(c ?? '').trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** 公众号用户昵称（需已关注；受微信隐私策略影响，可能为空）。 */
export async function fetchWechatMpUserDisplayName(
  appId: string,
  appSecret: string,
  openid: string,
): Promise<string | undefined> {
  if (!openid) return undefined;
  const cacheKey = `mp:${appId}:${openid}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const token = await getWechatMpAccessToken(appId, appSecret);
    const url = `https://api.weixin.qq.com/cgi-bin/user/info?access_token=${encodeURIComponent(token)}&openid=${encodeURIComponent(openid)}&lang=zh_CN`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      nickname?: string;
      remark?: string;
      errcode?: number;
    };
    if (data.errcode) return undefined;
    const name = pickDisplayName(data.remark, data.nickname);
    if (name) cacheSet(cacheKey, name);
    return name;
  } catch {
    return undefined;
  }
}

/** 企业微信外部联系人姓名/昵称。 */
export async function fetchWecomExternalContactDisplayName(
  corpId: string,
  contactSecret: string,
  externalUserId: string,
): Promise<string | undefined> {
  if (!externalUserId) return undefined;
  const cacheKey = `wecom-ext:${corpId}:${externalUserId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const token = await getWecomAccessToken(corpId, contactSecret);
    const url = `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/get?access_token=${encodeURIComponent(token)}&external_userid=${encodeURIComponent(externalUserId)}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      errcode?: number;
      external_contact?: { name?: string; nickname?: string };
    };
    if (data.errcode && data.errcode !== 0) return undefined;
    const name = pickDisplayName(data.external_contact?.name, data.external_contact?.nickname);
    if (name) cacheSet(cacheKey, name);
    return name;
  } catch {
    return undefined;
  }
}

/** 企业微信客服客户昵称。 */
export async function fetchWecomKfCustomerDisplayName(
  corpId: string,
  secret: string,
  externalUserId: string,
): Promise<string | undefined> {
  if (!externalUserId) return undefined;
  const cacheKey = `wecom-kf:${corpId}:${externalUserId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const token = await getWecomAccessToken(corpId, secret);
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/kf/customer/batchget?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_userid_list: [externalUserId],
          need_enter_session_context: 0,
        }),
      },
    );
    const data = (await res.json()) as {
      errcode?: number;
      customer_list?: Array<{ nickname?: string }>;
    };
    if (data.errcode && data.errcode !== 0) return undefined;
    const name = pickDisplayName(data.customer_list?.[0]?.nickname);
    if (name) cacheSet(cacheKey, name);
    return name;
  } catch {
    return undefined;
  }
}
