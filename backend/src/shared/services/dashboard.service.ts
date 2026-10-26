import { resolveCcsWorkNo } from '../../integrations/ccs/ccs-workno.js';
import { accessScope } from '../../modules/access/access.scope.js';
import { confTenancyEnabled } from './conf-tenancy.js';
import { AppError } from '../errors/index.js';
/**
 * 个人看板：指标 / 渠道量 / 公告备忘日历。
 */
import type { PrismaClient } from '@prisma/client';
import {
  avgIccQueueWaitSec,
  avgIccResponseSec,
  avgIccSatisfactionPct,
  countIccCalls,
  listIccCallCountsByDay,
} from './icc-metrics-dal.js';

export type MetricBlock = {
  title: string;
  period: 'today' | 'week' | 'month';
  session_count: number;
  avg_response_sec: number | null;
  avg_wait_sec: number | null;
  avg_quality: number | null;
  avg_satisfaction_pct: number | null;
};

export type ChannelVolumePack = {
  dates: string[];
  series: Array<{ channel_name: string; data: number[] }>;
};

/** 看板按东八区自然日切窗，避免容器 UTC 把「今日/本周」算错。 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function wallParts(d = new Date()) {
  const t = new Date(d.getTime() + TZ_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    day: t.getUTCDate(),
    dow: t.getUTCDay(),
  };
}

function atWallMidnight(y: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(y, monthIndex, day) - TZ_OFFSET_MS);
}

function ymdWall(d: Date): string {
  const p = wallParts(d);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function startOfDay(d = new Date()): Date {
  const p = wallParts(d);
  return atWallMidnight(p.y, p.m, p.day);
}

function startOfWeek(d = new Date()): Date {
  const p = wallParts(d);
  const diff = p.dow === 0 ? 6 : p.dow - 1;
  return atWallMidnight(p.y, p.m, p.day - diff);
}

function startOfMonth(d = new Date()): Date {
  const p = wallParts(d);
  return atWallMidnight(p.y, p.m, 1);
}

function isVoiceInbox(channelType: string | null | undefined, inboxName: string): boolean {
  const ct = (channelType ?? '').toLowerCase();
  if (ct.includes('voice')) return true;
  return (inboxName || '').includes('电话');
}

function labelForChannel(channelType: string | null | undefined, inboxName: string): string {
  const ct = (channelType ?? '').toLowerCase();
  if (ct.includes('wechatmp') || ct.includes('wecom')) return '微信';
  if (ct.includes('weibo')) return '微博';
  if (ct.includes('miniprogram')) return '小程序';
  if (ct.includes('sms') || ct.includes('twiliosms')) return '短信';
  if (ct.includes('webwidget')) return '网页';
  if (ct.includes('email')) return '邮件';
  if (isVoiceInbox(channelType, inboxName)) return '电话';
  if (ct.includes('api') && (inboxName || '').includes('电话')) return '电话';
  return inboxName || '其他';
}

async function resolveAccountId(prisma: PrismaClient, userId: number): Promise<number> {
  const scope = accessScope.getStore();
  if (scope) return scope.accountId;
  if (confTenancyEnabled()) throw new AppError(403, '租户上下文缺失');
  const au = await prisma.account_users.findFirst({
    where: { user_id: userId },
    orderBy: { id: 'asc' },
  });
  return au?.account_id ?? 1;
}

/**
 * 团队 scope：取同 account 下坐席 uid（即工号）做 ICC 聚合。
 * 不做 ICC 组织树；无工号时返回空数组，ICC 指标降级为 null（前端「—」）。
 */
async function listAccountWorkNos(prisma: PrismaClient, accountId: number): Promise<string[]> {
  const links = await prisma.account_users.findMany({
    where: { account_id: accountId, user_id: { not: null } },
    select: { user_id: true },
    take: 500,
  });
  const userIds = [
    ...new Set(links.map((l) => l.user_id).filter((id): id is number => id != null)),
  ];
  if (!userIds.length) return [];
  const users = await prisma.users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, uid: true },
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    const wn = resolveCcsWorkNo(u, 'uid');
    if (!wn || seen.has(wn)) continue;
    seen.add(wn);
    out.push(wn);
  }
  return out;
}

async function avgReportingSeconds(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    userId: number | null;
    from: Date;
    to: Date;
    names: string[];
  },
): Promise<number | null> {
  const where: Record<string, unknown> = {
    account_id: opts.accountId,
    created_at: { gte: opts.from, lt: opts.to },
    name: { in: opts.names },
    value: { not: null },
  };
  if (opts.userId != null) where.user_id = opts.userId;

  const agg = await prisma.reporting_events.aggregate({
    where: where as never,
    _avg: { value: true },
    _count: { id: true },
  });
  if (!agg._count.id || agg._avg.value == null) return null;
  return Math.round(agg._avg.value);
}

