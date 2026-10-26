/**
 * Shared ITR/ACD queue registry + FinishEvt assignment.
 */
import { prisma } from '../../plugins/db.js';
import { ensureConversationParticipant } from '../../shared/services/conversation-participation.js';
import { ioRef } from '../../processors/socket-ref.js';
import { writeSystemMessage } from '../../shared/services/conversation-lifecycle.js';
import { mergeAttrs } from '../../shared/services/conversation-attrs.js';
import { acdCancel } from '../../integrations/ccs/acd-client.js';
import { recordSessionAssigned, recordSessionEnded, recordSessionQueued } from '../../shared/services/omni-session-log.js';
import {
  loadLeaveMessages,
  saveLeaveMessages,
  type PersistedLeaveMsg,
} from '../../shared/services/omni-runtime-persist.js';
import { agentDbg } from './debug-ingest.js';
import { getConnectTip } from '../../shared/services/omni-ops.js';
import {
  channelOfConversation,
  resolveRoutes,
  type RouteTrigger,
} from '../../shared/services/channel-route.js';

export type ConvKey = string;

export type QueueEntry = {
  requestId: number;
  vdnId: number;
  conversationId: number;
  startedAt: number;
  ewt?: number;
  queueLen?: number;
  /** ITR staff_service.connectTip，FinishEvt 时用坐席姓名插值后发给访客 */
  connectTip?: string;
  skillId?: number;
  agentGroupId?: number;
};

const FALLBACK_CONNECT_TIP = '{{agentName}}坐席为您服务';

/** conversationId → queue state */
export const queueByConv = new Map<ConvKey, QueueEntry>();

/** requestId → conversationId for FinishEvt */
export const convByRequest = new Map<number, number>();

/** conversations currently hosted by ITR (awaiting visitor replies) */
export const itrHosted = new Set<ConvKey>();

export type LeaveMsg = {
  id: string;
  conversationId: number;
  content: string;
  createdAt: string;
  status: 'open' | 'claimed' | 'closed';
  assigneeId?: number;
  /**
   * 留言原因（非工作时间 / 排队溢出 / 坐席全忙等）。
   * 由 ITR 在回调时通过 metaJson.reason 上报；拿不到时留空，前端不显示该列。
   */
  reason?: string;
};
export const leaveMessages: LeaveMsg[] = [];

export function parseConvId(raw: unknown): number {
  const s = String(raw ?? '');
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

export function markItrHosted(conversationId: number | string, on = true) {
  const key = String(conversationId);
  if (on) itrHosted.add(key);
  else itrHosted.delete(key);
  const id = Number(key) || parseConvId(key);
  if (Number.isFinite(id) && id > 0) {
    void persistAcdQueueAttrs(id, { itr_hosted: on });
  }
}

export function isItrHosted(conversationId: number | string): boolean {
  return itrHosted.has(String(conversationId));
}

/**
 * 这个会话当前挂着的 ITR 流程是「坐席回复超时流程」吗？
 *
 * 这是 Omni 对自己行为的记录（它自己启动的流程），不是业务判断：
 * 会话已分配到坐席时，只有超时流程在等客户答复，客户的消息才该喂给流程；
 * 菜单流程（客户跟坐席说话时）必须交回坐席，否则客户收到「输入无效，请重新选择。」。
 *
 * 为什么不能"先发一条给 ITR 试试"：itrOnMessage 会把流程往前推进（菜单节点会
 * 直接回一句输入无效），探询本身就有副作用，撤不回来。
 *
 * 由流程结束/会话消失时清除；进程重启丢失只会退回"消息交给坐席"，是安全方向。
 */
const timeoutFlowConvs = new Set<string>();

export function markTimeoutFlow(conversationId: number | string): void {
  timeoutFlowConvs.add(String(conversationId));
}

export function isTimeoutFlow(conversationId: number | string): boolean {
  return timeoutFlowConvs.has(String(conversationId));
}

export function clearTimeoutFlow(conversationId: number | string): void {
  timeoutFlowConvs.delete(String(conversationId));
}

export function rememberQueue(entry: QueueEntry) {
  const key = String(entry.conversationId);
  const prev = queueByConv.get(key);
  const merged: QueueEntry = {
    ...prev,
    ...entry,
    connectTip: (entry.connectTip || prev?.connectTip || '').trim() || undefined,
  };
  queueByConv.set(key, merged);
  convByRequest.set(merged.requestId, merged.conversationId);
  void persistAcdQueueAttrs(merged.conversationId, {
    acd_request_id: merged.requestId,
    acd_vdn_id: merged.vdnId,
    ...(merged.connectTip ? { itr_connect_tip: merged.connectTip } : {}),
    ...(merged.skillId ? { acd_skill_id: merged.skillId } : {}),
    ...(merged.agentGroupId ? { acd_group_id: merged.agentGroupId } : {}),
    acd_queued: true,
  });
  recordSessionQueued({
    conversationId: merged.conversationId,
    requestId: merged.requestId,
    vdnId: merged.vdnId,
    skillId: merged.skillId,
    agentGroupId: merged.agentGroupId,
  });
  void emitQueuedToAccount(merged.conversationId);
}

async function emitQueuedToAccount(conversationId: number) {
  try {
    const conv = await prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { account_id: true },
    });
    if (!conv) return;
    ioRef.get()?.to(`account:${conv.account_id}`).emit('conversation.created', {
      conversation_id: conversationId,
      queued: true,
    });
  } catch {
    /* best effort */
  }
}

