import TarsRpc from '@tars/rpc';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env } from '../../config/env.js';

const require = createRequire(import.meta.url);
const generated = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'tars', 'asrProxy.js'),
) as {
  smc_icc: {
    asrProxy: new () => AsrProxy;
    stASROfflineReq: new () => TarsStruct;
  };
};

interface TarsStruct {
  readFromObject(value: Record<string, unknown>): this;
  toObject(): Record<string, unknown>;
}

type RpcResult = {
  response: {
    return: number;
    arguments: { rsp?: TarsStruct };
  };
};

interface AsrProxy {
  setTimeout(ms: number): void;
  DoAsr(): Promise<RpcResult>;
  SubmitOffline(req: TarsStruct): Promise<RpcResult>;
  GetOfflineResult(taskId: string): Promise<RpcResult>;
  CancelOffline(taskId: string): Promise<RpcResult>;
}

const { client } = TarsRpc as {
  client: { stringToProxy: (proxyClass: unknown, obj: string) => AsrProxy };
};

let proxy: AsrProxy | null = null;
let proxyObj = '';

function getProxy(): AsrProxy {
  const obj = (env.ASR_OBJ || '').trim();
  if (!obj) throw new Error('ASR_OBJ is not configured');
  if (!proxy || proxyObj !== obj) {
    proxy = client.stringToProxy(generated.smc_icc.asrProxy, obj);
    proxy.setTimeout(env.ASR_INVOKE_TIMEOUT_MS);
    proxyObj = obj;
  }
  return proxy;
}

function offlineRsp(result: RpcResult): {
  rpcRet: number;
  result: number;
  errMsg: string;
  state: string;
  payloadJson: string;
} {
  const raw = result.response.arguments.rsp?.toObject?.() ?? {};
  return {
    rpcRet: Number(result.response.return ?? 0),
    result: Number(raw.result ?? 0),
    errMsg: String(raw.errMsg ?? ''),
    state: String(raw.state ?? ''),
    payloadJson: String(raw.payloadJson ?? ''),
  };
}

export async function pingAsr(): Promise<{ ok: boolean; error?: string }> {
  const result = await getProxy().DoAsr();
  const raw = result.response.arguments.rsp?.toObject?.() ?? {};
  const err = Number(raw.err ?? result.response.return ?? 0);
  const errMsg = String(raw.errMsg ?? '');
  if (err !== 0) return { ok: false, error: errMsg || `DoAsr err=${err}` };
  return { ok: true };
}

export async function recognizeOfflineFile(
  recordingUri: string,
  timeoutMs: number,
  engine = 'funasr',
): Promise<{ ok: true; payloadJson: string } | { ok: false; error: string }> {
  const taskId = `omni-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const req = new generated.smc_icc.stASROfflineReq().readFromObject({
    taskId,
    recordingUri,
    engine,
    optionsJson: JSON.stringify({ channelRoles: ['customer'] }),
  });
  const submitted = offlineRsp(await getProxy().SubmitOffline(req));
  if (submitted.rpcRet !== 0 || submitted.result !== 0) {
    return { ok: false, error: submitted.errMsg || 'SubmitOffline failed' };
  }

  const deadline = Date.now() + Math.max(1000, timeoutMs);
  while (Date.now() < deadline) {
    const cur = offlineRsp(await getProxy().GetOfflineResult(taskId));
    if (cur.state === 'completed') {
      return { ok: true, payloadJson: cur.payloadJson };
    }
    if (cur.state === 'failed' || cur.state === 'cancelled') {
      return { ok: false, error: cur.errMsg || `ASR ${cur.state}` };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  try {
    await getProxy().CancelOffline(taskId);
  } catch {
    /* ignore */
  }
  return { ok: false, error: `ASR timed out after ${timeoutMs}ms` };
}