async function avgCsatPct(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    agentId: number | null;
    from: Date;
    to: Date;
  },
): Promise<number | null> {
  const where: Record<string, unknown> = {
    account_id: opts.accountId,
    created_at: { gte: opts.from, lt: opts.to },
  };
  if (opts.agentId != null) where.assigned_agent_id = opts.agentId;

  const agg = await prisma.csat_survey_responses.aggregate({
    where: where as never,
    _avg: { rating: true },
    _count: { id: true },
  });
  if (!agg._count.id || agg._avg.rating == null) return null;
  // Chatwoot rating 通常 1–5
  return Math.round((agg._avg.rating / 5) * 1000) / 10;
}

function formatTimeLabel(dueAt: Date | null, createdAt: Date): string {
  const d = dueAt ?? createdAt;
  const now = new Date();
  const startToday = startOfDay(now);
  const startY = new Date(startToday);
  startY.setDate(startY.getDate() - 1);
  if (d >= startToday) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (d >= startY) return '昨天';
  const days = Math.floor((startToday.getTime() - d.getTime()) / 86400000);
  if (days <= 3) return '前天';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function relativeAnnounceLabel(publishedAt: Date): string {
  const diffMs = Date.now() - publishedAt.getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return `${publishedAt.getMonth() + 1}-${String(publishedAt.getDate()).padStart(2, '0')}`;
}

export const DASHBOARD_QUICK_LINKS = [
  { key: 'voice', label: '话务管理', to: '/omnichannel' },
  { key: 'tickets', label: '工单管理', to: '/omnichannel', query: { panel: 'tickets' } },
  { key: 'kb', label: '知识库', to: '/omnichannel', query: { panel: 'kb' } },
  { key: 'history', label: '接触历史', to: '/omnichannel', query: { panel: 'history' } },
  { key: 'inspection', label: '质检成绩', to: '/inspection' },
  { key: 'training', label: '培训考试', to: '/business-nav', query: { tile: '本周培训及考试' } },
  { key: 'announce', label: '内部公告', to: '/business-nav', query: { tile: '最新未读公告信息' } },
  { key: 'customers', label: '客户画像', to: '/customers' },
] as const;

export async function buildDashboardMetrics(
  prisma: PrismaClient,
  opts: {
    userId: number;
    workNo: string;
    scope: 'personal' | 'team';
  },
): Promise<{ blocks: MetricBlock[] }> {
  const accountId = await resolveAccountId(prisma, opts.userId);
  // personal：仅当前坐席；team：account 内全量（Omni 指标差异来自 user 过滤；ICC 用工号列表聚合）
  const agentFilter = opts.scope === 'personal' ? opts.userId : null;
  const teamWorkNos =
    opts.scope === 'team' ? await listAccountWorkNos(prisma, accountId) : [];
  const iccWorkFilter: string | string[] =
    opts.scope === 'personal'
      ? opts.workNo
      : teamWorkNos.length
        ? teamWorkNos
        : opts.workNo
          ? [opts.workNo]
          : [];
  const now = new Date();
  const windows: Array<{ title: string; period: MetricBlock['period']; from: Date }> = [
    { title: '今日会话', period: 'today', from: startOfDay(now) },
    { title: '本周会话', period: 'week', from: startOfWeek(now) },
    { title: '本月会话', period: 'month', from: startOfMonth(now) },
  ];

  const blocks: MetricBlock[] = [];
  for (const w of windows) {
    const [reportingResponse, reportingWait, csat, iccSat, iccResponse, iccWait, omniCount, iccCount] =
      await Promise.all([
      avgReportingSeconds(prisma, {
        accountId,
        userId: agentFilter,
        from: w.from,
        to: now,
        names: ['first_response', 'first_response_time', 'reply_time'],
      }),
      avgReportingSeconds(prisma, {
        accountId,
        userId: agentFilter,
        from: w.from,
        to: now,
        names: ['waiting_time', 'queue_wait', 'conversation_waiting'],
      }),
      avgCsatPct(prisma, { accountId, agentId: agentFilter, from: w.from, to: now }),
      avgIccSatisfactionPct(iccWorkFilter, w.from, now),
      avgIccResponseSec(iccWorkFilter, w.from, now),
      avgIccQueueWaitSec(iccWorkFilter, w.from, now),
      countOmniNonVoiceConversations(prisma, {
        accountId,
        userId: agentFilter,
        from: w.from,
        to: now,
      }),
      countIccCalls(iccWorkFilter, w.from, now),
    ]);

    blocks.push({
      title: w.title,
      period: w.period,
      session_count: omniCount + iccCount,
      avg_response_sec: reportingResponse ?? iccResponse ?? null,
      avg_wait_sec: reportingWait ?? iccWait ?? null,
      // AIQC 指标由独立 AIQCServer 提供；禁止继续读取已下线的 MySQL 质检表。
      avg_quality: null,
      avg_satisfaction_pct: csat ?? iccSat,
    });
  }
  return { blocks };
}

async function countOmniNonVoiceConversations(
  prisma: PrismaClient,
  opts: { accountId: number; userId: number | null; from: Date; to: Date },
): Promise<number> {
  const voiceIds = await listVoiceInboxIds(prisma, opts.accountId);
  return prisma.conversations.count({
    where: {
      account_id: opts.accountId,
      created_at: { gte: opts.from, lt: opts.to },
      ...(opts.userId != null ? { assignee_id: opts.userId } : {}),
      ...(voiceIds.length ? { inbox_id: { notIn: voiceIds } } : {}),
    },
  });
}

async function listVoiceInboxIds(prisma: PrismaClient, accountId: number): Promise<number[]> {
  const inboxes = await prisma.inboxes.findMany({
    where: { account_id: accountId },
    select: { id: true, name: true, channel_type: true },
  });
  return inboxes.filter((i) => isVoiceInbox(i.channel_type, i.name ?? '')).map((i) => i.id);
}

export async function buildChannelVolume(
  prisma: PrismaClient,
  opts: { userId: number; workNo?: string; personalOnly: boolean },
): Promise<ChannelVolumePack> {
  const accountId = await resolveAccountId(prisma, opts.userId);
  const now = new Date();
  const todayStart = startOfDay(now);
  const since = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
  const dates: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    dates.push(ymdWall(new Date(since.getTime() + i * 24 * 60 * 60 * 1000)));
  }
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  let workNo = String(opts.workNo ?? '').trim();
  if (!workNo) {
    const user = await prisma.users.findUnique({
      where: { id: opts.userId },
      select: { id: true, uid: true },
    });
    workNo = String(user?.uid ?? '').trim();
  }

  const voiceIds = await listVoiceInboxIds(prisma, accountId);
  const convWhere: {
    account_id: number;
    created_at: { gte: Date; lt: Date };
    assignee_id?: number;
    inbox_id?: { notIn: number[] };
  } = {
    account_id: accountId,
    created_at: { gte: since, lt: now },
  };
  if (opts.personalOnly) convWhere.assignee_id = opts.userId;
  if (voiceIds.length) convWhere.inbox_id = { notIn: voiceIds };

  const convs = await prisma.conversations.findMany({
    where: convWhere,
    select: { created_at: true, inbox_id: true },
  });
  const inboxIds = [...new Set(convs.map((c) => c.inbox_id))];
  const inboxes = inboxIds.length
    ? await prisma.inboxes.findMany({
        where: { id: { in: inboxIds } },
        select: { id: true, name: true, channel_type: true },
      })
    : [];
  const inboxMap = new Map(inboxes.map((i) => [i.id, i]));

  const seriesMap = new Map<string, number[]>();
  const ensureSeries = (name: string) => {
    let arr = seriesMap.get(name);
    if (!arr) {
      arr = dates.map(() => 0);
      seriesMap.set(name, arr);
    }
    return arr;
  };

  for (const conv of convs) {
    const inbox = inboxMap.get(conv.inbox_id);
    const label = labelForChannel(inbox?.channel_type, inbox?.name ?? '未知渠道');
    const key = ymdWall(conv.created_at);
    const idx = dateIndex.get(key);
    if (idx == null) continue;
    ensureSeries(label)[idx] += 1;
  }

  const iccDays = workNo ? await listIccCallCountsByDay(workNo, since, now) : [];
  if (iccDays.length) {
    const phone = ensureSeries('电话');
    for (const row of iccDays) {
      const idx = dateIndex.get(row.date);
      if (idx == null) continue;
      phone[idx] += row.count;
    }
  }

  const series = [...seriesMap.entries()]
    .map(([channel_name, data]) => ({ channel_name, data }))
    .sort((a, b) => b.data.reduce((s, n) => s + n, 0) - a.data.reduce((s, n) => s + n, 0));

  return { dates, series };
}

