import { activeVdn } from '../access/access.scope.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { env } from '../../config/env.js';
import { listLoggedInSessions } from '../../integrations/ccs/session-manager.js';
import { queueByConv } from '../itr/itr-queue.js';

/**
 * Agent Tools — OmniAgent modules:
 *   Voicemail, Outbound, Monitor, Inspection, Contacts Directory
 */

function voicemailStatus(row: { is_read: boolean; deleted_at: Date | null }): 'new' | 'listened' | 'archived' {
  if (row.deleted_at) return 'archived';
  return row.is_read ? 'listened' : 'new';
}

function toVoicemailItem(row: {
  id: bigint;
  caller_number: string | null;
  duration_sec: number;
  transcription: string | null;
  occurred_at: Date;
  is_read: boolean;
  deleted_at: Date | null;
  audio_path: string | null;
  raw?: unknown;
}) {
  // 留言原因：优先取来电事件里带的原因（raw.reason），没有就给一个可读的默认值，
  // 免得坐席只看到「有一通留言」却不知道为什么进了留言。
  const raw = (row.raw ?? {}) as Record<string, unknown>;
  const reason = String(raw.reason ?? raw.leaveReason ?? raw.hangupCause ?? '').trim();
  return {
    id: String(row.id),
    caller_number: row.caller_number ?? '',
    duration_sec: row.duration_sec,
    transcription: row.transcription ?? '',
    reason: reason || '来电未接转留言',
    // 语音留言天然属于电话渠道，前端据此显示电话图标
    channel_type: 'Channel::Voice',
    channels: ['phone'],
    status: voicemailStatus(row),
    created_at: row.occurred_at.toISOString(),
    audio_url: `/api/v1/voicemails/${row.id}/audio`,
  };
}

export async function listVoicemails(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const rows = await prisma.icc_voicemails.findMany({
      where: { deleted_at: null, vdn_id: activeVdn(env.OMNI_AGENT_VDN_ID) },
      orderBy: { occurred_at: 'desc' },
      take: 100,
    });
    const items = rows.map(toVoicemailItem);
    return reply.send({
      items,
      total: items.length,
      unread_count: items.filter((i) => i.status === 'new').length,
    });
  } catch (err) {
    _req.log.warn({ err }, 'icc_voicemails query failed; returning empty list');
    return reply.send({ items: [], total: 0, unread_count: 0 });
  }
}

export async function markVoicemailRead(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  await prisma.icc_voicemails.update({
    where: { id: BigInt(id) },
    data: { is_read: true, read_by_user_id: req.currentUser?.id ?? null },
  });
  return reply.send({ ok: true, id, status: 'listened' });
}

export async function deleteVoicemail(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  await prisma.icc_voicemails.update({
    where: { id: BigInt(id) },
    data: { deleted_at: new Date() },
  });
  return reply.send({ ok: true, id });
}

export async function streamVoicemailAudio(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const row = await prisma.icc_voicemails.findUnique({ where: { id: BigInt(id) } });
  if (!row?.audio_path) return reply.code(404).send({ error: 'audio not found' });
  const root = env.ICC_LEAVEWORD_DIR;
  if (!root) return reply.code(404).send({ error: 'ICC_LEAVEWORD_DIR not configured' });
  const base = path.resolve(root);
  const full = path.resolve(base, row.audio_path);
  if (!full.startsWith(base + path.sep) && full !== base) {
    return reply.code(403).send({ error: 'invalid audio path' });
  }
  try {
    const st = await stat(full);
    reply.header('Content-Type', 'audio/wav');
    reply.header('Content-Length', st.size);
    reply.header('Accept-Ranges', 'bytes');
    return reply.send(createReadStream(full));
  } catch {
    return reply.code(404).send({ error: 'audio file missing' });
  }
}

// ── Outbound ──

export async function listOutboundTasks(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({
    items: [
      { id: 't1', campaign_name: '满意度回访-6月', target_count: 200, completed_count: 156, status: 'running', created_at: new Date().toISOString() },
      { id: 't2', campaign_name: '会员权益通知', target_count: 500, completed_count: 500, status: 'completed', created_at: new Date(Date.now() - 86400000).toISOString(), completed_at: new Date().toISOString() },
      { id: 't3', campaign_name: '新用户激活引导', target_count: 300, completed_count: 0, status: 'pending', created_at: new Date().toISOString() },
    ],
    total: 3,
  });
}

