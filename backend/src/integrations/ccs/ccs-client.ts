import TarsRpc from '@tars/rpc';
import type { CcsAgentProxy, TarsStruct } from './tars-loader.js';

const { client } = TarsRpc as { client: { stringToProxy: (cls: unknown, obj: string) => CcsAgentProxy } };

let proxy: CcsAgentProxy | null = null;
let businessObj = '';
let businessTimeoutMs = 15000;
let doMethodStruct: Map<string, string> | null = null;
let structResolver: ((className: string) => new () => TarsStruct) | null = null;

async function ensureTarsLoaded(): Promise<void> {
  if (doMethodStruct && structResolver) return;
  const { ccsTars, agentStructTars } = await import('./tars-loader.js');
  const map = new Map<string, string>();
  const agentProxyClass = ccsTars.smc_icc.agentProxy as unknown as Record<
    string,
    { arguments?: { name: string; class: string; direction: string }[] }
  >;
  for (const key of Object.keys(agentProxyClass)) {
    if (!key.startsWith('Do')) continue;
    const meta = agentProxyClass[key];
    const reqArg = meta?.arguments?.find((a) => a.name === 'req' && a.direction === 'in');
    if (reqArg?.class) map.set(key, reqArg.class);
  }
  doMethodStruct = map;
  structResolver = (className: string) => {
    const short = className.includes('.') ? className.split('.').pop()! : className;
    const ctor = agentStructTars.smc_icc[short];
    if (!ctor) throw new Error(`Unknown TARS struct: ${className}`);
    return ctor as new () => TarsStruct;
  };
}

export async function initCcsClient(ccsAgentObj: string, timeoutMs = 15000): Promise<void> {
  businessObj = ccsAgentObj;
  businessTimeoutMs = timeoutMs;
  const { ccsTars } = await import('./tars-loader.js');
  await ensureTarsLoaded();
  proxy = client.stringToProxy(ccsTars.smc_icc.agentProxy, ccsAgentObj);
  proxy.setTimeout(timeoutMs);
  // 预热不阻塞插件注册：CCS 不可达时 TARS 超时会拖垮 Fastify pluginTimeout。
  void warmupCcsConnection();
}

let recreatingBusiness = false;

/** CCS 晚于 Omni 起来或重启后，丢掉 inactive adapter，重建业务 Prx。 */
export async function recreateCcsBusinessProxy(): Promise<void> {
  if (!businessObj || recreatingBusiness) return;
  recreatingBusiness = true;
  try {
    proxy = null;
    warmupDone = false;
    const { ccsTars } = await import('./tars-loader.js');
    await ensureTarsLoaded();
    proxy = client.stringToProxy(ccsTars.smc_icc.agentProxy, businessObj);
    proxy.setTimeout(businessTimeoutMs);
    await warmupCcsConnection();
  } finally {
    recreatingBusiness = false;
  }
}

let warmupDone = false;
async function warmupCcsConnection(): Promise<void> {
  if (warmupDone) return;
  try {
    await invokeDoAgent('DoGetAgentInterfaceVersion', {}, 3000, 1);
    warmupDone = true;
  } catch {
    // 预热失败不致命：业务 invoke 的首败重试兜底
  }
}

export function resetCcsWarmup(): void {
  warmupDone = false;
}

/** 轻量探测 CCS：可达性 + 进程 bootEpoch（CCS 换进程后 boot 会变）。 */
export async function probeCcs(): Promise<{ ok: boolean; bootId?: string }> {
  try {
    const { rsp } = await invokeDoAgent('DoGetAgentInterfaceVersion', {}, 2500, 1);
    const msg = typeof rsp.errMsg === 'string' ? rsp.errMsg : '';
    const m = /boot=(\d+)/.exec(msg);
    return { ok: true, bootId: m?.[1] };
  } catch {
    return { ok: false };
  }
}

/** 轻量探测 CCS AgentObj 是否可达。 */
export async function pingCcs(): Promise<boolean> {
  return (await probeCcs()).ok;
}