export async function listMemos(prisma: PrismaClient, userId: number, includeDone = false) {
  const rows = await prisma.agent_memos.findMany({
    where: {
      user_id: userId,
      ...(includeDone ? {} : { done: false }),
    },
    orderBy: [{ due_at: 'asc' }, { created_at: 'desc' }],
    take: 100,
  });
  return {
    items: rows.map((m) => ({
      id: String(m.id),
      title: m.title,
      content: m.content ?? '',
      done: m.done,
      time_label: formatTimeLabel(m.due_at, m.created_at),
      due_at: m.due_at?.toISOString() ?? null,
    })),
  };
}

export async function createMemo(
  prisma: PrismaClient,
  userId: number,
  body: { title: string; content?: string; due_at?: string | null },
) {
  const row = await prisma.agent_memos.create({
    data: {
      user_id: userId,
      title: body.title.trim(),
      content: body.content?.trim() || null,
      due_at: body.due_at ? new Date(body.due_at) : null,
    },
  });
  return {
    id: String(row.id),
    title: row.title,
    content: row.content ?? '',
    done: row.done,
    time_label: formatTimeLabel(row.due_at, row.created_at),
    due_at: row.due_at?.toISOString() ?? null,
  };
}

export async function patchMemo(
  prisma: PrismaClient,
  userId: number,
  id: number,
  body: { title?: string; content?: string; due_at?: string | null; done?: boolean },
) {
  const existing = await prisma.agent_memos.findFirst({ where: { id, user_id: userId } });
  if (!existing) return null;
  const row = await prisma.agent_memos.update({
    where: { id },
    data: {
      ...(body.title !== undefined && { title: body.title.trim() }),
      ...(body.content !== undefined && { content: body.content?.trim() || null }),
      ...(body.due_at !== undefined && { due_at: body.due_at ? new Date(body.due_at) : null }),
      ...(body.done !== undefined && { done: body.done }),
    },
  });
  return {
    id: String(row.id),
    title: row.title,
    content: row.content ?? '',
    done: row.done,
    time_label: formatTimeLabel(row.due_at, row.created_at),
    due_at: row.due_at?.toISOString() ?? null,
  };
}