async function persistAcdQueueAttrs(conversationId: number, patch: Record<string, unknown>) {
  try {
    const conv = await prisma.conversations.findUnique({
      where: { id: conversationId },
      select: { additional_attributes: true },
    });
    if (!conv) return;
    await prisma.conversations.update({
      where: { id: conversationId },
      data: { additional_attributes: mergeAttrs(conv.additional_attributes, patch) as object },
    });
  } catch {
    /* best effort */
  }
}

export function forgetQueue(conversationId: number | string) {
  const key = String(conversationId);
  const q = queueByConv.get(key);
  if (q) {
    convByRequest.delete(q.requestId);
    queueByConv.delete(key);
  }
  const id = Number(key) || parseConvId(key);
  if (Number.isFinite(id) && id > 0) {
    void persistAcdQueueAttrs(id, { acd_queued: false });
  }
}

export function queueEntryFromAttrs(conversationId: number, attrs: Record<string, unknown>): QueueEntry | null {
  if (attrs.acd_queued !== true && attrs.acd_queued !== 'true') return null;
  const requestId = Number(attrs.acd_request_id);
  const vdnId = Number(attrs.acd_vdn_id);
  if (!Number.isFinite(requestId) || requestId <= 0 || !Number.isFinite(vdnId) || vdnId <= 0) return null;
  const skillId = Number(attrs.acd_skill_id);
  const agentGroupId = Number(attrs.acd_group_id);
  return {
    requestId,
    vdnId,
    conversationId,
    startedAt: Date.now(),
    connectTip: String(attrs.itr_connect_tip || '').trim() || undefined,
    skillId: Number.isFinite(skillId) && skillId > 0 ? skillId : undefined,
    agentGroupId: Number.isFinite(agentGroupId) && agentGroupId > 0 ? agentGroupId : undefined,
  };
}

export function addLeaveMessage(row: LeaveMsg): void {
  leaveMessages.unshift(row);
  persistLeaveMessages();
}

export function persistLeaveMessages(): void {
  void saveLeaveMessages(leaveMessages as PersistedLeaveMsg[]);
}

export async function restoreItrRuntime(): Promise<{ queues: number; hosted: number; leaves: number }> {
  const stored = await loadLeaveMessages();
  if (stored.length) {
    leaveMessages.splice(0, leaveMessages.length, ...stored);
  }
  let queues = 0;
  let hosted = 0;
  try {
    const rows = await prisma.conversations.findMany({
      where: { status: 0, assignee_id: null },
      select: { id: true, additional_attributes: true },
      take: 800,
    });
    for (const row of rows) {
      const attrs = (row.additional_attributes || {}) as Record<string, unknown>;
      const entry = queueEntryFromAttrs(row.id, attrs);
      if (entry) {
        queueByConv.set(String(row.id), entry);
        convByRequest.set(entry.requestId, entry.conversationId);
        queues += 1;
      }
      if (attrs.itr_hosted === true || attrs.itr_hosted === 'true') {
        itrHosted.add(String(row.id));
        hosted += 1;
      }
    }
  } catch {
    /* best effort */
  }
  return { queues, hosted, leaves: leaveMessages.length };
}

