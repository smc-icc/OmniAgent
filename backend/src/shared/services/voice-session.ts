import { prisma } from '../../plugins/db.js';
import { ensureConversationParticipant } from './conversation-participation.js';
import {
  findOrCreateContact,
  findOrCreateContactInbox,
  findOrCreateOpenConversation,
} from './channel-incoming.js';
import {
  asAttrMap,
  markConversationEnded,
  mergeAttrs,
  writeSystemMessage,
} from './conversation-lifecycle.js';
import { lookupCallCdr, lookupRecordFilesByNumber, lookupRecordPath } from './icc-call-dal.js';
import { listRecentRecordingFiles } from './recording-access.js';
import { matchRecordFile } from './recording-match.js';
import {
  loadGroupsByVdnFromIccDb,
  loadVdnAsrEngine,
} from './icc-groups-dal.js';
import { ensureVoiceInbox } from './voice-inbox.js';
import { maybeAutoSubmitAiqc } from './aiqc-auto-submit.js';
import { resolveVoiceActor, voiceReadScope, type VoiceActorInput } from './voice-tenant.js';
import { confTenancyEnabled } from './conf-tenancy.js';
import { accessScope } from '../../modules/access/access.scope.js';

const callConvMap = new Map<string, number>();
const callKey = (accountId: number, vdnId: number, callId: number) => `${accountId}:${vdnId}:${callId}`;