export { listAnnouncements, markAnnouncementsRead, markAnnouncementUnread } from '../../modules/announcements/announcements.service.js';

export async function listCalendarEvents(
  prisma: PrismaClient,
  userId: number,
  month?: string,
) {
  let from: Date;
  let to: Date;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    from = new Date(y, m - 1, 1);
    to = new Date(y, m, 1);
  } else {
    const now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  const rows = await prisma.agent_calendar_events.findMany({
    where: {
      user_id: userId,
      date: { gte: from, lt: to },
    },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });

  return {
    events: rows.map((e) => {
      const d = e.date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const kinds = Array.isArray(e.kinds) ? (e.kinds as string[]) : [];
      return {
        id: String(e.id),
        date: key,
        kinds,
        time: e.time || '',
        location: e.location || '',
        content: e.content || '',
        note: e.note || '',
      };
    }),
  };
}

export async function createCalendarEvent(
  prisma: PrismaClient,
  userId: number,
  body: {
    date: string;
    time?: string;
    location?: string;
    content?: string;
    note?: string;
    kinds?: string[];
  },
) {
  const date = new Date(`${body.date}T00:00:00`);
  const row = await prisma.agent_calendar_events.create({
    data: {
      user_id: userId,
      date,
      time: body.time ?? '',
      location: body.location ?? '',
      content: body.content ?? '',
      note: body.note ?? '',
      kinds: body.kinds ?? ['meeting'],
    },
  });
  const d = row.date;
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    id: String(row.id),
    date: key,
    kinds: Array.isArray(row.kinds) ? (row.kinds as string[]) : [],
    time: row.time,
    location: row.location,
    content: row.content,
    note: row.note,
  };
}

function mapCalendarRow(row: {
  id: number;
  date: Date;
  kinds: unknown;
  time: string;
  location: string;
  content: string;
  note: string;
}) {
  const d = row.date;
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    id: String(row.id),
    date: key,
    kinds: Array.isArray(row.kinds) ? (row.kinds as string[]) : [],
    time: row.time,
    location: row.location,
    content: row.content,
    note: row.note,
  };
}

export async function patchCalendarEvent(
  prisma: PrismaClient,
  userId: number,
  id: number,
  body: {
    date?: string;
    time?: string;
    location?: string;
    content?: string;
    note?: string;
    kinds?: string[];
  },
) {
  const existing = await prisma.agent_calendar_events.findFirst({
    where: { id, user_id: userId },
  });
  if (!existing) return null;
  const row = await prisma.agent_calendar_events.update({
    where: { id },
    data: {
      ...(body.date !== undefined && { date: new Date(`${body.date}T00:00:00`) }),
      ...(body.time !== undefined && { time: body.time }),
      ...(body.location !== undefined && { location: body.location }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.note !== undefined && { note: body.note }),
      ...(body.kinds !== undefined && { kinds: body.kinds }),
    },
  });
  return mapCalendarRow(row);
}

export async function deleteCalendarEvent(
  prisma: PrismaClient,
  userId: number,
  id: number,
): Promise<boolean> {
  const existing = await prisma.agent_calendar_events.findFirst({
    where: { id, user_id: userId },
  });
  if (!existing) return false;
  await prisma.agent_calendar_events.delete({ where: { id } });
  return true;
}

export { resolveAccountId };