export async function startOutboundTask(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return reply.send({ ok: true, id, status: 'running' });
}

export async function pauseOutboundTask(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return reply.send({ ok: true, id, status: 'paused' });
}

// ── Monitor ──

async function buildMonitorPayload() {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sessions = listLoggedInSessions();
  const userIds = sessions.map((s) => s.userId);
  const users = await prisma.users.findMany({
    where: { account_users: { some: { role: 0 } } },
    select: {
      id: true,
      name: true,
      display_name: true,
      uid: true,
      team_members: { select: { team: { select: { name: true } } }, take: 1 },
    },
  });
  const sessionMap = new Map(sessions.map((s) => [s.userId, s]));
  const openConvs =
    userIds.length > 0
      ? await prisma.conversations.findMany({
          where: { assignee_id: { in: userIds }, status: 0 },
          select: { id: true, assignee_id: true, last_activity_at: true },
        })
      : [];
  const busyByUser = new Map<number, { id: number; since: Date | null }>();
  for (const c of openConvs) {
    if (!c.assignee_id) continue;
    if (!busyByUser.has(c.assignee_id)) {
      busyByUser.set(c.assignee_id, { id: c.id, since: c.last_activity_at });
    }
  }
  const handledRows = await prisma.omni_session_records.groupBy({
    by: ['assignee_user_id'],
    where: { created_at: { gte: today }, assignee_user_id: { not: null } },
    _count: { id: true },
  });
  const handledMap = new Map(handledRows.map((r) => [r.assignee_user_id || 0, r._count.id]));
  const agents = users.map((u) => {
    const s = sessionMap.get(u.id);
    const busy = busyByUser.get(u.id);
    const phoneBusy = s ? s.status === 'talking' || s.status === 'ringing' || s.status === 'hold' : false;
    const status =
      !s
        ? 'offline'
        : s.workMode === 'break'
        ? 'break'
        : phoneBusy || busy
          ? 'busy'
          : s.workMode === 'ready'
            ? 'ready'
            : s.workMode === 'busy' || s.workMode === 'blocked'
              ? 'busy'
              : 'ready';
    const workNo = s?.workNO || u.uid || String(u.id);
    return {
      user_id: u.id,
      agent_id: workNo,
      work_no: workNo,
      extension: s?.extension || '',
      name: u.display_name || u.name || workNo || `坐席${u.id}`,
      team: u.team_members[0]?.team.name || '未分组',
      status,
      current_call: phoneBusy
        ? String((s?.currentCall as { Caller?: string } | null)?.Caller || '通话中')
        : busy
          ? `会话 ${busy.id}`
          : undefined,
      media_status: {
        voice: !s ? 'offline' : phoneBusy ? s.status : s.workMode,
        multimedia: busy ? 'busy' : s && s.mediaQueuingMode > 0 ? 'ready' : 'offline',
      },
      duration_sec: busy?.since ? Math.max(0, Math.round((now - busy.since.getTime()) / 1000)) : 0,
      handled_today: handledMap.get(u.id) || 0,
    };
  });
  const waiting = queueByConv.size;
  const queues = [
    {
      queue_name: '全媒体排队',
      waiting,
      active: openConvs.length,
      sla_pct: waiting === 0 ? 100 : Math.max(0, Math.round((1 - Math.min(waiting, 20) / 20) * 1000) / 10),
    },
  ];
  const liveSessions = await prisma.conversations.findMany({
    where: { status: 0 },
    orderBy: { last_activity_at: 'desc' },
    take: 40,
    select: {
      id: true,
      assignee_id: true,
      last_activity_at: true,
      additional_attributes: true,
      inbox: { select: { name: true, channel_type: true } },
      contact: { select: { name: true } },
    },
  });
  const queuedIds = new Set([...queueByConv.keys()].map((k) => Number(k)).filter((n) => Number.isFinite(n)));
  const [sessionCount, waitAgg, csat] = await Promise.all([
    prisma.omni_session_records.count({ where: { created_at: { gte: today } } }),
    prisma.omni_session_records.aggregate({
      where: { created_at: { gte: today } },
      _avg: { wait_sec: true, talk_sec: true },
    }),
    prisma.csat_survey_responses.aggregate({
      where: { created_at: { gte: today } },
      _avg: { rating: true },
      _count: { id: true },
    }),
  ]);
  const ready = agents.filter((a) => a.status === 'ready').length;
  const busyN = agents.filter((a) => a.status === 'busy').length;
  const breakN = agents.filter((a) => a.status === 'break').length;
  return {
    total_agents: agents.length,
    online_agents: agents.filter((a) => a.status !== 'offline').length,
    ready_agents: ready,
    busy_agents: busyN,
    break_agents: breakN,
    queues,
    agents,
    session_kpis: {
      sessions: sessionCount,
      queued: waiting,
      avg_wait_sec: Math.round(waitAgg._avg.wait_sec || 0),
      avg_talk_sec: Math.round(waitAgg._avg.talk_sec || 0),
      csat_pct:
        csat._count.id && csat._avg.rating != null
          ? Math.round((csat._avg.rating / 5) * 1000) / 10
          : null,
      csat_count: csat._count.id,
    },
    live_sessions: liveSessions.map((c) => ({
      conversation_id: c.id,
      visitor_name: c.contact?.name || '',
      channel: c.inbox?.name || c.inbox?.channel_type || '',
      assignee_id: c.assignee_id,
      queued: queuedIds.has(c.id),
      last_activity_at: c.last_activity_at?.toISOString() || '',
    })),
    updated_at: new Date().toISOString(),
  };
}

