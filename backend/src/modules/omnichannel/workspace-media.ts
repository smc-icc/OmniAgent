/**
 * 多媒体工作台：左侧工具栏走 Omni / ACD IMS，不调 CCS 话务接口。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { ioRef } from '../../processors/socket-ref.js';
import { getSignedInSkillIds } from '../../shared/services/agent-skill-groups.js';
import { resolveChannelGroup } from '../../shared/services/channel-group.js';
import { asAttrMap, markConversationEnded, mergeAttrs } from '../../shared/services/conversation-lifecycle.js';
import { sessionReleased, requestCallQueueList, acdSetImsStatus } from '../../integrations/ccs/acd-client.js';
import {
  getSessionByAgentId,
  getSessionByUserId,
} from '../../integrations/ccs/session-manager.js';
import { isImsQueueRow } from '../../integrations/ccs/ims-queue-filter.js';
import {
  loadImsGroupMeta,
  loadImsSkillIdSet,
  signOutImsOnLogout,
} from '../../integrations/ccs/ims-acd.js';
import { loadOnlineTransferAgents } from '../../shared/services/icc-transfer-catalog-dal.js';
import {
  assignConversation,
  claimQueuedConversation,
  queueByConv,
} from '../itr/itr-queue.js';
import { recordSessionEvent } from '../../shared/services/omni-session-log.js';

type Login = { userId: number; agentId: number; vdnId: number };

function requireLogin(req: FastifyRequest): Login | null {
  const userId = req.currentUser?.id ?? 0;
  const s = getSessionByUserId(userId);
  if (!userId || !s?.loggedIn || !s.agentId) return null;
  return { userId, agentId: s.agentId, vdnId: s.vdnId };
}

function observerIds(attrs: Record<string, unknown>): number[] {
  const raw = attrs.omni_observers;
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
}

async function signedImsGroups(userId: number): Promise<Array<{ id: number; name: string }>> {
  const all = await loadImsGroupMeta();
  const signed = new Set(
    getSignedInSkillIds(userId).map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0),
  );
  if (signed.size === 0) return all;
  const hit = all.filter((g) => signed.has(g.id));
  return hit.length > 0 ? hit : all;
}

async function addParticipant(accountId: number, conversationId: number, userId: number) {
  const exists = await prisma.conversation_participants.findFirst({
    where: { conversation_id: conversationId, user_id: userId },
  });
  if (!exists) {
    await prisma.conversation_participants.create({
      data: { account_id: accountId, user_id: userId, conversation_id: conversationId },
    });
  }
}

function emitConvToUser(
  userId: number,
  accountId: number,
  conversationId: number,
  extra: Record<string, unknown> = {},
) {
  const io = ioRef.get();
  if (!io) return;
  const payload = { conversation_id: conversationId, account_id: accountId, ...extra };
  io.to(`user:${userId}`).emit('conversation.created', payload);
  io.to(`user:${userId}`).emit('conversation.assigned', payload);
  io.to(`account:${accountId}`).emit('conversation.created', payload);
}

async function setObservers(conversationId: number, userIds: number[]) {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: { additional_attributes: true },
  });
  if (!conv) return;
  await prisma.conversations.update({
    where: { id: conversationId },
    data: {
      additional_attributes: mergeAttrs(conv.additional_attributes, {
        omni_observers: [...new Set(userIds)],
      }) as object,
    },
  });
}

async function latestMediaConvByAssignee(userId: number) {
  const rows = await prisma.conversations.findMany({
    where: { status: 0, assignee_id: userId },
    orderBy: { last_activity_at: 'desc' },
    take: 20,
    include: {
      inbox: { select: { channel_type: true } },
      contact: { select: { name: true, phone_number: true } },
    },
  });
  return rows.find((c) => resolveChannelGroup(c.inbox?.channel_type) === 'media') ?? null;
}

export async function getMediaOnlineAgents(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLogin(req);
  if (!login) return reply.status(400).send({ error: 'agent not logged in' });
  const groupsMeta = await signedImsGroups(login.userId);
  const online = await loadOnlineTransferAgents(login.vdnId);
  const mediaByUser = new Map<number, number>();
  const open = await prisma.conversations.findMany({
    where: {
      status: 0,
      assignee_id: { in: online.map((a) => a.userId).filter((id) => id > 0) },
    },
    orderBy: { last_activity_at: 'desc' },
    select: { id: true, assignee_id: true, inbox: { select: { channel_type: true } } },
  });
  for (const c of open) {
    if (!c.assignee_id || mediaByUser.has(c.assignee_id)) continue;
    if (resolveChannelGroup(c.inbox?.channel_type) !== 'media') continue;
    mediaByUser.set(c.assignee_id, c.id);
  }
  const groups = groupsMeta.map((g) => {
    const agents = online
      .filter((a) => a.userId !== login.userId && a.signedGroupIds.has(g.id))
      .map((a) => {
        const sess = getSessionByUserId(a.userId);
        const convId = mediaByUser.get(a.userId) ?? 0;
        return {
          agentId: sess?.agentId ?? 0,
          userId: a.userId,
          workNo: a.workNo,
          name: a.name,
          status: convId ? 0x0100 : 0x20,
          mediaConversationId: convId || undefined,
        };
      })
      .filter((a) => a.agentId > 0)
      .sort((a, b) => a.workNo.localeCompare(b.workNo));
    return { id: g.id, name: g.name, count: agents.length, agents };
  });
  return reply.send({ groups });
}

export async function getMediaSnatchTargets(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLogin(req);
  if (!login) return reply.status(400).send({ error: 'agent not logged in' });
  const groupsMeta = await signedImsGroups(login.userId);
  const online = await loadOnlineTransferAgents(login.vdnId);
  const byUser = new Map(online.map((a) => [a.userId, a]));
  const convs = await prisma.conversations.findMany({
    where: {
      status: 0,
      assignee_id: { not: login.userId },
    },
    orderBy: { last_activity_at: 'desc' },
    take: 200,
    include: {
      inbox: { select: { channel_type: true } },
      contact: { select: { name: true, phone_number: true } },
    },
  });
  const media = convs.filter((c) => resolveChannelGroup(c.inbox?.channel_type) === 'media' && c.assignee_id);
  const groups = groupsMeta.map((g) => {
    const agents = media
      .filter((c) => {
        const a = byUser.get(c.assignee_id!);
        return !!a && a.signedGroupIds.has(g.id);
      })
      .map((c) => {
        const a = byUser.get(c.assignee_id!)!;
        const sess = getSessionByUserId(a.userId);
        return {
          agentId: sess?.agentId ?? 0,
          userId: a.userId,
          workNo: a.workNo,
          name: a.name,
          callerNo: c.contact?.name || c.contact?.phone_number || `会话 ${c.id}`,
          logicNo: c.id,
          conversationId: c.id,
          ringStartTime: Math.floor((c.last_activity_at?.getTime() || Date.now()) / 1000),
        };
      })
      .filter((a) => a.agentId > 0);
    return { id: g.id, name: g.name, agents };
  });
  return reply.send({ groups });
}

export async function postMediaSnatch(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLogin(req);
  if (!login) return reply.status(400).send({ error: 'agent not logged in' });
  const body = (req.body ?? {}) as { conversationId?: number };
  const convId = Number(body.conversationId || 0);
  if (!convId) return reply.status(400).send({ error: 'conversationId required' });
  const conv = await prisma.conversations.findUnique({
    where: { id: convId },
    include: { inbox: { select: { channel_type: true } } },
  });
  if (!conv) return reply.status(404).send({ error: 'conversation not found' });
  if (resolveChannelGroup(conv.inbox?.channel_type) !== 'media') {
    return reply.status(400).send({ error: 'not a media session' });
  }
  await assignConversation(convId, login.userId, { method: 'snatch', actorUserId: login.userId });
  await addParticipant(conv.account_id, convId, login.userId);
  const attrs = asAttrMap(conv.additional_attributes);
  const observers = observerIds(attrs).filter((id) => id !== login.userId);
  await setObservers(convId, observers);
  emitConvToUser(login.userId, conv.account_id, convId, { assignee_id: login.userId, omni_lifecycle: 'assigned' });
  return reply.send({ ok: true, conversation_id: convId });
}

export async function getMediaQueueSessions(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLogin(req);
  if (!login) return reply.status(400).send({ error: 'agent not logged in' });
  const groupsMeta = await signedImsGroups(login.userId);
  const imsSkills = await loadImsSkillIdSet();
  const queuedIds = new Set<number>();
  for (const q of queueByConv.values()) {
    queuedIds.add(q.requestId);
    queuedIds.add(q.conversationId);
  }
  const byGroup = new Map<number, Array<Record<string, unknown>>>();
  const used = new Set<number>();
  const errors: string[] = [];
  for (const g of groupsMeta) {
    try {
      const { ret, status, calls } = await requestCallQueueList({
        agentId: login.agentId,
        agentGroupId: g.id,
        vdnId: login.vdnId,
        skillId: -1,
      });
      if (ret !== 0 && status !== 0) {
        errors.push(`${g.id}:${status || ret}`);
        continue;
      }
      const rows = [];
      const nowSec = Math.floor(Date.now() / 1000);
      for (const c of calls) {
        if (c.logicNo <= 0 || used.has(c.logicNo)) continue;
        if (!isImsQueueRow(c.skillId, c.logicNo, imsSkills, queuedIds)) continue;
        const live = queuedIds.has(c.logicNo);
        const fresh = c.enterAcdTime > 0 && nowSec - c.enterAcdTime < 3600;
        if (!live && !fresh) continue;
        used.add(c.logicNo);
        const q = queueByConv.get(String(c.logicNo));
        rows.push({
          ...c,
          conversationId: q?.conversationId || c.logicNo,
        });
      }
      rows.sort((a, b) => (a.enterAcdTime || 0) - (b.enterAcdTime || 0) || a.logicNo - b.logicNo);
      byGroup.set(g.id, rows);
    } catch (e) {
      errors.push(`${g.id}:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const q of queueByConv.values()) {
    if (used.has(q.conversationId) || used.has(q.requestId)) continue;
    const gid = groupsMeta[0]?.id ?? -1;
    const list = byGroup.get(gid) ?? [];
    list.push({
      logicNo: q.requestId || q.conversationId,
      conversationId: q.conversationId,
      callerNo: `会话 ${q.conversationId}`,
      groupId: gid,
      skillId: 0,
      startTime: Math.floor(q.startedAt / 1000),
      enterAcdTime: Math.floor(q.startedAt / 1000),
      vipLevel: 0,
    });
    byGroup.set(gid, list);
    used.add(q.conversationId);
  }
  const groups = groupsMeta.map((g) => {
    const calls = byGroup.get(g.id) ?? [];
    return { id: g.id, name: g.name, count: calls.length, calls };
  });
  const visibleIds = new Set((await prisma.conversations.findMany({
    where: { id: { in: groups.flatMap(g => g.calls.map(c => Number(c.conversationId || c.logicNo))).filter(Number.isSafeInteger) } }, select: { id: true },
  })).map(c => c.id));
  for (const group of groups) { group.calls = group.calls.filter(c => visibleIds.has(Number(c.conversationId || c.logicNo))); group.count = group.calls.length; }
  groups.sort((a, b) => b.count - a.count || a.id - b.id);
  const allCalls: Array<Record<string, unknown>> = [];
  const seen = new Set<number>();
  for (const g of groups) {
    for (const c of g.calls) {
      const id = Number(c.conversationId || c.logicNo);
      if (seen.has(id)) continue;
      seen.add(id);
      allCalls.push(c);
    }
  }
  if (allCalls.length > 0) {
    groups.unshift({ id: -1, name: '全部', count: allCalls.length, calls: allCalls });
  }
  if (groupsMeta.length > 0 && byGroup.size === 0 && errors.length > 0 && allCalls.length === 0) {
    return reply.status(502).send({ error: `ACD IMS queue query failed: ${errors.join('; ')}` });
  }
  return reply.send({ groups, total: allCalls.length });
}

export async function postMediaQueueTake(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLogin(req);
  if (!login) return reply.status(400).send({ error: 'agent not logged in' });
  const body = (req.body ?? {}) as { conversationId?: number; logicNo?: number };
  const convId = Number(body.conversationId || body.logicNo || 0);
  if (!convId) return reply.status(400).send({ error: 'conversationId required' });
  const result = await claimQueuedConversation({
    conversationId: convId,
    agentUserId: login.userId,
    ccsAgentId: login.agentId,
  });
  if (!result.ok) return reply.status(502).send({ error: result.error });
  return reply.send({ ok: true, conversation_id: convId });
}

export async function postMediaConference(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLogin(req);
  if (!login) return reply.status(400).send({ error: 'agent not logged in' });
  const body = (req.body ?? {}) as {
    action?: string;
    conversationId?: number;
    agentIds?: number[];
    mode?: number;
  };
  const convId = Number(body.conversationId || 0);
  if (!convId) return reply.status(400).send({ error: '请先选中一通全媒体会话' });
  const conv = await prisma.conversations.findUnique({
    where: { id: convId },
    select: { id: true, account_id: true, additional_attributes: true, inbox: { select: { channel_type: true } } },
  });
  if (!conv) return reply.status(404).send({ error: 'conversation not found' });
  if (resolveChannelGroup(conv.inbox?.channel_type) !== 'media') {
    return reply.status(400).send({ error: 'not a media session' });
  }
  const action = String(body.action || 'invite');
  if (action === 'mode') {
    const attrs = asAttrMap(conv.additional_attributes);
    const observers = observerIds(attrs);
    const next = body.mode === 1
      ? [...new Set([...observers, login.userId])]
      : observers.filter((id) => id !== login.userId);
    await setObservers(convId, next);
    return reply.send({ ok: true, observe: body.mode === 1 });
  }
  const agentIds = (body.agentIds ?? []).map((n) => Number(n)).filter((n) => n > 0);
  const userIds = agentIds
    .map((agentId) => getSessionByAgentId(agentId)?.userId ?? 0)
    .filter((id) => id > 0);
  if (!userIds.length) return reply.status(400).send({ error: '请选择坐席' });
  if (action === 'kick') {
    await prisma.conversation_participants.deleteMany({
      where: { conversation_id: convId, user_id: { in: userIds } },
    });
    const attrs = asAttrMap(conv.additional_attributes);
    await setObservers(convId, observerIds(attrs).filter((id) => !userIds.includes(id)));
    for (const uid of userIds) {
      recordSessionEvent({
        conversationId: convId,
        type: 'kick',
        actorUserId: login.userId,
        targetUserId: uid,
      });
    }
    return reply.send({ ok: true, kicked: userIds.length });
  }
  for (const uid of userIds) {
    await addParticipant(conv.account_id, convId, uid);
    emitConvToUser(uid, conv.account_id, convId, { omni_lifecycle: 'assigned' });
    recordSessionEvent({
      conversationId: convId,
      type: 'invite',
      actorUserId: login.userId,
      targetUserId: uid,
    });
  }
  return reply.send({ ok: true, invited: userIds.length });
}

export async function postMediaMonitor(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLogin(req);
  if (!login) return reply.status(400).send({ error: 'agent not logged in' });
  const body = (req.body ?? {}) as {
    action?: string;
    agentId?: number;
    conversationId?: number;
  };
  const action = String(body.action || '');
  let convId = Number(body.conversationId || 0);
  const destAgentId = Number(body.agentId || 0);
  if (!convId && destAgentId) {
    const dest = getSessionByAgentId(destAgentId);
    if (!dest?.userId) return reply.status(404).send({ error: '目标坐席未登录' });
    const latest = await latestMediaConvByAssignee(dest.userId);
    if (!latest) return reply.status(404).send({ error: '该坐席当前无全媒体会话' });
    convId = latest.id;
  }
  if (!convId) return reply.status(400).send({ error: 'conversationId required' });
  const conv = await prisma.conversations.findUnique({
    where: { id: convId },
    include: { inbox: { select: { channel_type: true } } },
  });
  if (!conv) return reply.status(404).send({ error: 'conversation not found' });
  if (resolveChannelGroup(conv.inbox?.channel_type) !== 'media') {
    return reply.status(400).send({ error: 'not a media session' });
  }

  if (action === 'end' || action === 'force_hangup') {
    const attrs = asAttrMap(conv.additional_attributes);
    const requestId = Number(attrs.acd_request_id ?? 0);
    const acdAgentId = Number(attrs.acd_agent_id ?? destAgentId ?? 0);
    const vdnId = Number(attrs.acd_vdn_id ?? login.vdnId);
    if (requestId && acdAgentId) {
      try {
        await sessionReleased({ agentId: acdAgentId, vdnId, requestId });
      } catch {
        /* best effort */
      }
    }
    await markConversationEnded(convId, {
      omni_release_cause: 'force_end',
      actor_user_id: login.userId,
    });
    return reply.send({ ok: true, conversation_id: convId, omni_lifecycle: 'ended' });
  }

  if (action === 'intercept') {
    await assignConversation(convId, login.userId, { method: 'intercept', actorUserId: login.userId });
    await addParticipant(conv.account_id, convId, login.userId);
    const attrs = asAttrMap(conv.additional_attributes);
    await setObservers(convId, observerIds(attrs).filter((id) => id !== login.userId));
    emitConvToUser(login.userId, conv.account_id, convId, { assignee_id: login.userId });
    return reply.send({ ok: true, conversation_id: convId, action: 'intercept' });
  }

  await addParticipant(conv.account_id, convId, login.userId);
  const attrs = asAttrMap(conv.additional_attributes);
  let observers = observerIds(attrs);
  if (action === 'listen') {
    observers = [...new Set([...observers, login.userId])];
  } else {
    observers = observers.filter((id) => id !== login.userId);
  }
  await setObservers(convId, observers);
  emitConvToUser(login.userId, conv.account_id, convId, {
    omni_lifecycle: 'assigned',
    observe_only: action === 'listen',
  });
  recordSessionEvent({
    conversationId: convId,
    type: action === 'listen' ? 'listen' : 'barge',
    actorUserId: login.userId,
    targetUserId: conv.assignee_id ?? undefined,
  });
  return reply.send({ ok: true, conversation_id: convId, action, observe_only: action === 'listen' });
}