async function createOutgoingMessage(conversationId: number, content: string) {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: { id: true, account_id: true, inbox_id: true },
  });
  if (!conv) return null;
  await writeSystemMessage(conv, content, 'itr');
  return true;
}

function renderConnectTip(
  template: string,
  vars: { agentName: string; workNo: string; agentId: number },
): string {
  // 拿不到工号时不能渲染出「工号为您服务」这种残句，直接回退到默认话术。
  const configured = (template || '').trim();
  const tpl = (configured && (vars.workNo || !configured.includes('{{workNo}}'))
    ? configured
    : FALLBACK_CONNECT_TIP).trim() || FALLBACK_CONNECT_TIP;
  return tpl
    .replace(/\{\{\s*agentName\s*\}\}/gi, vars.agentName)
    .replace(/\{\{\s*workNo\s*\}\}/gi, vars.workNo)
    .replace(/\{\{\s*agentId\s*\}\}/gi, String(vars.agentId));
}

async function resolveAgentDisplayName(
  userId: number | null,
  agentId: number,
): Promise<{ agentName: string; workNo: string }> {
  let workNo = '';
  try {
    const { getSessionByAgentId } = await import('../../integrations/ccs/session-manager.js');
    workNo = String(getSessionByAgentId(agentId)?.workNO || '').trim();
  } catch {
    /* optional */
  }
  if (userId) {
    const u = await prisma.users.findUnique({
      where: { id: userId },
      select: { name: true, uid: true },
    });
    const name = String(u?.name || '').trim();
    if (name) return { agentName: name, workNo: workNo || String(u?.uid || '').trim() };
    const uid = String(u?.uid || '').trim();
    if (uid) return { agentName: uid, workNo: workNo || uid };
  }
  if (workNo) return { agentName: workNo, workNo };
  return { agentName: '人工', workNo };
}

/** Widget 排除 message_type=2，接通欢迎语必须写成访客可见的 outgoing。 */
export async function writeVisitorChatMessage(
  conversationId: number,
  content: string,
  senderId?: number | null,
) {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: { id: true, account_id: true, inbox_id: true },
  });
  if (!conv) return null;
  const msg = await prisma.messages.create({
    data: {
      account_id: conv.account_id,
      inbox_id: conv.inbox_id,
      conversation_id: conv.id,
      content,
      message_type: 1,
      content_type: 0,
      content_attributes: { kind: 'itr', event: 'agent_connected' },
      private: false,
      sender_type: senderId ? 'User' : null,
      sender_id: senderId ?? null,
    },
  });
  await prisma.conversations.update({
    where: { id: conv.id },
    data: { last_activity_at: new Date() },
  });
  const payload = {
    id: msg.id,
    content: msg.content,
    message_type: 'outgoing',
    content_type: 'text',
    content_attributes: msg.content_attributes,
    private: false,
    sender_type: msg.sender_type,
    sender_id: msg.sender_id,
    conversation_id: msg.conversation_id,
    account_id: msg.account_id,
    created_at: msg.created_at.getTime(),
  };
  const io = ioRef.get();
  io?.to(`account:${conv.account_id}`).emit('message.created', payload);
  io?.to(`conversation_${conversationId}`).emit('message.created', payload);
  if (senderId) io?.to(`user:${senderId}`).emit('message.created', payload);
  agentDbg('K', 'itr-queue.ts:writeVisitorChatMessage', 'visitor greeting persisted', {
    conversationId,
    messageId: msg.id,
    preview: content.slice(0, 40),
  });
  return msg;
}

