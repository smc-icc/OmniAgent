import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TarsRpc from '@tars/rpc';
import { applyAcdFinishEvt, applyAcdRingAck } from '../../modules/itr/itr-queue.js';

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const { OmniAcdCbImp, setOnAcdCallback } = require(path.join(dir, 'omni-acd-cb-imp.cjs')) as {
  OmniAcdCbImp: new () => unknown;
  setOnAcdCallback: (cb: (method: string, payload: Record<string, unknown>) => void) => void;
};

type TarsServerHandle = {
  start: (cfg: { name: string; servant: string; endpoint: string; protocol: string }) => Promise<unknown>;
  stop: () => Promise<void>;
};

const { server } = TarsRpc as unknown as { server: { createServer: (Imp: new () => unknown) => TarsServerHandle } };

let tarsServer: TarsServerHandle | null = null;

function handleAcdCallback(method: string, payload: Record<string, unknown>): void {
  console.log(`[acd-cb] ${method}`, JSON.stringify(payload).slice(0, 400));
  if (method === 'OnACDRingAck') {
    void applyAcdRingAck({
      requestId: Number(payload.RequestID ?? payload.requestId ?? 0),
      result: Number(payload.Result ?? payload.result ?? 0),
      queueLen: Number(payload.QueueLen ?? payload.queueLen ?? 0),
      ewt: Number(payload.EWT ?? payload.ewt ?? 0),
    });
    return;
  }
  if (method === 'OnACDFinishACDQueueEvt') {
    void applyAcdFinishEvt({
      requestId: Number(payload.RequestID ?? payload.requestId ?? 0),
      agentId: Number(payload.AgentID ?? payload.agentId ?? 0),
      finishedType: Number(payload.FinishedType ?? payload.finishedType ?? 0),
      groupId: Number(payload.AgentGroupID ?? payload.groupId ?? 0),
      skillId: Number(payload.SkillID ?? payload.skillId ?? 0),
    });
    return;
  }
  if (method === 'OnACDRequestACDCancelAck') {
    // queue already cleared by Omni cancel path; ignore
  }
}

export async function startAcdCbServant(options: {
  name: string;
  servant: string;
  host: string;
  port: number;
}): Promise<void> {
  setOnAcdCallback(handleAcdCallback);
  tarsServer = server.createServer(OmniAcdCbImp as new () => unknown);
  await tarsServer.start({
    name: options.name,
    servant: options.servant,
    endpoint: `tcp -h ${options.host} -p ${options.port}`,
    protocol: 'tars',
  });
}

export async function stopAcdCbServant(): Promise<void> {
  if (tarsServer) {
    await Promise.resolve(tarsServer.stop());
    tarsServer = null;
  }
}

/** Full TARS endpoint string for DoRing.CallbackObj */
export function buildAcdCallbackObj(opts: {
  servant: string;
  advertiseHost: string;
  port: number;
}): string {
  return `${opts.servant}@tcp -h ${opts.advertiseHost} -p ${opts.port}`;
}