export async function postMediaImsForce(req: FastifyRequest, reply: FastifyReply) {
  const login = requireLogin(req);
  if (!login) return reply.status(400).send({ error: 'agent not logged in' });
  const body = (req.body ?? {}) as { action?: string; agentIds?: number[]; agentId?: number };
  const action = String(body.action || '');
  const ids = [
    ...((body.agentIds ?? []).map((n) => Number(n))),
    Number(body.agentId || 0),
  ].filter((n) => n > 0);
  const unique = [...new Set(ids)];
  if (!unique.length) return reply.status(400).send({ error: 'agentId required' });
  const results: Array<{ agentId: number; ok: boolean; error?: string }> = [];
  for (const agentId of unique) {
    const dest = getSessionByAgentId(agentId);
    if (!dest?.loggedIn || !dest.agentId) {
      results.push({ agentId, ok: false, error: '目标坐席未登录' });
      continue;
    }
    try {
      if (action === 'logout') {
        await signOutImsOnLogout(dest.agentId, dest.vdnId);
      } else if (action === 'idle' || action === 'busy' || action === 'block') {
        const r = await acdSetImsStatus({ agentId: dest.agentId, vdnId: dest.vdnId, status: action });
        if (r.ret !== 0 && r.err !== 0) {
          throw new Error(`ACD IMS ${action} ret=${r.ret}`);
        }
      } else {
        throw new Error(`unknown action ${action}`);
      }
      ioRef.get()?.to(`user:${dest.userId}`).emit('agent.ims_force', {
        action,
        byUserId: login.userId,
      });
      results.push({ agentId, ok: true });
    } catch (e) {
      results.push({ agentId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length === results.length) {
    return reply.status(502).send({ error: failed.map((f) => `${f.agentId}:${f.error}`).join('; '), results });
  }
  return reply.send({ ok: failed.length === 0, results });
}