function emitConversationAssigned(accountId: number, conversationId: number, assigneeId: number) {
  const io = ioRef.get();
  const payload = {
    conversation_id: conversationId,
    assignee_id: assigneeId,
    omni_lifecycle: 'assigned',
  };
  // #region agent log
  agentDbg('L', 'itr-queue.ts:emitConversationAssigned', 'emit assigned', {
    conversationId,
    assigneeId,
    accountId,
    hasIo: !!io,
  });
  // #endregion
  if (!io) return;
  io.to(`account:${accountId}`).emit('conversation.assigned', payload);
  io.to(`user:${assigneeId}`).emit('conversation.assigned', payload);
  io.to(`account:${accountId}`).emit('conversation.lifecycle_changed', payload);
  io.to(`user:${assigneeId}`).emit('conversation.lifecycle_changed', payload);
  io.to(`account:${accountId}`).emit('conversation.created', payload);
  io.to(`user:${assigneeId}`).emit('conversation.created', payload);
}

export async function assignConversation(
  conversationId: number,
  agentUserId: number,
  opts?: { method?: 'inbound' | 'queue_take' | 'snatch' | 'intercept' | 'transfer' | 'leave_claim'; actorUserId?: number },
) {
  const conv = await prisma.conversations.update({
    where: { id: conversationId },
    data: {
      assignee_id: agentUserId,
      status: 0,
      updated_at: new Date(),
    },
  });
  await ensureConversationParticipant(conv, agentUserId);
  emitConversationAssigned(conv.account_id, conversationId, agentUserId);
  recordSessionAssigned({
    conversationId,
    assigneeUserId: agentUserId,
    method: opts?.method ?? 'inbound',
    actorUserId: opts?.actorUserId ?? agentUserId,
  });
}

/** 从 ACD IMS 排队主动接会话：先 cancel 再分配，避免 FinishEvt 再分给别人。 */
export async function claimQueuedConversation(opts: {
  conversationId: number;
  agentUserId: number;
  ccsAgentId: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const convId = opts.conversationId;
  const conv = await prisma.conversations.findUnique({
    where: { id: convId },
    select: { id: true, additional_attributes: true, assignee_id: true },
  });
  if (!conv) return { ok: false, error: '会话不存在' };
  const q = queueByConv.get(String(convId));
  const attrs = (conv.additional_attributes || {}) as Record<string, unknown>;
  const requestId = Number(q?.requestId || attrs.acd_request_id || convId);
  const vdnId = Number(q?.vdnId || attrs.acd_vdn_id || 0);
  if (requestId && vdnId) {
    try {
      await acdCancel({ requestId, vdnId });
    } catch {
      /* 可能已被 FinishEvt 分走，下面仍尝试接管 */
    }
  }
  const connectTip = await getConnectTip(q?.connectTip || String(attrs.itr_connect_tip || '').trim());
  forgetQueue(convId);
  markItrHosted(convId, false);
  const alreadyAssigned = !!conv.assignee_id && conv.assignee_id !== opts.agentUserId;
  await assignConversation(convId, opts.agentUserId, {
    method: alreadyAssigned ? 'snatch' : 'queue_take',
    actorUserId: opts.agentUserId,
  });
  await persistAcdQueueAttrs(convId, {
    acd_request_id: requestId,
    acd_agent_id: opts.ccsAgentId,
    itr_hosted: false,
  });
  const { agentName, workNo } = await resolveAgentDisplayName(opts.agentUserId, opts.ccsAgentId);
  const greeting = renderConnectTip(connectTip, {
    agentName,
    workNo,
    agentId: opts.ccsAgentId,
  });
  const greetingMsg = await writeVisitorChatMessage(convId, greeting, opts.agentUserId);
  await pushVisitorMessageToChannel(convId, greetingMsg?.id ?? 0, greeting);
  return { ok: true };
}

/**
 * 把一条「访客可见」的消息也投一次渠道。
 *
 * `writeVisitorChatMessage` 只写库 + socket 推送（坐席工作台能看到），**不投渠道**。
 * 被动回复形态下这就意味着客户永远收不到 —— 实测到的现象：接通时坐席侧显示
 * 「工号1001为您服务」，客户侧只看到上一条「正在转接人工，请稍候…」，
 * 而两条其实只差 26 毫秒、全在同一个 webhook 窗口内。
 *
 * 凡是「写库让工作台看到」还不够、必须让**客户**也看到的消息，都要跟一次本函数：
 * 被动形态会进等待槽（当次窗口带回给客户），主动形态直接推送。
 * 失败不影响主流程，所以只记日志不抛。
 */
export async function pushVisitorMessageToChannel(
  conversationId: number,
  messageId: number,
  content: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { dispatchItrOutbound } = await import('../../shared/services/itr-outbound.js');
    await dispatchItrOutbound(conversationId, messageId, content, 'text', meta);
  } catch (e) {
    console.warn('[itr] push visitor message to channel failed', { conversationId, e });
  }
}

