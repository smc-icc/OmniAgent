/**
 * Omni → CCS 会话订阅。
 * DoSubscribeCcsSession 未进生成桩，手编结构后走 worker.tars_invoke。
 * 一 Prx 一 callback：objName 写在本模块，onClose 再判断是不是 CCS。
 */
import { createRequire } from 'node:module';
import type { CcsAgentProxy } from './tars-loader.js';

const require = createRequire(import.meta.url);
const TarsStream = require('@tars/stream') as {
  TarsOutputStream: new () => {
    writeStruct: (tag: number, value: unknown) => void;
    getBinBuffer: () => unknown;
  };
};

export const CCS_SUBSCRIBE_FUNC = 'DoSubscribeCcsSession';
export const CCS_APP_AGENT = 'AGENT';

export function isCcsObjName(objName: string): boolean {
  return objName.includes('.CCSServer.') || objName.includes('CCSServer');
}

export function makeCcsSessionObjName(objName: string, host = '', port = 0): string {
  const at = objName.indexOf('@');
  const base = at >= 0 ? objName.slice(0, at) : objName;
  const loc = at >= 0 ? objName.slice(at + 1) : '';
  const h = host || loc.match(/-h\s+(\S+)/)?.[1] || '';
  const p = port > 0 ? String(port) : loc.match(/-p\s+(\d+)/)?.[1] || '';
  if (!h || !p) return '';
  return `${base}@tcp -h ${h} -p ${p}`;
}

export function isIsolatedCcsSessionObj(sessObj: string, businessObj: string): boolean {
  return Boolean(sessObj) && sessObj.includes('@tcp') && sessObj !== businessObj;
}

type TarsWorker = {
  tars_invoke?: (
    funcName: string,
    bin: unknown,
    context?: unknown,
    property?: unknown,
  ) => Promise<{ response?: { return?: number; arguments?: Record<string, { err?: number }> } }>;
  setPushCallback?: (cb: (data: unknown) => void) => void;
  tars_set_push_callback?: (cb: (data: unknown) => void) => void;
  on?: (evt: string, cb: (...args: unknown[]) => void) => void;
};

function getWorker(proxy: CcsAgentProxy): TarsWorker | undefined {
  return (proxy as { _worker?: TarsWorker })._worker;
}

function encodeSubscribe(appType: string, nodeId: string, objName: string): unknown {
  const inner = {
    AppType: appType,
    NodeId: nodeId,
    ObjName: objName,
    KeepAliveSec: 0,
    _writeTo(os: { writeString: (t: number, v: string) => void; writeInt32: (t: number, v: number) => void }) {
      os.writeString(0, this.AppType);
      os.writeString(1, this.NodeId);
      os.writeString(2, this.ObjName);
      os.writeInt32(3, this.KeepAliveSec);
    },
  };
  const os = new TarsStream.TarsOutputStream();
  os.writeStruct(1, inner);
  return os.getBinBuffer();
}

const SUBSCRIBE_IF = {
  name: CCS_SUBSCRIBE_FUNC,
  return: 'int32',
  arguments: [
    { name: 'req', class: 'smc_icc.stSubscribeCcsSession_t', direction: 'in' },
    { name: 'rsp', class: 'smc_icc.stCommRsp_t', direction: 'out' },
  ],
};

export async function subscribeCcsSession(
  proxy: CcsAgentProxy,
  objName: string,
  nodeId: string,
): Promise<boolean> {
  const worker = getWorker(proxy);
  if (!worker?.tars_invoke) {
    throw new Error('CCS proxy has no tars_invoke worker');
  }
  const bin = encodeSubscribe(CCS_APP_AGENT, nodeId, objName);
  const result = await worker.tars_invoke(CCS_SUBSCRIBE_FUNC, bin, undefined, SUBSCRIBE_IF);
  const ret = result?.response?.return ?? -1;
  const err = result?.response?.arguments?.rsp?.err ?? 0;
  // Node 解自定义回包时常把 return 读成 -1，CCS 侧 err=0 即已 bind。
  if (err !== 0 && ret !== 0) {
    throw new Error(`DoSubscribeCcsSession ret=${ret} err=${err}`);
  }
  return true;
}

export function attachCcsCloseHook(
  proxy: CcsAgentProxy,
  objName: string,
  onClose: (objName: string) => void,
): boolean {
  const worker = getWorker(proxy);
  const fire = (): void => {
    if (isCcsObjName(objName)) onClose(objName);
  };
  const noopPush = (): void => {};
  if (worker?.setPushCallback) {
    worker.setPushCallback(noopPush);
  } else if (worker?.tars_set_push_callback) {
    worker.tars_set_push_callback(noopPush);
  }
  if (typeof worker?.on === 'function') {
    worker.on('close', fire);
    return true;
  }
  const proxyOn = (proxy as { on?: (evt: string, cb: (...args: unknown[]) => void) => void }).on;
  if (typeof proxyOn === 'function') {
    proxyOn.call(proxy, 'close', fire);
    return true;
  }
  return false;
}

