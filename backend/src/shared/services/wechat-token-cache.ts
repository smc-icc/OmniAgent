import { redis } from '../../plugins/redis.js';
import { hashSecret } from '../wechat/crypto.js';

const MP_PREFIX = 'wechat:mp:token:';
const WECOM_PREFIX = 'wecom:token:';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function cacheSet(key: string, token: string, expiresInSec: number): Promise<void> {
  const ttl = Math.max(60, expiresInSec - 300);
  try {
    await redis.setex(key, ttl, token);
  } catch {
    /* memory-only fallback handled by refetch */
  }
}

const memoryCache = new Map<string, { token: string; expiresAt: number }>();

function memoryGet(key: string): string | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.token;
}

function memorySet(key: string, token: string, expiresInSec: number): void {
  memoryCache.set(key, { token, expiresAt: Date.now() + (expiresInSec - 300) * 1000 });
}

export async function getWechatMpAccessToken(appId: string, appSecret: string): Promise<string> {
  const key = `${MP_PREFIX}${appId}`;
  const cached = (await cacheGet(key)) ?? memoryGet(key);
  if (cached) return cached;

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const res = await fetch(url);
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) {
    throw new Error(data.errmsg ?? 'Failed to fetch WeChat MP access token');
  }
  const expiresIn = data.expires_in ?? 7200;
  await cacheSet(key, data.access_token, expiresIn);
  memorySet(key, data.access_token, expiresIn);
  return data.access_token;
}

export async function getWecomAccessToken(corpId: string, secret: string): Promise<string> {
  const key = `${WECOM_PREFIX}${corpId}:${hashSecret(secret)}`;
  const cached = (await cacheGet(key)) ?? memoryGet(key);
  if (cached) return cached;

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
  // 同上：这条 fetch 是 sync_msg 的前置，卡住同样会让整条企微拉取链路停摆。
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) {
    throw new Error(data.errmsg ?? 'Failed to fetch WeCom access token');
  }
  const expiresIn = data.expires_in ?? 7200;
  await cacheSet(key, data.access_token, expiresIn);
  memorySet(key, data.access_token, expiresIn);
  return data.access_token;
}