/** Map ACD agentId → Omni users.id via custom_attributes */
export async function resolveOmniUserId(agentId: number): Promise<number | null> {
  const { getSessionByAgentId } = await import('../../integrations/ccs/session-manager.js');
  const live = getSessionByAgentId(agentId);
  if (live?.userId) return live.userId;
  const users = await prisma.users.findMany({ take: 80 });
  for (const u of users) {
    const attrs = (u as { custom_attributes?: unknown }).custom_attributes;
    if (attrs && typeof attrs === 'object') {
      const a = attrs as Record<string, unknown>;
      if (Number(a.agentId) === agentId || Number(a.AgentID) === agentId || Number(a.ccs_agent_id) === agentId) {
        return u.id;
      }
    }
  }
  return null;
}

export async function applyAcdFinishEvt(evt: {
  requestId: number;
  agentId: number;
  finishedType: number;
  groupId?: number;
  skillId?: number;
}) {
  // #region agent log
  agentDbg('K', 'itr-queue.ts:applyAcdFinishEvt', 'ACD FinishEvt', {
    requestId: evt.requestId,
    agentId: evt.agentId,
    finishedType: evt.finishedType,
    groupId: evt.groupId ?? 0,
    skillId: evt.skillId ?? 0,
    known: convByRequest.has(evt.requestId),
  });
  // #endregion
  const convId = convByRequest.get(evt.requestId);
  if (!convId) {
    console.warn(`[acd-cb] FinishEvt unknown requestId=${evt.requestId} agentId=${evt.agentId}`);
    return { result: 1, message: 'unknown requestId' };
  }
  const queued = queueByConv.get(String(convId));
  let connectTip = (queued?.connectTip || '').trim();
  forgetQueue(convId);
  markItrHosted(convId, false);
  if (!connectTip) {
    try {
      const conv = await prisma.conversations.findUnique({
        where: { id: convId },
        select: { additional_attributes: true },
      });
      const attrs = (conv?.additional_attributes || {}) as Record<string, unknown>;
      connectTip = String(attrs.itr_connect_tip || '').trim();
    } catch {
      /* optional */
    }
  }

  if (evt.finishedType !== 0) {
    // 结果码路由（on_acd_<finishedType>，码值见 ACD_QUE_FIN_T）：该渠道配了就按配置走；
    // 没配则维持原行为（记入留言列表 + 提示一句），保证不改变既有表现。
    const routed = await routeAcdResult(convId, evt.finishedType);
    if (routed) {
      recordSessionEnded({ conversationId: convId, cause: 'timeout' });
      return { result: 0, message: 'queue finished, routed', state: 'routed' };
    }
    leaveMessages.unshift({
      id: `lm-${Date.now()}`,
      conversationId: convId,
      content: `[系统] ACD 排队结束 finishedType=${evt.finishedType}，请跟进访客。`,
      createdAt: new Date().toISOString(),
      status: 'open',
    });
    persistLeaveMessages();
    await createOutgoingMessage(
      convId,
      `排队未接通（finishedType=${evt.finishedType}），已记入留言列表。`,
    );
    recordSessionEnded({ conversationId: convId, cause: 'timeout' });
    return { result: 0, message: 'queue finished non-success', state: 'leave' };
  }

  const userId = await resolveOmniUserId(evt.agentId);
  if (userId) await assignConversation(convId, userId, { method: 'inbound' });
  else console.warn(`[acd-cb] FinishEvt no Omni user for AgentID=${evt.agentId} conv=${convId}`);
  await persistAcdQueueAttrs(convId, {
    acd_request_id: evt.requestId,
    acd_agent_id: evt.agentId,
    itr_hosted: false,
  });
  const { agentName, workNo } = await resolveAgentDisplayName(userId, evt.agentId);
  const greeting = renderConnectTip(await getConnectTip(connectTip), {
    agentName,
    workNo,
    agentId: evt.agentId,
  });
  const greetingMsg = await writeVisitorChatMessage(convId, greeting, userId);
  await pushVisitorMessageToChannel(convId, greetingMsg?.id ?? 0, greeting);
  return { result: 0, message: 'assigned', state: 'transferred', agentId: evt.agentId, userId };
}

