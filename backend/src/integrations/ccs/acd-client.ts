import TarsRpc from '@tars/rpc';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env } from '../../config/env.js';
import type { TarsStruct } from './tars-loader.js';

const nodeRequire = createRequire(import.meta.url);
const tarsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tars');

type AcdTarsMods = {
  proxy: { smc_icc: { acdObjProxy: new () => AcdObjProxy } };
  structs: { smc_icc: Record<string, new () => TarsStruct> };
};
let acdTars: AcdTarsMods | null = null;

function loadAcdTars(): AcdTarsMods {
  if (!acdTars) {
    acdTars = {
      proxy: nodeRequire(path.join(tarsDir, 'acdObjProxy.js')) as AcdTarsMods['proxy'],
      structs: nodeRequire(path.join(tarsDir, 'acd_structTars.js')) as AcdTarsMods['structs'],
    };
  }
  return acdTars;
}

const { client } = TarsRpc as { client: { stringToProxy: (cls: unknown, obj: string) => AcdObjProxy } };

interface AcdObjProxy {
  setTimeout(ms: number): void;
  DoACDRequestCallQueueList(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoRing(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoRequestACDCancel(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoACDAgentUpdateMediaQueuingMode(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoACDAgentUpdateCallerCount(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoACDAgentSessionReleased(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoAgentSignInGroup(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoAgentSignOutGroup(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoAgentSignInSkill(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoAgentSignOutSkill(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
  DoAgentStatusChangeEvt(req: TarsStruct): Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>;
}

let proxy: AcdObjProxy | null = null;
let acdObjName = '';
let acdTimeoutMs = 8000;

/** CCS `...CCSServer.AgentObj@tcp -h HOST -p 19391` → ACD `...ACDServer.ACDObj@tcp -h HOST -p 19398` */
export function deriveAcdObj(ccsAgentObj?: string): string | undefined {
  if (env.ACD_OBJ) return env.ACD_OBJ;
  if (!ccsAgentObj) return undefined;
  const host = /(?:^|\s)-h\s+(\S+)/.exec(ccsAgentObj)?.[1];
  if (!host) return undefined;
  const timeout = /(?:^|\s)-t\s+(\d+)/.exec(ccsAgentObj)?.[1] ?? '60000';
  return `SMC-ICC.ACDServer.ACDObj@tcp -h ${host} -p 19398 -t ${timeout}`;
}

export function initAcdClient(acdObj: string, timeoutMs = 8000): void {
  acdObjName = acdObj;
  acdTimeoutMs = timeoutMs;
  const { proxy: proxyMod } = loadAcdTars();
  proxy = client.stringToProxy(proxyMod.smc_icc.acdObjProxy, acdObj);
  proxy.setTimeout(timeoutMs);
}

export function recreateAcdClient(): void {
  if (!acdObjName) return;
  proxy = null;
  initAcdClient(acdObjName, acdTimeoutMs);
}

function getAcdProxy(): AcdObjProxy {
  if (!proxy) {
    const obj = deriveAcdObj(env.CCS_AGENT_OBJ);
    if (!obj) throw new Error('ACD_OBJ not set and cannot derive from CCS_AGENT_OBJ');
    initAcdClient(obj, Math.min(env.CCS_INVOKE_TIMEOUT_MS, 8000));
  }
  return proxy!;
}

export type AcdQueueCall = {
  logicNo: number;
  callerNo: string;
  groupId: number;
  skillId: number;
  startTime: number;
  enterAcdTime: number;
  vipLevel: number;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function mapQueueItem(row: unknown): AcdQueueCall | null {
  const r = asRecord(row);
  if (!r) return null;
  const logicNo = Number(r.LogicNO ?? r.logicNo ?? 0);
  if (!logicNo) return null;
  const ring = Number(r.RingTime ?? 0);
  return {
    logicNo,
    callerNo: String(r.CallerNO ?? r.CallerID ?? r.callerNo ?? ''),
    groupId: Number(r.AgentGroupID ?? r.groupId ?? 0),
    skillId: Number(r.SkillID ?? r.skillId ?? 0),
    startTime: ring,
    enterAcdTime: ring,
    vipLevel: Number(r.VIPLevel ?? r.vipLevel ?? 0),
  };
}

export async function requestCallQueueList(opts: {
  agentId: number;
  agentGroupId: number;
  vdnId: number;
  skillId?: number;
}): Promise<{ ret: number; status: number; calls: AcdQueueCall[] }> {
  const p = getAcdProxy();
  const Req = loadAcdTars().structs.smc_icc.stACDRequestCallQueueList_t;
  if (!Req) throw new Error('stACDRequestCallQueueList_t missing');
  const req = new Req();
  req.readFromObject({
    AgentID: opts.agentId,
    AgentGroupID: opts.agentGroupId,
    SkillID: opts.skillId ?? -1,
    MonitorTime: 0,
    VDNID: opts.vdnId,
  });
  const result = await p.DoACDRequestCallQueueList(req);
  const rspObj = (result.response.arguments.rsp?.toObject?.() ?? {}) as Record<string, unknown>;
  const raw = rspObj.CallQueue;
  const list = Array.isArray(raw) ? raw : [];
  const calls: AcdQueueCall[] = [];
  const seen = new Set<number>();
  for (const item of list) {
    const mapped = mapQueueItem(rowFromTars(item));
    if (!mapped || seen.has(mapped.logicNo)) continue;
    seen.add(mapped.logicNo);
    calls.push(mapped);
  }
  return {
    ret: result.response.return,
    status: Number(rspObj.Status ?? result.response.return),
    calls,
  };
}

function rowFromTars(item: unknown): unknown {
  if (item && typeof item === 'object' && typeof (item as TarsStruct).toObject === 'function') {
    return (item as TarsStruct).toObject();
  }
  return item;
}

/** CallerType: 对齐旧注释 — 实时 IM/WBS；非实时 SMS/EMAIL。常用 1=WBS/IMS 语义由技能 MediaType 决定。 */
export type AcdRingOpts = {
  requestId: number;
  callerId: string;
  calledId?: string;
  callerType?: number;
  vdnId: number;
  agentGroupId?: number;
  skillId?: number;
  skillLevel?: number;
  vipLevel?: number;
  agentId?: number;
  mediaType?: number;
  conSn?: number;
  pid?: number;
  /** 谁 Ring 谁收；默认填 Omni AcdCbObj 完整 endpoint */
  callbackObj?: string;
};

export function defaultOmniAcdCallbackObj(): string {
  return `${env.OMNI_ACD_CB_OBJ}@tcp -h ${env.OMNI_ACD_CB_ADVERTISE_HOST} -p ${env.OMNI_ACD_CB_PORT}`;
}

export async function acdRing(opts: AcdRingOpts): Promise<{ ret: number; rsp?: Record<string, unknown> }> {
  const p = getAcdProxy();
  const Req = loadAcdTars().structs.smc_icc.stACDRing_t;
  if (!Req) throw new Error('stACDRing_t missing');
  const req = new Req();
  req.readFromObject({
    RequestID: opts.requestId,
    CallerID: opts.callerId || '',
    CalledID: opts.calledId || '',
    CallerType: opts.callerType ?? 1,
    VDNID: opts.vdnId,
    AgentGroupID: opts.agentGroupId ?? -1,
    VIPLevel: opts.vipLevel ?? 1,
    SkillID: opts.skillId ?? -1,
    SkillLevel: opts.skillLevel ?? 1,
    AgentID: opts.agentId ?? -1,
    ConSN: opts.conSn ?? 0,
    PID: opts.pid ?? opts.requestId,
    MediaType: opts.mediaType ?? 0,
    CallbackObj: opts.callbackObj ?? defaultOmniAcdCallbackObj(),
  });
  const result = await p.DoRing(req);
  const rsp = result.response.arguments.rsp?.toObject?.() as Record<string, unknown> | undefined;
  return { ret: result.response.return, rsp };
}

export async function acdCancel(opts: {
  requestId: number;
  vdnId: number;
}): Promise<{ ret: number }> {
  const p = getAcdProxy();
  const Req = loadAcdTars().structs.smc_icc.stACDRequestACDCancel_t;
  if (!Req) throw new Error('stACDRequestACDCancel_t missing');
  const req = new Req();
  req.readFromObject({
    RequestID: opts.requestId,
    VDNID: opts.vdnId,
  });
  const result = await p.DoRequestACDCancel(req);
  return { ret: result.response.return };
}

async function invokeAcdStruct(
  method:
    | 'DoACDAgentUpdateMediaQueuingMode'
    | 'DoACDAgentUpdateCallerCount'
    | 'DoACDAgentSessionReleased'
    | 'DoAgentSignInGroup'
    | 'DoAgentSignOutGroup'
    | 'DoAgentSignInSkill'
    | 'DoAgentSignOutSkill'
    | 'DoAgentStatusChangeEvt',
  structName: string,
  payload: Record<string, unknown>,
): Promise<{ ret: number; err?: number }> {
  const p = getAcdProxy();
  const Req = loadAcdTars().structs.smc_icc[structName];
  if (!Req) throw new Error(`${structName} missing`);
  const req = new Req();
  req.readFromObject(payload);
  const result = await (p[method] as (r: TarsStruct) => Promise<{
    response: { return: number; arguments: { rsp?: TarsStruct } };
  }>)(req);
  const rsp = result.response.arguments.rsp?.toObject?.() as Record<string, unknown> | undefined;
  return { ret: result.response.return, err: Number(rsp?.err ?? result.response.return) };
}

/** 仅话务不占 IMS 坑，不展示/不下发接入路数 */
export const MQM_TAS_ONLY = 3;

export function mediaModeNeedsCallerCount(mode: number): boolean {
  return mode !== MQM_TAS_ONLY;
}

export async function updateMediaQueuingMode(opts: {
  agentId: number;
  vdnId: number;
  mediaQueuingMode: number;
}): Promise<{ ret: number; err?: number }> {
  return invokeAcdStruct('DoACDAgentUpdateMediaQueuingMode', 'stACDAgentUpdateMediaQueuingMode_t', {
    AgentID: opts.agentId,
    VDNID: opts.vdnId,
    MediaQueuingMode: opts.mediaQueuingMode,
  });
}

export async function updateCallerCount(opts: {
  agentId: number;
  vdnId: number;
  callerCount: number;
}): Promise<{ ret: number; err?: number }> {
  return invokeAcdStruct('DoACDAgentUpdateCallerCount', 'stACDAgentUpdateCallerCount_t', {
    AgentID: opts.agentId,
    VDNID: opts.vdnId,
    CallerCount: opts.callerCount,
  });
}

export async function sessionReleased(opts: {
  agentId: number;
  vdnId: number;
  requestId: number;
}): Promise<{ ret: number; err?: number }> {
  return invokeAcdStruct('DoACDAgentSessionReleased', 'stACDAgentSessionReleased_t', {
    AgentID: opts.agentId,
    VDNID: opts.vdnId,
    RequestID: opts.requestId,
  });
}

/** 把接听模式（及全媒体接入路数）下发给 ACD。 */
export async function pushOmniAcdQueuing(opts: {
  agentId: number;
  vdnId: number;
  mediaQueuingMode?: number;
  callerCount?: number;
}): Promise<void> {
  const mqm = opts.mediaQueuingMode ?? env.OMNI_ACD_MQM;
  await updateMediaQueuingMode({ agentId: opts.agentId, vdnId: opts.vdnId, mediaQueuingMode: mqm });
  if (mediaModeNeedsCallerCount(mqm)) {
    const callerCount = opts.callerCount ?? env.OMNI_ACD_CALLER_COUNT;
    await updateCallerCount({ agentId: opts.agentId, vdnId: opts.vdnId, callerCount });
  }
}

const ACD_ALREADY_SIGN_IN_SKILL = 9;
const ACD_ALREADY_SIGN_IN_GROUP = 10;

function acdSignOk(ret: number, err?: number): boolean {
  const code = err ?? ret;
  return ret === 0 || code === 0 || code === ACD_ALREADY_SIGN_IN_SKILL || code === ACD_ALREADY_SIGN_IN_GROUP;
}

export async function acdSignInGroup(opts: {
  agentId: number;
  vdnId: number;
  groupId: number;
}): Promise<{ ret: number; err?: number }> {
  return invokeAcdStruct('DoAgentSignInGroup', 'stACDAgentSignInGroup_t', {
    AgentID: opts.agentId,
    AgentGroupID: opts.groupId,
    VDNID: opts.vdnId,
  });
}

export async function acdSignOutGroup(opts: {
  agentId: number;
  vdnId: number;
  groupId: number;
}): Promise<{ ret: number; err?: number }> {
  return invokeAcdStruct('DoAgentSignOutGroup', 'stACDAgentSignOutGroup_t', {
    AgentID: opts.agentId,
    AgentGroupID: opts.groupId,
    VDNID: opts.vdnId,
  });
}

export async function acdSignInSkill(opts: {
  agentId: number;
  vdnId: number;
  skillId: number;
}): Promise<{ ret: number; err?: number }> {
  return invokeAcdStruct('DoAgentSignInSkill', 'stACDAgentSignInSkill_t', {
    AgentID: opts.agentId,
    SkillID: opts.skillId,
    VDNID: opts.vdnId,
  });
}

export async function acdSignOutSkill(opts: {
  agentId: number;
  vdnId: number;
  skillId: number;
}): Promise<{ ret: number; err?: number }> {
  return invokeAcdStruct('DoAgentSignOutSkill', 'stACDAgentSignOutSkill_t', {
    AgentID: opts.agentId,
    SkillID: opts.skillId,
    VDNID: opts.vdnId,
  });
}

const IMS_AMT_END = 6;
const IMS_AMT_SLOT = 5;
const IMS_AS_UNKNOWN = 1;
const IMS_AS = { idle: 32, busy: 2, block: 8 } as const;

/** 只改 IMS 槽；TAS 填 Unknown，ACD 不会覆盖话务状态。 */
export async function acdSetImsStatus(opts: {
  agentId: number;
  vdnId: number;
  status: keyof typeof IMS_AS;
}): Promise<{ ret: number; err?: number }> {
  const mediaStatus = Array.from({ length: IMS_AMT_END }, () => IMS_AS_UNKNOWN);
  mediaStatus[IMS_AMT_SLOT] = IMS_AS[opts.status];
  return invokeAcdStruct('DoAgentStatusChangeEvt', 'stACDAgentStatusChangeEvtEx_t', {
    AgentID: opts.agentId,
    VDNID: opts.vdnId,
    CallDirection: 0,
    CallType: 0,
    MediaStatus: mediaStatus,
  });
}

export async function acdSetImsIdle(opts: { agentId: number; vdnId: number }): Promise<{ ret: number; err?: number }> {
  return acdSetImsStatus({ ...opts, status: 'idle' });
}

export async function acdSignInGroups(opts: {
  agentId: number;
  vdnId: number;
  groupIds: number[];
}): Promise<void> {
  for (const groupId of opts.groupIds) {
    const r = await acdSignInGroup({ agentId: opts.agentId, vdnId: opts.vdnId, groupId });
    if (!acdSignOk(r.ret, r.err)) {
      throw new Error(`ACD SignInGroup ${groupId} ret=${r.ret} err=${r.err ?? ''}`);
    }
  }
}

export async function acdSignOutGroups(opts: {
  agentId: number;
  vdnId: number;
  groupIds: number[];
}): Promise<void> {
  for (const groupId of opts.groupIds) {
    const r = await acdSignOutGroup({ agentId: opts.agentId, vdnId: opts.vdnId, groupId });
    if (r.ret !== 0 && r.err !== 0) {
      throw new Error(`ACD SignOutGroup ${groupId} ret=${r.ret} err=${r.err ?? ''}`);
    }
  }
}

export async function acdSignInSkills(opts: {
  agentId: number;
  vdnId: number;
  skillIds: number[];
}): Promise<void> {
  for (const skillId of opts.skillIds) {
    const r = await acdSignInSkill({ agentId: opts.agentId, vdnId: opts.vdnId, skillId });
    if (!acdSignOk(r.ret, r.err)) {
      throw new Error(`ACD SignInSkill ${skillId} ret=${r.ret} err=${r.err ?? ''}`);
    }
  }
}

export async function acdSignOutSkills(opts: {
  agentId: number;
  vdnId: number;
  skillIds: number[];
}): Promise<void> {
  for (const skillId of opts.skillIds) {
    const r = await acdSignOutSkill({ agentId: opts.agentId, vdnId: opts.vdnId, skillId });
    if (r.ret !== 0 && r.err !== 0) {
      throw new Error(`ACD SignOutSkill ${skillId} ret=${r.ret} err=${r.err ?? ''}`);
    }
  }
}