export async function monitorOverview(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await buildMonitorPayload());
}

export async function monitorAgents(_req: FastifyRequest, reply: FastifyReply) {
  const payload = await buildMonitorPayload();
  return reply.send(payload.agents);
}

type MonitorMapPlacement = { agent_id: string; x: number; y: number };
type MonitorMapRegion = {
  id: string;
  name: string;
  background: string;
  placements: MonitorMapPlacement[];
};
type MonitorMapConfig = {
  version: 1;
  active_region_id: string;
  regions: MonitorMapRegion[];
};

const MONITOR_MAP_CONFIG_KEY = 'monitor.agent_map_layout';
const defaultMonitorMapConfig = (): MonitorMapConfig => ({
  version: 1,
  active_region_id: 'default',
  regions: [{ id: 'default', name: '默认区域', background: '', placements: [] }],
});

function normalizeMonitorMapConfig(input: unknown): MonitorMapConfig {
  if (!input || typeof input !== 'object') return defaultMonitorMapConfig();
  const raw = input as Partial<MonitorMapConfig>;
  const regions = Array.isArray(raw.regions)
    ? raw.regions.slice(0, 30).map((region, index) => {
        const r = region as Partial<MonitorMapRegion>;
        const id = String(r.id || `region-${index + 1}`).slice(0, 80);
        return {
          id,
          name: String(r.name || `区域 ${index + 1}`).slice(0, 80),
          background: String(r.background || '').slice(0, 2_500_000),
          placements: Array.isArray(r.placements)
            ? r.placements.slice(0, 1000).map((p) => ({
                agent_id: String(p.agent_id || '').slice(0, 80),
                x: Math.max(0, Math.min(100, Number(p.x) || 0)),
                y: Math.max(0, Math.min(100, Number(p.y) || 0)),
              })).filter((p) => p.agent_id)
            : [],
        };
      })
    : [];
  const safeRegions = regions.length ? regions : defaultMonitorMapConfig().regions;
  const requestedActive = String(raw.active_region_id || '');
  return {
    version: 1,
    active_region_id: safeRegions.some((r) => r.id === requestedActive)
      ? requestedActive
      : safeRegions[0].id,
    regions: safeRegions,
  };
}

export async function getMonitorMapConfig(_req: FastifyRequest, reply: FastifyReply) {
  const row = await prisma.platform_configs.findUnique({ where: { key: MONITOR_MAP_CONFIG_KEY } });
  if (!row?.value) return reply.send(defaultMonitorMapConfig());
  try {
    return reply.send(normalizeMonitorMapConfig(JSON.parse(row.value)));
  } catch {
    return reply.send(defaultMonitorMapConfig());
  }
}

