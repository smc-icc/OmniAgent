/**
 * Omni 全媒体会话单 + 坐席行为流水。失败不影响主流程。
 */
import { prisma } from '../../plugins/db.js';
import { resolveChannelGroup } from './channel-group.js';
import { loadImsGroupMeta } from '../../integrations/ccs/ims-acd.js';
import { getSessionByUserId } from '../../integrations/ccs/session-manager.js';
import {
  omniEventLabel,
  omniReleaseLabel,
  omniTalkSec,
  omniWaitSec,
  type OmniReleaseCause,
  type OmniSessionEventType,
  type OmniSessionMethod,
} from './omni-session-labels.js';

export type { OmniReleaseCause, OmniSessionEventType, OmniSessionMethod };

type Actor = {
  userId?: number;
  workNo?: string;
  agentId?: number;
  name?: string;
};

type ConvRow = {
  id: number;
  account_id: number;
  inbox_id: number;
  contact_id: number | null;
  assignee_id: number | null;
  additional_attributes: unknown;
  inbox?: { channel_type: string | null } | null;
  contact?: { name: string | null; phone_number: string | null } | null;
};

let groupNameCache: Map<number, string> | null = null;

function logFail(op: string, err: unknown) {
  console.warn(`[omni-session-log] ${op}`, err instanceof Error ? err.message : err);
}

async function skillGroupName(id: number): Promise<string> {
  if (!id) return '';
  try {
    if (!groupNameCache) {
      const rows = await loadImsGroupMeta();
      groupNameCache = new Map(rows.map((g) => [g.id, g.name]));
    }
    return groupNameCache.get(id) || `组${id}`;
  } catch {
    return `组${id}`;
  }
}

async function loadConv(conversationId: number): Promise<ConvRow | null> {
  return prisma.conversations.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      account_id: true,
      inbox_id: true,
      contact_id: true,
      assignee_id: true,
      additional_attributes: true,
      inbox: { select: { channel_type: true } },
      contact: { select: { name: true, phone_number: true } },
    },
  });
}

function isMedia(conv: ConvRow): boolean {
  return resolveChannelGroup(conv.inbox?.channel_type) === 'media';
}

async function resolveActor(partial: Actor | undefined): Promise<Actor> {
  const userId = Number(partial?.userId || 0) || undefined;
  const sess = userId ? getSessionByUserId(userId) : undefined;
  let name = (partial?.name || '').trim();
  if (userId && !name) {
    try {
      const u = await prisma.users.findUnique({
        where: { id: userId },
        select: { name: true, display_name: true },
      });
      name = String(u?.display_name || u?.name || '').trim();
    } catch {
      /* ignore */
    }
  }
  return {
    userId,
    workNo: (partial?.workNo || sess?.workNO || '').trim(),
    agentId: Number(partial?.agentId || sess?.agentId || 0) || 0,
    name,
  };
}

async function openRecord(conversationId: number) {
  return prisma.omni_session_records.findFirst({
    where: { conversation_id: conversationId, ended_at: null },
    orderBy: { id: 'desc' },
  });
}

async function ensureOpenRecord(conv: ConvRow) {
  const existing = await openRecord(conv.id);
  if (existing) return existing;
  const visitor = conv.contact?.name || conv.contact?.phone_number || '';
  return prisma.omni_session_records.create({
    data: {
      conversation_id: conv.id,
      account_id: conv.account_id,
      inbox_id: conv.inbox_id,
      contact_id: conv.contact_id,
      channel: 'media',
      visitor_name: visitor,
      visitor_id: conv.contact?.phone_number || String(conv.contact_id || ''),
    },
  });
}

async function writeEvent(opts: {
  conv: ConvRow;
  recordId?: number | null;
  type: OmniSessionEventType;
  actor?: Actor;
  target?: Actor;
  summary?: string;
  payload?: Record<string, unknown>;
}) {
  const actor = await resolveActor(opts.actor);
  const target = opts.target ? await resolveActor(opts.target) : undefined;
  const summary = (opts.summary || '').trim()
    || `${omniEventLabel(opts.type)}${actor.workNo ? ` · ${actor.workNo}` : ''}${target?.workNo ? ` → ${target.workNo}` : ''}`;
  await prisma.omni_session_events.create({
    data: {
      conversation_id: opts.conv.id,
      session_record_id: opts.recordId || null,
      account_id: opts.conv.account_id,
      event_type: opts.type,
      actor_user_id: actor.userId ?? null,
      actor_work_no: actor.workNo || '',
      actor_agent_id: actor.agentId || 0,
      actor_name: actor.name || '',
      target_user_id: target?.userId ?? null,
      target_work_no: target?.workNo || '',
      target_agent_id: target?.agentId || 0,
      summary,
      payload: (opts.payload ?? {}) as object,
    },
  });
}