export async function applyAcdRingAck(ack: {
  requestId: number;
  result: number;
  queueLen?: number;
  ewt?: number;
}) {
  // #region agent log
  agentDbg('J', 'itr-queue.ts:applyAcdRingAck', 'ACD RingAck', {
    requestId: ack.requestId,
    result: ack.result,
    queueLen: ack.queueLen ?? 0,
    ewt: ack.ewt ?? 0,
    known: convByRequest.has(ack.requestId),
  });
  // #endregion
  const convId = convByRequest.get(ack.requestId);
  if (!convId) return { result: 1, message: 'unknown requestId' };
  const q = queueByConv.get(String(convId));
  if (q) {
    q.queueLen = ack.queueLen;
    q.ewt = ack.ewt;
  }
  if (ack.result !== 0) {
    forgetQueue(convId);
    // 结果码路由：该渠道配了 on_acd_<码> 就按配置执行（候选按序、失败降级）；
    // 没配就维持原行为（发一条进队失败提示），保证不改变既有表现。
    const routed = await routeAcdResult(convId, ack.result);
    if (!routed) {
      await createOutgoingMessage(convId, `进队失败（RingAck result=${ack.result}）。`);
    }
    return { result: ack.result, message: 'ring failed', state: 'failed' };
  }
  // 进队成功：把会话的「应用 / 应用类型」标成 ACD（业务引擎第 4 步）。
  // 后续的结果码路由、超时路由都能据此看出会话当时挂在哪个应用上。
  await persistAcdQueueAttrs(convId, { route_app_type: 'acd' });
  return { result: 0, message: 'queued', state: 'queued', queueLen: ack.queueLen, ewt: ack.ewt };
}

/**
 * 按 ACD 结果码路由：触发点 on_acd_<码>，码值见 Include/acd_struct.h 的 ACD_QUE_FIN_T。
 *
 * 返回 true 表示「该渠道对此结果码配了路由」（不管执行成败都算 true）——
 * 调用方据此决定要不要再补一句默认提示，避免配了路由还多一句无用的"进队失败"。
 */
async function routeAcdResult(conversationId: number, code: number): Promise<boolean> {
  try {
    const { channelType, channelId } = await channelOfConversation(conversationId);
    if (channelId <= 0) return false;
    const { normalizeRouteChannelType } = await import('../../shared/services/channel-route.js');
    const routeType = normalizeRouteChannelType(channelType);
    if (!routeType) return false;
    const trigger = `on_acd_${Number(code) || 0}` as RouteTrigger;
    const targets = await resolveRoutes(channelId, trigger, routeType);
    if (!targets.length) return false;
    // 动态 import：route-exec 依赖本模块（assignConversation/rememberQueue…），
    // 静态 import 会成环。
    const { executeRoutes } = await import('./route-exec.js');
    const out = await executeRoutes(conversationId, targets);
    console.log('[acd-route] result routed', {
      conversationId,
      code,
      ok: out.ok,
      used: out.used?.appType ?? null,
      message: out.message,
    });
    return true;
  } catch (e) {
    console.warn('[acd-route] failed', e);
    return false;
  }
}