export async function putMonitorMapConfig(req: FastifyRequest, reply: FastifyReply) {
  const config = normalizeMonitorMapConfig(req.body);
  await prisma.platform_configs.upsert({
    where: { key: MONITOR_MAP_CONFIG_KEY },
    create: {
      key: MONITOR_MAP_CONFIG_KEY,
      value: JSON.stringify(config),
      category: 'monitor',
      description: '坐席监控地图区域、背景和坐席坐标',
    },
    update: { value: JSON.stringify(config) },
  });
  return reply.send(config);
}

// ── Contacts Directory ──

async function buildContactsDirectory() {
  const sessions = listLoggedInSessions();
  const online = new Map(sessions.map((s) => [s.userId, s]));
  const users = await prisma.users.findMany({
    orderBy: { id: 'asc' },
    take: 200,
    select: {
      id: true,
      name: true,
      display_name: true,
      email: true,
      uid: true,
      availability: true,
      custom_attributes: true,
      type: true,
    },
  });
  const items = users
    .filter((u) => u.type !== 'SuperAdmin')
    .map((u) => {
      const sess = online.get(u.id);
      const status = sess ? (sess.workMode === 'ready' ? 'online' : 'busy') : 'offline';
      const attrs = (u.custom_attributes ?? {}) as Record<string, unknown>;
      return {
        id: String(u.id),
        name: u.display_name || u.name,
        phone: u.uid || '',
        extension: String(attrs.extension || u.uid || ''),
        department: String(attrs.department || '全媒体'),
        position: String(attrs.position || '坐席'),
        email: u.email || '',
        status,
      };
    });
  const byDept = new Map<string, typeof items>();
  for (const it of items) {
    const arr = byDept.get(it.department) || [];
    arr.push(it);
    byDept.set(it.department, arr);
  }
  const groups = [...byDept.entries()].map(([name, list]) => ({ name, items: list }));
  return { groups: groups.length ? groups : [{ name: '全媒体', items }], total: items.length, items };
}

export async function contactsDirectory(_req: FastifyRequest, reply: FastifyReply) {
  const payload = await buildContactsDirectory();
  return reply.send({ groups: payload.groups, total: payload.total });
}

export async function searchContacts(req: FastifyRequest, reply: FastifyReply) {
  const { q } = req.query as { q?: string };
  const payload = await buildContactsDirectory();
  const needle = String(q || '').toLowerCase();
  const items = needle
    ? payload.items.filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          c.phone.includes(needle) ||
          c.department.toLowerCase().includes(needle) ||
          c.email.toLowerCase().includes(needle),
      )
    : payload.items;
  return reply.send({ items, query: q });
}

// ── Routes ──

export async function agentToolsRoutes(fastify: FastifyInstance) {
  // Voicemail
  fastify.get('/api/v1/voicemails', listVoicemails);
  fastify.put('/api/v1/voicemails/:id/read', markVoicemailRead);
  fastify.delete('/api/v1/voicemails/:id', deleteVoicemail);
  fastify.get('/api/v1/voicemails/:id/audio', streamVoicemailAudio);

  // Outbound
  fastify.get('/api/v1/outbound/tasks', listOutboundTasks);
  fastify.post('/api/v1/outbound/tasks/:id/start', startOutboundTask);
  fastify.post('/api/v1/outbound/tasks/:id/pause', pauseOutboundTask);

  // Monitor
  fastify.get('/api/v1/monitor/overview', monitorOverview);
  fastify.get('/api/v1/monitor/agents', monitorAgents);
  fastify.get('/api/v1/monitor/map-config', getMonitorMapConfig);
  fastify.put(
    '/api/v1/monitor/map-config',
    { bodyLimit: 3 * 1024 * 1024 },
    putMonitorMapConfig,
  );

  // Contacts Directory
  fastify.get('/api/v1/contacts/directory', contactsDirectory);
  fastify.get('/api/v1/contacts/directory/search', searchContacts);
}
