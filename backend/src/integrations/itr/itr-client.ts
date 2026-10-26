import TarsRpc from '@tars/rpc';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env } from '../../config/env.js';
import type { TarsStruct } from '../ccs/tars-loader.js';

const require = createRequire(import.meta.url);
const tarsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tars');
const itrObjProxyMod = require(path.join(tarsDir, 'itrObjProxy.js')) as {
  smc_icc: { itrObjProxy: new () => ItrObjProxy };
};
const itrStructTars = require(path.join(tarsDir, 'itr_structTars.js')) as {
  smc_icc: Record<string, new () => TarsStruct>;
};

const { client } = TarsRpc as { client: { stringToProxy: (cls: unknown, obj: string) => ItrObjProxy } };

interface ItrObjProxy {
  setTimeout(ms: number): void;
  StartSession(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  OnMessage(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  EndSession(conversationId: string): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  Ping(): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
}

export type ItrStartBody = {
  conversationId: string;
  contactId?: string;
  channelType?: string;
  inboxId?: number;
  flowId: number;
  vdnId?: number;
  callerId?: string;
  meta?: Record<string, unknown>;
};

let proxy: ItrObjProxy | null = null;
let proxyObj = '';

function itrBase(): string {
  return (env.ITR_HTTP_BASE || 'http://127.0.0.1:9400').replace(/\/$/, '');
}

/** HTTP `http://HOST:9400` → TARS `SMC-ICC.ITRServer.ItrObj@tcp -h HOST -p 9401` */
export function deriveItrObj(): string | undefined {
  if (env.ITR_OBJ) return env.ITR_OBJ;
  try {
    const u = new URL(itrBase());
    return `SMC-ICC.ITRServer.ItrObj@tcp -h ${u.hostname} -p 9401 -t 8000`;
  } catch {
    return undefined;
  }
}

function transport(): 'tars' | 'http' | 'auto' {
  const v = (env.ITR_TRANSPORT || 'auto').toLowerCase();
  if (v === 'tars' || v === 'http') return v;
  return 'auto';
}

function getItrProxy(): ItrObjProxy {
  const obj = deriveItrObj();
  if (!obj) throw new Error('ITR_OBJ not set and cannot derive from ITR_HTTP_BASE');
  if (!proxy || proxyObj !== obj) {
    proxy = client.stringToProxy(itrObjProxyMod.smc_icc.itrObjProxy, obj);
    proxy.setTimeout(Math.min(env.CCS_INVOKE_TIMEOUT_MS || 8000, 8000));
    proxyObj = obj;
  }
  return proxy;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function tarsRspToRecord(result: {
  response: { return: number; arguments: { rsp?: TarsStruct } };
}): Record<string, unknown> {
  const rsp = asRecord(result.response.arguments.rsp?.toObject?.() ?? {});
  const payloadJson = String(rsp.payloadJson ?? rsp.PayloadJson ?? '');
  let payload: unknown;
  if (payloadJson) {
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      payload = payloadJson;
    }
  }
  return {
    result: Number(rsp.result ?? result.response.return ?? 0),
    message: String(rsp.message ?? 'ok'),
    state: String(rsp.state ?? ''),
    payloadJson,
    ...(payload !== undefined ? { payload } : {}),
  };
}

async function postJson(pathName: string, body: unknown): Promise<Record<string, unknown>> {
  const url = `${itrBase()}${pathName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { result: res.status, message: text.slice(0, 200) };
  }
  if (!res.ok && data.result === undefined) {
    data.result = res.status;
    data.message = data.message || text.slice(0, 200);
  }
  return data;
}

async function withFallback<T extends Record<string, unknown>>(
  tarsCall: () => Promise<T>,
  httpCall: () => Promise<T>,
  label: string,
): Promise<T> {
  const mode = transport();
  if (mode === 'http') return httpCall();
  try {
    const out = await tarsCall();
    return out;
  } catch (e) {
    if (mode === 'tars') throw e;
    console.warn(`[itr] TARS ${label} failed, fallback HTTP:`, e instanceof Error ? e.message : e);
    return httpCall();
  }
}

/** Omni → ITR：TARS ItrObj 优先，HTTP `/api/itr/*` 回退 */
export async function itrStart(body: ItrStartBody) {
  return withFallback(
    async () => {
      const Req = itrStructTars.smc_icc.stITRStartReq;
      if (!Req) throw new Error('stITRStartReq missing');
      const req = new Req();
      req.readFromObject({
        conversationId: body.conversationId,
        contactId: body.contactId || '',
        channelType: body.channelType || 'web_widget',
        inboxId: body.inboxId || 0,
        flowId: body.flowId,
        vdnId: body.vdnId || 0,
        callerId: body.callerId || '',
        metaJson: body.meta ? JSON.stringify(body.meta) : '',
      });
      return tarsRspToRecord(await getItrProxy().StartSession(req));
    },
    () => postJson('/api/itr/start', body),
    'StartSession',
  );
}

export async function itrOnMessage(conversationId: string, content: string, contentType = 'text') {
  return withFallback(
    async () => {
      const Req = itrStructTars.smc_icc.stITRMessageReq;
      if (!Req) throw new Error('stITRMessageReq missing');
      const req = new Req();
      req.readFromObject({ conversationId, content, contentType, metaJson: '' });
      return tarsRspToRecord(await getItrProxy().OnMessage(req));
    },
    () => postJson('/api/itr/message', { conversationId, content, contentType }),
    'OnMessage',
  );
}

export async function itrEnd(conversationId: string) {
  return withFallback(
    async () => tarsRspToRecord(await getItrProxy().EndSession(conversationId)),
    () => postJson('/api/itr/end', { conversationId }),
    'EndSession',
  );
}

/**
 * 通知 ITR：坐席回复了，把该会话的「连续超时」计数清零。
 *
 * 语义见 ITR 侧 `/api/itr/reset-timeout-count`：坐席回过话就不算「连续未回复」了，
 * 计数必须重新开始，否则它只会单调上涨 —— 变成第一次超时就触发「重新排队」。
 *
 * **只走 HTTP**（TARS 侧没有对应接口，也避免改 .tars 重新生成 stub）。
 * 失败不抛：清计数是优化，不该影响坐席这条消息本身。
 */
export async function itrResetTimeoutCount(conversationId: string): Promise<void> {
  try {
    await postJson('/api/itr/reset-timeout-count', { conversationId });
  } catch (e) {
    console.warn('[itr] reset-timeout-count failed', { conversationId, e });
  }
}

export async function itrPing() {
  return withFallback(
    async () => tarsRspToRecord(await getItrProxy().Ping()),
    async () => {
      const url = `${itrBase()}/api/itr/ping`;
      const res = await fetch(url);
      return res.json() as Promise<Record<string, unknown>>;
    },
    'Ping',
  );
}