async function closeRecord(
  record: { id: number; queued_at: Date | null; assigned_at: Date | null; answered_at: Date | null; wait_sec: number; talk_sec: number },
  cause: OmniReleaseCause,
) {
  const now = new Date();
  await prisma.omni_session_records.update({
    where: { id: record.id },
    data: {
      ended_at: now,
      release_cause: cause,
      release_reason: omniReleaseLabel(cause),
      wait_sec: omniWaitSec(record.queued_at, record.assigned_at, record.wait_sec),
      talk_sec: omniTalkSec(record.answered_at, now, record.talk_sec),
    },
  });
}

export function recordSessionQueued(opts: {
  conversationId: number;
  requestId?: number;
  vdnId?: number;
  skillId?: number;
  agentGroupId?: number;
}): void {
  void writeQueued(opts).catch((e) => logFail('queued', e));
}

async function writeQueued(opts: {
  conversationId: number;
  requestId?: number;
  vdnId?: number;
  skillId?: number;
  agentGroupId?: number;
}) {
  const conv = await loadConv(opts.conversationId);
  if (!conv || !isMedia(conv)) return;
  const now = new Date();
  const groupId = Number(opts.agentGroupId || 0);
  const skillId = Number(opts.skillId || 0);
  const name = await skillGroupName(groupId);
  const open = await openRecord(conv.id);
  if (open?.assignee_user_id) {
    await closeRecord(open, 'transfer');
    await writeEvent({ conv, recordId: open.id, type: 'transfer', summary: '转技能重新排队' });
  }
  const alreadyQueued = !!(open && !open.assignee_user_id && open.queued_at);
  const row = open && !open.assignee_user_id
    ? await prisma.omni_session_records.update({
      where: { id: open.id },
      data: {
        queued_at: open.queued_at ?? now,
        skill_id: skillId || open.skill_id,
        skill_group_id: groupId || open.skill_group_id,
        skill_group_name: name || open.skill_group_name,
        vdn_id: Number(opts.vdnId || open.vdn_id || 0),
        acd_request_id: Number(opts.requestId || open.acd_request_id || 0),
        method: open.method === 'inbound' ? 'inbound' : open.method,
      },
    })
    : await prisma.omni_session_records.create({
      data: {
        conversation_id: conv.id,
        account_id: conv.account_id,
        inbox_id: conv.inbox_id,
        contact_id: conv.contact_id,
        channel: 'media',
        visitor_name: conv.contact?.name || conv.contact?.phone_number || '',
        visitor_id: conv.contact?.phone_number || String(conv.contact_id || ''),
        queued_at: now,
        skill_id: skillId,
        skill_group_id: groupId,
        skill_group_name: name,
        vdn_id: Number(opts.vdnId || 0),
        acd_request_id: Number(opts.requestId || 0),
        method: open?.assignee_user_id ? 'transfer' : 'inbound',
      },
    });
  if (!alreadyQueued) {
    await writeEvent({
      conv,
      recordId: row.id,
      type: 'queued',
      payload: { requestId: opts.requestId, skillId, agentGroupId: groupId },
    });
  }
}

export function recordSessionAssigned(opts: {
  conversationId: number;
  assigneeUserId: number;
  method?: OmniSessionMethod;
  actorUserId?: number;
}): void {
  void writeAssigned(opts).catch((e) => logFail('assigned', e));
}