export function getCcsProxy(): CcsAgentProxy {
  if (!proxy) throw new Error('CCS client not initialized; set CCS_AGENT_OBJ');
  return proxy;
}

let sessionProxy: CcsAgentProxy | null = null;
let sessionBusinessObj = '';
let sessionTimeoutMs = 5000;

export function getCcsSessionProxy(): CcsAgentProxy {
  if (!sessionProxy) throw new Error('CCS session proxy not initialized');
  return sessionProxy;
}

export async function initCcsSessionProxy(ccsAgentObj: string, timeoutMs = 5000): Promise<string> {
  sessionBusinessObj = ccsAgentObj;
  sessionTimeoutMs = timeoutMs;
  const { ccsTars } = await import('./tars-loader.js');
  await ensureTarsLoaded();
  const { makeCcsSessionObjName, isIsolatedCcsSessionObj } = await import('./ccs-session.js');
  const sessObj = makeCcsSessionObjName(ccsAgentObj);
  if (!isIsolatedCcsSessionObj(sessObj, ccsAgentObj)) {
    throw new Error(`CCS session Prx not isolated from business obj=${ccsAgentObj} sess=${sessObj}`);
  }
  sessionProxy = client.stringToProxy(ccsTars.smc_icc.agentProxy, sessObj);
  sessionProxy.setTimeout(timeoutMs);
  return sessObj;
}

/** 丢掉旧 session 代理再 stringToProxy，逼出新 TCP。 */
export async function recreateCcsSessionProxy(): Promise<string> {
  if (!sessionBusinessObj) throw new Error('CCS session proxy not initialized');
  sessionProxy = null;
  return initCcsSessionProxy(sessionBusinessObj, sessionTimeoutMs);
}

export async function invokeDoAgent(
  method: string,
  payload: Record<string, unknown>,
  timeoutOverrideMs?: number,
  maxAttempts = 3,
): Promise<{ ret: number; rsp: Record<string, unknown> }> {
  await ensureTarsLoaded();
  let p = getCcsProxy();
  const prevTimeout = (p as { getTimeout?: () => number }).getTimeout?.();
  if (typeof timeoutOverrideMs === 'number') {
    try { p.setTimeout(timeoutOverrideMs); } catch { /* ignore */ }
  }

  const structName = doMethodStruct!.get(method);
  if (!structName) throw new Error(`No request struct for method: ${method}`);

  const req = new (structResolver!(structName))();
  req.readFromObject(payload);
  const attempts = recreatingBusiness ? 1 : Math.max(1, maxAttempts);
  let lastErr: unknown;
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const fn = p[method] as ((req: TarsStruct) => Promise<{ response: { return: number; arguments: Record<string, TarsStruct> } }>) | undefined;
        if (typeof fn !== 'function') throw new Error(`Unknown CCS agent method: ${method}`);
        const result = await fn.call(p, req);
        const rspObj = result.response.arguments.rsp?.toObject?.() ?? { err: result.response.return };
        return { ret: result.response.return, rsp: rspObj as Record<string, unknown> };
      } catch (err) {
        lastErr = err;
        if (attempt === 0 && attempts > 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        } else if (attempt === 1 && attempts > 2) {
          await recreateCcsBusinessProxy();
          p = getCcsProxy();
          if (typeof timeoutOverrideMs === 'number') {
            try { p.setTimeout(timeoutOverrideMs); } catch { /* ignore */ }
          }
        }
      }
    }
    throw lastErr;
  } finally {
    // warmup 等短超时不得永久污染后续业务调用
    if (typeof timeoutOverrideMs === 'number') {
      try {
        p.setTimeout(typeof prevTimeout === 'number' && prevTimeout > 0 ? prevTimeout : 30000);
      } catch { /* ignore */ }
    }
  }
}

export async function listDoAgentMethods(): Promise<string[]> {
  await ensureTarsLoaded();
  return [...doMethodStruct!.keys()].sort();
}