const SESSION_PING_MS = 10000;

async function pingSessionProxy(proxy: CcsAgentProxy): Promise<void> {
  const ping = (proxy as { tars_ping?: () => Promise<unknown> }).tars_ping;
  if (typeof ping === 'function') {
    await ping.call(proxy);
    return;
  }
  const worker = getWorker(proxy);
  if (!worker?.tars_invoke) {
    throw new Error('session proxy has no tars_ping');
  }
  await worker.tars_invoke('tars_ping', undefined, undefined, { name: 'tars_ping', return: 'int32', arguments: [] });
}

export function startCcsSessionWatch(opts: {
  getProxy: () => CcsAgentProxy;
  recreateProxy?: () => Promise<unknown>;
  objName: string;
  nodeId: string;
  onDown: (objName: string) => void;
  onUp?: () => void;
  log?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };
}): { stop: () => void } {
  let stopped = false;
  let subscribed = false;
  let needOffline = false;
  let dropProxy = false;
  let closeHooked = false;
  let sessionGen = 0;
  let delayMs = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const log = opts.log;

  const stopPing = (): void => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = undefined;
    }
  };

  const startPing = (): void => {
    stopPing();
    pingTimer = setInterval(() => {
      if (stopped || !subscribed) return;
      void pingSessionProxy(opts.getProxy()).catch((err) => {
        log?.warn({ err, obj: opts.objName }, 'CCS session tars_ping failed');
        subscribed = false;
        sessionGen += 1;
        dropProxy = true;
        stopPing();
        schedule(0);
      });
    }, SESSION_PING_MS);
  };

  const hookClose = (): void => {
    const cbGen = sessionGen;
    try {
      const hooked = attachCcsCloseHook(opts.getProxy(), opts.objName, (name) => {
        if (stopped || sessionGen !== cbGen) return;
        if (!isCcsObjName(name)) {
          log?.warn({ obj: name }, 'onClose ignore non-CCS');
          return;
        }
        log?.warn({ obj: name }, 'CCS onClose');
        subscribed = false;
        sessionGen += 1;
        needOffline = true;
        dropProxy = true;
        stopPing();
        schedule(0);
      });
      if (!hooked) {
        log?.warn({ obj: opts.objName }, 'CCS close hook unavailable — health ping remains fallback');
      }
    } catch (err) {
      log?.warn({ err, obj: opts.objName }, 'attach CCS close hook failed');
    }
  };

  const trySubscribe = async (): Promise<void> => {
    if (stopped || subscribed) return;
    if (needOffline) {
      needOffline = false;
      opts.onDown(opts.objName);
    }
    sessionGen += 1;
    const gen = sessionGen;
    try {
      if (dropProxy && opts.recreateProxy) {
        dropProxy = false;
        closeHooked = false;
        await opts.recreateProxy();
        if (stopped || sessionGen !== gen) {
          log?.warn({ obj: opts.objName }, 'DoSubscribeCcsSession stale gen after recreate');
          schedule(0);
          return;
        }
      }
      if (!closeHooked) {
        hookClose();
        closeHooked = true;
      }
      await subscribeCcsSession(opts.getProxy(), opts.objName, opts.nodeId);
      if (sessionGen !== gen) {
        log?.warn({ obj: opts.objName }, 'DoSubscribeCcsSession stale gen');
        schedule(0);
        return;
      }
      subscribed = true;
      delayMs = 1000;
      startPing();
      log?.info({ obj: opts.objName, node: opts.nodeId }, 'DoSubscribeCcsSession ok');
      opts.onUp?.();
    } catch (err) {
      log?.warn({ err, obj: opts.objName }, 'DoSubscribeCcsSession failed');
      schedule();
    }
  };

  const schedule = (forceMs?: number): void => {
    if (stopped) return;
    if (timer) {
      if (forceMs !== 0) return;
      clearTimeout(timer);
      timer = undefined;
    }
    const wait = forceMs ?? delayMs;
    timer = setTimeout(() => {
      timer = undefined;
      void trySubscribe();
    }, wait);
    if (forceMs === undefined) {
      delayMs = Math.min(16000, delayMs * 2);
    }
  };

  void trySubscribe();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stopPing();
    },
  };
}
