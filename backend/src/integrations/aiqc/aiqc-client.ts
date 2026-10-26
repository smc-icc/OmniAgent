import TarsRpc from '@tars/rpc';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env } from '../../config/env.js';

const require = createRequire(import.meta.url);
const generated = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'tars', 'aiqcProxy.js'),
) as {
  smc_icc: {
    aiqcProxy: new () => AIQCProxy;
    stAIQCSubmitReq: new () => TarsStruct;
    stAIQCQueryReq: new () => TarsStruct;
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

interface AIQCProxy {
  setTimeout(ms: number): void;
  SubmitTask(req: TarsStruct): Promise<RpcResult>;
  GetTaskStatus(req: TarsStruct): Promise<RpcResult>;
  CancelTask(req: TarsStruct): Promise<RpcResult>;
  RetryTask(req: TarsStruct): Promise<RpcResult>;
  QueryResults(req: TarsStruct): Promise<RpcResult>;
  GetResultDetail(req: TarsStruct): Promise<RpcResult>;
  ReviewResult(req: TarsStruct): Promise<RpcResult>;
  GetTranscript(req: TarsStruct): Promise<RpcResult>;
  QueryAnalytics(req: TarsStruct): Promise<RpcResult>;
  OpenRealtimeSession(req: TarsStruct): Promise<RpcResult>;
  PushRealtimeSegment(req: TarsStruct): Promise<RpcResult>;
  CloseRealtimeSession(req: TarsStruct): Promise<RpcResult>;
  AckAlert(req: TarsStruct): Promise<RpcResult>;
  ListAlerts(req: TarsStruct): Promise<RpcResult>;
  ListRulePackages(req: TarsStruct): Promise<RpcResult>;
  CreateRulePackage(req: TarsStruct): Promise<RpcResult>;
  CreateRuleVersion(req: TarsStruct): Promise<RpcResult>;
  PublishRuleVersion(req: TarsStruct): Promise<RpcResult>;
  GetPublishedRules(req: TarsStruct): Promise<RpcResult>;
  SubmitAppeal(req: TarsStruct): Promise<RpcResult>;
  ResolveAppeal(req: TarsStruct): Promise<RpcResult>;
  ListAppeals(req: TarsStruct): Promise<RpcResult>;
  CreateRectification(req: TarsStruct): Promise<RpcResult>;
  UpdateRectification(req: TarsStruct): Promise<RpcResult>;
  ListRectifications(req: TarsStruct): Promise<RpcResult>;
  ListAuditLogs(req: TarsStruct): Promise<RpcResult>;
  Ping(): Promise<RpcResult>;
}

export interface AIQCResponse {
  result: number;
  message: string;
  state: string;
  payload: unknown;
}

const { client } = TarsRpc as {
  client: { stringToProxy: (proxyClass: unknown, obj: string) => AIQCProxy };
};

let proxy: AIQCProxy | null = null;
let proxyObj = '';

function getProxy(): AIQCProxy {
  const obj = env.AIQC_OBJ;
  if (!obj) throw new Error('AIQC_OBJ is not configured');
  if (!proxy || proxyObj !== obj) {
    proxy = client.stringToProxy(generated.smc_icc.aiqcProxy, obj);
    proxy.setTimeout(env.AIQC_INVOKE_TIMEOUT_MS);
    proxyObj = obj;
  }
  return proxy;
}

function decode(result: RpcResult): AIQCResponse {
  const raw = result.response.arguments.rsp?.toObject?.() ?? {};
  const payloadJson = String(raw.payloadJson ?? '');
  let payload: unknown = null;
  if (payloadJson) {
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      payload = payloadJson;
    }
  }
  return {
    result: Number(raw.result ?? result.response.return ?? 0),
    message: String(raw.message ?? ''),
    state: String(raw.state ?? ''),
    payload,
  };
}

function queryReq(value: Record<string, unknown>): TarsStruct {
  return new generated.smc_icc.stAIQCQueryReq().readFromObject({
    requestJson: JSON.stringify(value),
  });
}

export async function aiqcSubmit(value: {
  taskId: string;
  sessionRef: string;
  recordingUri: string;
  policyId?: string;
  meta?: Record<string, unknown>;
}) {
  const req = new generated.smc_icc.stAIQCSubmitReq().readFromObject({
    taskId: value.taskId,
    sessionRef: value.sessionRef,
    recordingUri: value.recordingUri,
    policyId: value.policyId ?? '',
    metaJson: JSON.stringify(value.meta ?? {}),
  });
  return decode(await getProxy().SubmitTask(req));
}

export async function aiqcQueryResults(value: Record<string, unknown>) {
  return decode(await getProxy().QueryResults(queryReq(value)));
}

export async function aiqcGetResultDetail(taskId: string) {
  return decode(await getProxy().GetResultDetail(queryReq({ taskId })));
}

export async function aiqcGetTranscript(taskId: string) {
  return decode(await getProxy().GetTranscript(queryReq({ taskId })));
}

export async function aiqcReview(taskId: string, value: Record<string, unknown>) {
  return decode(await getProxy().ReviewResult(queryReq({ taskId, ...value })));
}

export async function aiqcAnalytics(value: Record<string, unknown>) {
  return decode(await getProxy().QueryAnalytics(queryReq(value)));
}

// ── Realtime sessions & alerts ──────────────────────────────────────

export async function aiqcOpenRealtime(value: Record<string, unknown>) {
  return decode(await getProxy().OpenRealtimeSession(queryReq(value)));
}

export async function aiqcPushSegment(value: Record<string, unknown>) {
  return decode(await getProxy().PushRealtimeSegment(queryReq(value)));
}

export async function aiqcCloseRealtime(value: Record<string, unknown>) {
  return decode(await getProxy().CloseRealtimeSession(queryReq(value)));
}

export async function aiqcAckAlert(alertId: number, ackedBy: string) {
  return decode(await getProxy().AckAlert(queryReq({ alertId, ackedBy })));
}

export async function aiqcListAlerts(value: Record<string, unknown>) {
  return decode(await getProxy().ListAlerts(queryReq(value)));
}

// ── Rule packages / versions ────────────────────────────────────────

export async function aiqcListRulePackages() {
  return decode(await getProxy().ListRulePackages(queryReq({})));
}

export async function aiqcCreateRulePackage(value: Record<string, unknown>) {
  return decode(await getProxy().CreateRulePackage(queryReq(value)));
}

export async function aiqcCreateRuleVersion(value: Record<string, unknown>) {
  return decode(await getProxy().CreateRuleVersion(queryReq(value)));
}

export async function aiqcPublishRuleVersion(versionId: number, actor: string) {
  return decode(await getProxy().PublishRuleVersion(queryReq({ versionId, actor })));
}

export async function aiqcGetPublishedRules(packageCode?: string) {
  return decode(await getProxy().GetPublishedRules(queryReq(packageCode ? { packageCode } : {})));
}

// ── Appeals / rectifications / audit ────────────────────────────────

export async function aiqcSubmitAppeal(value: Record<string, unknown>) {
  return decode(await getProxy().SubmitAppeal(queryReq(value)));
}

export async function aiqcResolveAppeal(value: Record<string, unknown>) {
  return decode(await getProxy().ResolveAppeal(queryReq(value)));
}

export async function aiqcListAppeals(value: Record<string, unknown>) {
  return decode(await getProxy().ListAppeals(queryReq(value)));
}

export async function aiqcCreateRectification(value: Record<string, unknown>) {
  return decode(await getProxy().CreateRectification(queryReq(value)));
}

export async function aiqcUpdateRectification(value: Record<string, unknown>) {
  return decode(await getProxy().UpdateRectification(queryReq(value)));
}

export async function aiqcListRectifications(value: Record<string, unknown>) {
  return decode(await getProxy().ListRectifications(queryReq(value)));
}

export async function aiqcListAuditLogs(value: Record<string, unknown>) {
  return decode(await getProxy().ListAuditLogs(queryReq(value)));
}

export async function aiqcPing() {
  return decode(await getProxy().Ping());
}