export interface VoicePersistHooks {
  emitToAccount?: (accountId: number, event: string, data: unknown) => void;
  emitToUser?: (userId: number, event: string, data: unknown) => void;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

function isAgentCallOffer(payload: Record<string, unknown>): boolean {
  const t = num(payload.CallOfferedType) ?? 0;
  const data = str(payload.CallData);
  return t === 2 || data.startsWith('agent_');
}

function parseAgentCallOffer(payload: Record<string, unknown>): {
  role: 'caller' | 'callee';
  peerWorkNo: string;
  peerName: string;
} | null {
  if (!isAgentCallOffer(payload)) return null;
  const role: 'caller' | 'callee' = str(payload.CallData) === 'agent_caller' ? 'caller' : 'callee';
  let peerName = '';
  try {
    const raw = payload.JsonPrivateInfo;
    const j = typeof raw === 'string' && raw.trim() ? (JSON.parse(raw) as { peerName?: string }) : null;
    peerName = String(j?.peerName ?? '').trim();
  } catch {
    /* ignore */
  }
  const peerWorkNo = (role === 'caller' ? str(payload.Called) : str(payload.Caller)).trim();
  return {
    role,
    peerWorkNo: peerWorkNo || peerName || '未知坐席',
    peerName: peerName || peerWorkNo || '未知坐席',
  };
}

function agentCallSessionKey(userId: number, peerWorkNo: string): string {
  return `ccs-agent-${userId}-${peerWorkNo}`;
}

async function findOpenAgentCallConversation(accountId: number, userId: number, peerWorkNo: string) {
  if (!userId || !peerWorkNo) return null;
  const key = agentCallSessionKey(userId, peerWorkNo);
  const rows = await prisma.conversations.findMany({
    where: { account_id: accountId, assignee_id: userId, status: 0 },
    orderBy: { last_activity_at: 'desc' },
    take: 40,
    select: { id: true, additional_attributes: true },
  });
  const hit = rows.find((r) => asAttrMap(r.additional_attributes).omni_session_key === key);
  if (!hit) return null;
  return prisma.conversations.findUnique({ where: { id: hit.id } });
}

async function createAssignedVoiceConversation(
  accountId: number,
  inboxId: number,
  contactId: number,
  contactInboxId: number,
  assigneeId: number,
  additionalAttributes: Record<string, unknown>,
) {
  const last = await prisma.conversations.findFirst({
    where: { account_id: accountId },
    orderBy: { display_id: 'desc' },
    select: { display_id: true },
  });
  return prisma.conversations.create({
    data: {
      account_id: accountId,
      inbox_id: inboxId,
      contact_id: contactId,
      contact_inbox_id: contactInboxId,
      display_id: (last?.display_id ?? 0) + 1,
      status: 0,
      assignee_id: assigneeId || undefined,
      additional_attributes: additionalAttributes as object,
      contact_last_seen_at: new Date(),
      last_activity_at: new Date(),
    },
  });
}

async function findLatestOpenAgentCall(accountId: number, userId: number) {
  if (!userId) return null;
  const rows = await prisma.conversations.findMany({
    where: { account_id: accountId, assignee_id: userId, status: 0 },
    orderBy: { last_activity_at: 'desc' },
    take: 20,
    select: { id: true, additional_attributes: true },
  });
  const hit = rows.find((r) =>
    String(asAttrMap(r.additional_attributes).call_method ?? '').includes('坐席呼坐席'),
  );
  if (!hit) return null;
  return prisma.conversations.findUnique({ where: { id: hit.id } });
}

function talkSeconds(attrs: Record<string, unknown>, endedAt: Date): number {
  const raw = attrs.answered_at ?? attrs.offered_at;
  if (typeof raw !== 'string') return 0;
  const start = new Date(raw).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.round((endedAt.getTime() - start) / 1000));
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function resolveSkillName(vdnId: number | undefined, groupId: number | undefined): Promise<string | undefined> {
  if (!vdnId || !groupId) return undefined;
  const groups = await loadGroupsByVdnFromIccDb(vdnId);
  return groups.find((g) => g.id === groupId)?.name;
}

async function findConversationByCallId(accountId: number, vdnId: number, callId: number, userId?: number) {
  const mapped = callConvMap.get(callKey(accountId, vdnId, callId));
  if (mapped) {
    const conv = await prisma.conversations.findUnique({ where: { id: mapped } });
    if (conv?.account_id === accountId && (!userId || conv.assignee_id === userId)) return conv;
  }
  const rows = await prisma.conversations.findMany({
    where: { account_id: accountId, status: 0, ...(userId ? { assignee_id: userId } : {}) },
    orderBy: { last_activity_at: 'desc' },
    take: 80,
    select: { id: true, additional_attributes: true },
  });
  const hit = rows.find((r) => asAttrMap(r.additional_attributes).ccs_call_id === callId);
  if (!hit) return null;
  return prisma.conversations.findUnique({ where: { id: hit.id } });
}

export async function persistVoiceOffered(
  payload: Record<string, unknown>,
  ctx: { userId: number; vdnId?: number; agentId?: number | null },
  hooks: VoicePersistHooks = {},
) {
  const callId = num(payload.CallID);
  if (callId == null) return null;
  const actor = await resolveVoiceActor(ctx);
  const accountId = actor.accountId;

  const caller = str(payload.Caller) || '未知号码';
  const called = str(payload.Called);
  const groupId = num(payload.AgentGroupID);
  const skillId = num(payload.SkillID);
  const offeredType = num(payload.CallOfferedType) ?? 0;
  const agentCall = parseAgentCallOffer(payload);
  const callMethod = agentCall
    ? (agentCall.role === 'caller' ? '坐席呼坐席·主叫方' : '坐席呼坐席·被叫方')
    : offeredType === 10
      ? '外呼'
      : offeredType === 7
        ? '转接'
        : '来电';
  const inbox = await ensureVoiceInbox(accountId);
  const skillName = await resolveSkillName(ctx.vdnId, groupId);
  const asrEngine = await loadVdnAsrEngine(ctx.vdnId ?? 0);

  const contactSource = agentCall ? agentCall.peerWorkNo : caller;
  const contactName = agentCall ? agentCall.peerName : caller;
  const sessionKey = agentCall
    ? agentCallSessionKey(ctx.userId, agentCall.peerWorkNo)
    : `ccs-phone-${callId}`;

  const existingAgentConv = agentCall
    ? await findOpenAgentCallConversation(accountId, ctx.userId, agentCall.peerWorkNo)
    : null;

  const contact = await findOrCreateContact(
    accountId,
    contactSource,
    contactName,
    { ccs_call_id: callId },
    'phone',
  );
  const contactInbox = await findOrCreateContactInbox(inbox.id, contact.id, contactSource);
  const offerAttrs: Record<string, unknown> = {
    channel: 'voice',
    omni_lifecycle: 'active',
    ccs_call_id: callId,
    ccs_agent_id: ctx.agentId ?? num(payload.AgentID) ?? null,
    caller: agentCall ? str(payload.Caller) : caller,
    called,
    vdn_id: ctx.vdnId ?? null,
    asr_engine: asrEngine,
    agent_group_id: groupId ?? null,
    skill_id: skillId ?? null,
    skill_group_name: skillName ?? null,
    offered_at: new Date().toISOString(),
    call_offered_type: agentCall ? 2 : offeredType,
    call_method: callMethod,
    recording_status: 'pending',
    omni_session_key: sessionKey,
    agent_call_role: agentCall?.role ?? null,
    agent_call_peer: agentCall?.peerWorkNo ?? null,
  };

  let conversation = existingAgentConv
    ? await prisma.conversations.update({
        where: { id: existingAgentConv.id },
        data: {
          additional_attributes: mergeAttrs(existingAgentConv.additional_attributes, offerAttrs) as object,
          last_activity_at: new Date(),
        },
      })
    : agentCall
      ? await createAssignedVoiceConversation(
          accountId,
          inbox.id,
          contact.id,
          contactInbox.id,
          ctx.userId,
          offerAttrs,
        )
      : await findOrCreateOpenConversation(
          accountId,
          inbox.id,
          contact.id,
          contactInbox.id,
          offerAttrs,
        );

  callConvMap.set(callKey(accountId, actor.vdnId, callId), conversation.id);

  // 转接目标 Offered 时必须接管会话；否则源坐席 CallEnd 会按旧 assignee 误关同一通话会话
  if (ctx.userId && conversation.assignee_id !== ctx.userId) {
    await prisma.conversations.update({
      where: { id: conversation.id },
      data: { assignee_id: ctx.userId },
    });
    conversation = { ...conversation, assignee_id: ctx.userId };
  }

  await ensureConversationParticipant(conversation, ctx.userId);

  const offerText = agentCall
    ? `坐席呼坐席（${agentCall.role === 'caller' ? '主叫方' : '被叫方'}）· ${agentCall.peerName}（${agentCall.peerWorkNo}）`
    : callMethod === '转接'
      ? `转接接入（${caller}${called ? ` → ${called}` : ''}）`
      : callMethod === '外呼'
        ? `外呼（${caller}${called ? ` → ${called}` : ''}）`
        : `来电接入（${caller}${called ? ` → ${called}` : ''}）`;
  await writeSystemMessage(
    conversation,
    offerText,
    'call_offered',
    agentCall
      ? `ccs-offer-agent-${ctx.userId}-${agentCall.peerWorkNo}`
      : `ccs-offer-${callId}-${ctx.agentId ?? ctx.userId}`,
  );

  hooks.emitToAccount?.(accountId, 'conversation.created', {
    id: conversation.id,
    conversation_id: conversation.id,
  });
  hooks.emitToUser?.(ctx.userId, 'omni.phone_conversation', {
    call_id: callId,
    conversation_id: conversation.id,
    contact_id: contact.id,
    name: contact.name,
    phone: contact.phone_number ?? contactSource,
  });
  return conversation;
}

export async function persistVoiceAnswered(
  payload: Record<string, unknown>,
  ctx: VoiceActorInput = {},
) {
  const callId = num(payload.CallID);
  if (callId == null) return;
  const actor = await resolveVoiceActor(ctx);
  let conv = await findConversationByCallId(actor.accountId, actor.vdnId, callId, ctx.userId);
  if (!conv && ctx.userId) {
    conv = await findLatestOpenAgentCall(actor.accountId, ctx.userId);
  }
  if (!conv) return;
  callConvMap.set(callKey(actor.accountId, actor.vdnId, callId), conv.id);
  const attrs = mergeAttrs(conv.additional_attributes, {
    omni_lifecycle: 'active',
    answered_at: new Date().toISOString(),
  });
  await prisma.conversations.update({
    where: { id: conv.id },
    data: { additional_attributes: attrs as object, last_activity_at: new Date() },
  });
}

export async function persistVoiceEnded(
  payload: Record<string, unknown>,
  hooks: VoicePersistHooks = {},
  ctx: VoiceActorInput = { userId: 0 },
) {
  const callId = num(payload.CallID);
  if (callId == null) return;
  const actor = await resolveVoiceActor(ctx);
  const conv = await findConversationByCallId(actor.accountId, actor.vdnId, callId, ctx.userId);
  if (!conv || conv.status !== 0) return;

  const attrs = asAttrMap(conv.additional_attributes);
  const ownerAgentId = num(attrs.ccs_agent_id);
  const ownedByUser = (ctx.userId ?? 0) > 0 && conv.assignee_id === ctx.userId;
  const ownedByAgent =
    ctx.agentId != null && ownerAgentId != null && ownerAgentId === ctx.agentId;
  // 转接完成后源坐席也会收到 CallEnd（同一 CallID），但会话已归属目标坐席——不可结束
  if ((conv.assignee_id != null || ownerAgentId != null) && !ownedByUser && !ownedByAgent) {
    console.info(
      `[voice-session] skip CallEnd for call ${callId}: owner user=${conv.assignee_id} agent=${ownerAgentId ?? 'n/a'}, evt user=${ctx.userId} agent=${ctx.agentId ?? 'n/a'}`,
    );
    return;
  }

  const alreadyEnded = attrs.omni_lifecycle === 'ended';
  const endedAt = new Date();
  const talkSec = talkSeconds(attrs, endedAt);
  const extra: Record<string, unknown> = {
    ended_at: endedAt.toISOString(),
    talk_time_sec: talkSec,
    recording_status: attrs.recording_path ? 'ready' : 'pending',
  };

  await markConversationEnded(
    conv.id,
    extra,
    alreadyEnded ? '' : `通话结束 · 时长 ${formatDuration(talkSec)}`,
  );
  callConvMap.delete(callKey(actor.accountId, actor.vdnId, callId));

  hooks.emitToAccount?.(conv.account_id, 'conversation.lifecycle_changed', {
    conversation_id: conv.id,
    omni_lifecycle: 'ended',
  });

  void backfillCallMeta(conv.id, callId, ctx).catch((e) => {
    console.error('[voice-session] backfill failed', e);
  });
}

async function backfillCallMeta(conversationId: number, callId: number, ctx: VoiceActorInput) {
  const delays = [2000, 5000, 15000];
  for (const wait of delays) {
    await new Promise((r) => setTimeout(r, wait));
    const actor = await resolveVoiceActor(ctx);
    const read = async () => ({ cdr: await lookupCallCdr(callId), path: await lookupRecordPath(callId) });
    const { cdr, path: initialPath } = confTenancyEnabled()
      ? await accessScope.run(voiceReadScope(actor), read) : await read();
    let path = initialPath;
    if (!path && cdr?.callerNo && cdr.beginTime) {
      const phone = cdr.callerNo || cdr.calledNo || '';
      const [dbFiles, fsFiles] = await Promise.all([
        confTenancyEnabled()
          ? accessScope.run(voiceReadScope(actor), () => lookupRecordFilesByNumber(phone, 40))
          : lookupRecordFilesByNumber(phone, 40),
        confTenancyEnabled() ? Promise.resolve([]) : listRecentRecordingFiles().catch(() => []),
      ]);
      path = matchRecordFile(
        {
          caller: cdr.callerNo || '',
          called: cdr.calledNo || '',
          beginSec: Math.floor(cdr.beginTime.getTime() / 1000),
          endSec: cdr.endTime ? Math.floor(cdr.endTime.getTime() / 1000) : null,
          talkSec: cdr.talkTimeLong,
          logicNo: callId,
        },
        dbFiles,
        fsFiles,
      );
    }
    const conv = await prisma.conversations.findUnique({ where: { id: conversationId } });
    if (!conv || conv.account_id !== actor.accountId) return;
    const patch: Record<string, unknown> = {};
    if (path) {
      patch.recording_path = path;
      patch.recording_status = 'ready';
    }
    if (cdr?.talkTimeLong != null && cdr.talkTimeLong > 0) {
      patch.talk_time_sec = cdr.talkTimeLong;
    }
    if (cdr?.callerNo) patch.caller = cdr.callerNo;
    if (cdr?.calledNo) patch.called = cdr.calledNo;
    if (!Object.keys(patch).length) continue;

    const attrs = mergeAttrs(conv.additional_attributes, patch);
    await prisma.conversations.update({
      where: { id: conversationId },
      data: { additional_attributes: attrs as object },
    });
    if (path) {
      await writeSystemMessage(conv, `录音已就绪：${path}`, 'recording_ready');
      void maybeAutoSubmitAiqc({
        conversationId,
        callId,
        recordingPath: path,
        agentId: num(asAttrMap(conv.additional_attributes).ccs_agent_id),
        asrEngine: String(
          asAttrMap(conv.additional_attributes).asr_engine ?? 'funasr',
        ),
        caller: cdr?.callerNo ?? '',
        called: cdr?.calledNo ?? '',
        talkTimeSec: cdr?.talkTimeLong ?? undefined,
      }).catch((e) => console.error('[voice-session] aiqc auto-submit failed', e));
      return;
    }
  }
}

export async function persistVoiceFromCcs(
  method: string,
  payload: Record<string, unknown>,
  ctx: { userId: number; vdnId?: number; agentId?: number | null },
  hooks: VoicePersistHooks = {},
): Promise<void> {
  try {
    if (method === 'OnAgentOnCallOfferedEvt') {
      await persistVoiceOffered(payload, ctx, hooks);
      return;
    }
    if (method === 'OnAgentOnAnsweredEvt') {
      await persistVoiceAnswered(payload, ctx);
      return;
    }
    if (method === 'OnAgentOnCallEndEvt' || method === 'OnAgentOnReleasedEvt') {
      await persistVoiceEnded(payload, hooks, ctx);
    }
  } catch (e) {
    console.error(`[voice-session] ${method} persist failed`, e);
  }
}

export function conversationIdForCall(callId: number, scope?: { accountId: number; vdnId: number }): number | undefined {
  if (!scope && confTenancyEnabled()) return undefined;
  if (!scope) {
    const matches = [...callConvMap].filter(([key]) => key.startsWith('1:') && key.endsWith(`:${callId}`));
    return matches.length === 1 ? matches[0]?.[1] : undefined;
  }
  return callConvMap.get(callKey(scope?.accountId ?? 1, scope?.vdnId ?? 0, callId));
}