async function writeAssigned(opts: {
  conversationId: number;
  assigneeUserId: number;
  method?: OmniSessionMethod;
  actorUserId?: number;
}) {
  const conv = await loadConv(opts.conversationId);
  if (!conv || !isMedia(conv)) return;
  const method: OmniSessionMethod = opts.method || 'inbound';
  const assignee = await resolveActor({ userId: opts.assigneeUserId });
  const actor = await resolveActor({ userId: opts.actorUserId || opts.assigneeUserId });
  const now = new Date();
  let open = await openRecord(conv.id);
  if (open?.assignee_user_id && open.assignee_user_id !== opts.assigneeUserId) {
    const cause: OmniReleaseCause = method === 'intercept' ? 'intercept' : (method === 'snatch' ? 'snatch' : 'transfer');
    await closeRecord(open, cause);
    await writeEvent({
      conv,
      recordId: open.id,
      type: method === 'inbound' ? 'transfer' : (method as OmniSessionEventType),
      actor,
      target: { userId: open.assignee_user_id, workNo: open.assignee_work_no, agentId: open.assignee_agent_id },
    });
    open = null;
  }
  const row = open
    ? await prisma.omni_session_records.update({
      where: { id: open.id },
      data: {
        assigned_at: open.assigned_at ?? now,
        answered_at: open.answered_at ?? now,
        method,
        wait_sec: omniWaitSec(open.queued_at, open.assigned_at ?? now, open.wait_sec),
        assignee_user_id: opts.assigneeUserId,
        assignee_work_no: assignee.workNo || '',
        assignee_agent_id: assignee.agentId || 0,
        assignee_name: assignee.name || '',
      },
    })
    : await prisma.omni_session_records.create({
      data: {
        conversation_id: conv.id,
        account_id: conv.account_id,
        inbox_id: conv.inbox_id,
        contact_id: conv.contact_id,
        channel: 'media',
        visitor_name: conv.contact?.name || conv.contact?.phone_number || '',
        visitor_id: conv.contact?.phone_number || String(conv.contact_id || ''),
        assigned_at: now,
        answered_at: now,
        method,
        assignee_user_id: opts.assigneeUserId,
        assignee_work_no: assignee.workNo || '',
        assignee_agent_id: assignee.agentId || 0,
        assignee_name: assignee.name || '',
      },
    });
  await writeEvent({
    conv,
    recordId: row.id,
    type: 'assigned',
    actor,
    target: assignee,
    summary: method === 'queue_take'
      ? `排队接 · ${assignee.workNo || opts.assigneeUserId}`
      : undefined,
  });
  await writeEvent({ conv, recordId: row.id, type: 'answered', actor: assignee });
  if (method === 'snatch' || method === 'intercept' || method === 'transfer') {
    await writeEvent({ conv, recordId: row.id, type: method, actor, target: assignee });
  }
}

export function recordSessionEnded(opts: {
  conversationId: number;
  cause?: OmniReleaseCause;
  actorUserId?: number;
}): void {
  void writeEnded(opts).catch((e) => logFail('ended', e));
}

async function writeEnded(opts: {
  conversationId: number;
  cause?: OmniReleaseCause;
  actorUserId?: number;
}) {
  const conv = await loadConv(opts.conversationId);
  if (!conv || !isMedia(conv)) return;
  const cause: OmniReleaseCause = opts.cause || 'agent_end';
  const actor = await resolveActor({ userId: opts.actorUserId });
  const open = await openRecord(conv.id);
  const record = open ?? await ensureOpenRecord(conv);
  if (!record.assignee_user_id && actor.userId) {
    await prisma.omni_session_records.update({
      where: { id: record.id },
      data: {
        assignee_user_id: actor.userId,
        assignee_work_no: actor.workNo || '',
        assignee_agent_id: actor.agentId || 0,
        assignee_name: actor.name || '',
      },
    });
  }
  await closeRecord(record, cause);
  const type: OmniSessionEventType = cause === 'force_end'
    ? 'force_end'
    : (cause === 'queue_abandon' ? 'queue_abandon' : 'ended');
  await writeEvent({ conv, recordId: record.id, type, actor });
}

export function recordSessionEvent(opts: {
  conversationId: number;
  type: OmniSessionEventType;
  actorUserId?: number;
  targetUserId?: number;
  summary?: string;
  payload?: Record<string, unknown>;
}): void {
  void writeAction(opts).catch((e) => logFail(opts.type, e));
}

async function writeAction(opts: {
  conversationId: number;
  type: OmniSessionEventType;
  actorUserId?: number;
  targetUserId?: number;
  summary?: string;
  payload?: Record<string, unknown>;
}) {
  const conv = await loadConv(opts.conversationId);
  if (!conv || !isMedia(conv)) return;
  const open = await openRecord(conv.id);
  await writeEvent({
    conv,
    recordId: open?.id,
    type: opts.type,
    actor: { userId: opts.actorUserId },
    target: opts.targetUserId ? { userId: opts.targetUserId } : undefined,
    summary: opts.summary,
    payload: opts.payload,
  });
}

export async function listOmniSessionRecords(conversationId: number) {
  const [records, events] = await Promise.all([
    prisma.omni_session_records.findMany({
      where: { conversation_id: conversationId },
      orderBy: { id: 'desc' },
      take: 50,
    }),
    prisma.omni_session_events.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      take: 200,
    }),
  ]);
  return { records, events };
}
