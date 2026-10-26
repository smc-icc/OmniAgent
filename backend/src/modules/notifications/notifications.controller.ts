import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';

// ═══ Notifications ═══

export async function listNotifications(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const user = request.currentUser;
  const query = request.query as { page?: string; per_page?: string };
  const page = parseInt(query.page ?? '1', 10);
  const perPage = Math.min(parseInt(query.per_page ?? '25', 10), 100);

  const [total, items] = await Promise.all([
    prisma.notifications.count({ where: { account_id: parseInt(account_id, 10), user_id: user?.id ?? 0 } }),
    prisma.notifications.findMany({
      where: { account_id: parseInt(account_id, 10), user_id: user?.id ?? 0 },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return reply.status(200).send({
    payload: items,
    meta: { current_page: page, total_count: total, unread_count: await unreadCount(parseInt(account_id, 10), user?.id ?? 0) },
  });
}

export async function updateNotification(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as { read_at?: string; snoozed_until?: string };
  await prisma.notifications.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.read_at !== undefined && { read_at: body.read_at ? new Date(body.read_at) : null }),
      ...(body.snoozed_until !== undefined && { snoozed_until: body.snoozed_until ? new Date(body.snoozed_until) : null }),
    },
  });
  return reply.status(200).send({ success: true });
}

export async function destroyNotification(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.notifications.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

export async function readAllNotifications(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const user = request.currentUser;
  await prisma.notifications.updateMany({
    where: { account_id: parseInt(account_id, 10), user_id: user?.id ?? 0, read_at: null },
    data: { read_at: new Date() },
  });
  return reply.status(200).send({ success: true });
}

export async function destroyAllNotifications(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const user = request.currentUser;
  await prisma.notifications.deleteMany({
    where: { account_id: parseInt(account_id, 10), user_id: user?.id ?? 0 },
  });
  return reply.status(200).send({ success: true });
}

export async function unreadNotificationCount(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const user = request.currentUser;
  const count = await unreadCount(parseInt(account_id, 10), user?.id ?? 0);
  return reply.status(200).send({ count });
}

export async function snoozeNotification(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.notifications.update({
    where: { id: parseInt(id, 10) },
    data: { snoozed_until: new Date(Date.now() + 3600000) }, // 1 hour
  });
  return reply.status(200).send({ success: true });
}

export async function unreadNotification(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.notifications.update({
    where: { id: parseInt(id, 10) },
    data: { read_at: null },
  });
  return reply.status(200).send({ success: true });
}

async function unreadCount(accountId: number, userId: number): Promise<number> {
  return prisma.notifications.count({
    where: { account_id: accountId, user_id: userId, read_at: null },
  });
}

// ═══ Notification Settings ═══

export async function showNotificationSettings(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const user = request.currentUser;
  const settings = await prisma.notification_settings.findFirst({
    where: { account_id: parseInt(account_id, 10), user_id: user?.id ?? 0 },
  });
  return reply.status(200).send(settings ?? { email_flags: 0, push_flags: 0 });
}

export async function updateNotificationSettings(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const user = request.currentUser;
  const body = request.body as { email_flags?: number; push_flags?: number };
  const accId = parseInt(account_id, 10);
  const uid = user?.id ?? 0;

  const existing = await prisma.notification_settings.findFirst({
    where: { account_id: accId, user_id: uid },
  });

  if (existing) {
    await prisma.notification_settings.update({
      where: { id: existing.id },
      data: { email_flags: body.email_flags, push_flags: body.push_flags },
    });
  } else {
    await prisma.notification_settings.create({
      data: { account_id: accId, user_id: uid, email_flags: body.email_flags ?? 0, push_flags: body.push_flags ?? 0 },
    });
  }

  return reply.status(200).send({ success: true });
}

// ═══ Search ═══

export async function searchAll(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { q } = request.query as { q?: string };
  const accId = parseInt(account_id, 10);

  if (!q) return reply.status(200).send({ conversations: [], messages: [], contacts: [] });

  const [conv, msgs, contacts] = await Promise.all([
    prisma.conversations.findMany({
      where: { account_id: accId, cached_label_list: { contains: q, mode: 'insensitive' } },
      take: 10,
    }),
    prisma.messages.findMany({
      where: { account_id: accId, content: { contains: q, mode: 'insensitive' } },
      take: 10, orderBy: { created_at: 'desc' },
    }),
    prisma.contacts.findMany({
      where: { account_id: accId, OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
      take: 10,
    }),
  ]);

  return reply.status(200).send({
    conversations: conv.map((c) => ({ id: c.id, display_id: c.display_id, status: c.status })),
    messages: msgs.map((m) => ({ id: m.id, content: m.content?.substring(0, 100), conversation_id: m.conversation_id })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, email: c.email })),
  });
}

// ═══ Reports V2 ═══

export async function reportSummary(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const [open, resolved, total] = await Promise.all([
    prisma.conversations.count({ where: { account_id: accId, status: 0 } }),
    prisma.conversations.count({ where: { account_id: accId, status: 1 } }),
    prisma.conversations.count({ where: { account_id: accId } }),
  ]);
  return reply.status(200).send({ open, resolved, total });
}

export async function reportBotSummary(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ bots: [] });
}

export async function reportAgents(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const agents = await prisma.account_users.findMany({
    where: { account_id: accId },
    include: { user: { select: { id: true, name: true } } },
  });

  const result = await Promise.all(agents.map(async (au) => {
    const assigned = await prisma.conversations.count({ where: { account_id: accId, assignee_id: au.user?.id } });
    return { id: au.user?.id, name: au.user?.name, assigned_count: assigned };
  }));
  return reply.status(200).send(result);
}

export async function reportInboxes(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const inboxes = await prisma.inboxes.findMany({ where: { account_id: accId } });
  const result = await Promise.all(inboxes.map(async (ib) => {
    const count = await prisma.conversations.count({ where: { inbox_id: ib.id } });
    return { id: ib.id, name: ib.name, conversation_count: count };
  }));
  return reply.status(200).send(result);
}

export async function reportLabels(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const labels = await prisma.labels.findMany({ where: { account_id: accId } });

  const result = await Promise.all(labels.map(async (l) => {
    const count = await prisma.conversations.count({
      where: { account_id: accId, cached_label_list: { contains: l.title ?? '' } },
    });
    return { id: l.id, title: l.title, color: l.color, conversation_count: count };
  }));

  return reply.status(200).send({ labels: result });
}

export async function reportTeams(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const teams = await prisma.teams.findMany({ where: { account_id: parseInt(account_id, 10) } });
  return reply.status(200).send(teams);
}

export async function reportConversations(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { since, until } = request.query as { since?: string; until?: string };
  const accId = parseInt(account_id, 10);

  const where: Record<string, unknown> = { account_id: accId };
  if (since || until) {
    where.created_at = {};
    if (since) (where.created_at as Record<string, unknown>).gte = new Date(since);
    if (until) (where.created_at as Record<string, unknown>).lte = new Date(until);
  }

  const conversations = await prisma.conversations.findMany({
    where: where as object,
    select: { id: true, display_id: true, status: true, created_at: true },
    orderBy: { created_at: 'desc' },
    take: 100,
  });

  return reply.status(200).send(conversations);
}

export async function reportConversationsSummary(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const [open, resolved, pending, snoozed] = await Promise.all([
    prisma.conversations.count({ where: { account_id: accId, status: 0 } }),
    prisma.conversations.count({ where: { account_id: accId, status: 1 } }),
    prisma.conversations.count({ where: { account_id: accId, status: 2 } }),
    prisma.conversations.count({ where: { account_id: accId, status: 3 } }),
  ]);
  return reply.status(200).send({ open, resolved, pending, snoozed });
}

export async function reportConversationTraffic(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0); return d;
  }).reverse();

  const data = await Promise.all(last7Days.map(async (day) => {
    const nextDay = new Date(day); nextDay.setDate(nextDay.getDate() + 1);
    const count = await prisma.conversations.count({
      where: { account_id: accId, created_at: { gte: day, lt: nextDay } },
    });
    return { date: day.toISOString().substring(0, 10), count };
  }));

  return reply.status(200).send(data);
}

export async function reportBotMetrics(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const bots = await prisma.agent_bots.findMany({ where: { account_id: accId } });

  const metrics = await Promise.all(bots.map(async (b) => {
    const handled = await prisma.conversations.count({
      where: { account_id: accId, assignee_agent_bot_id: b.id },
    });
    return { bot_id: b.id, bot_name: b.name, conversations_handled: handled };
  }));
  return reply.status(200).send({ metrics });
}

export async function reportInboxLabelMatrix(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const inboxes = await prisma.inboxes.findMany({ where: { account_id: accId }, select: { id: true, name: true } });
  const labels = await prisma.labels.findMany({ where: { account_id: accId }, select: { id: true, title: true } });

  const matrix = await Promise.all(inboxes.map(async (ib) => {
    const cells = await Promise.all(labels.map(async (l) => {
      const count = await prisma.conversations.count({
        where: { account_id: accId, inbox_id: ib.id, cached_label_list: { contains: l.title ?? '' } },
      });
      return { label_id: l.id, label_title: l.title, count };
    }));
    return { inbox_id: ib.id, inbox_name: ib.name, cells };
  }));
  return reply.status(200).send({ matrix });
}

export async function reportFirstResponseTime(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);

  // Get first outgoing messages for conversations this month
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
  const convs = await prisma.conversations.findMany({
    where: { account_id: accId, created_at: { gte: startOfMonth } },
    select: { id: true, created_at: true, messages: {
      where: { message_type: 1 },
      orderBy: { created_at: 'asc' },
      take: 1,
      select: { created_at: true },
    }},
    take: 200,
  });

  const times = convs
    .filter(c => c.messages.length > 0)
    .map(c => Math.round((c.messages[0].created_at.getTime() - c.created_at.getTime()) / 1000));

  if (times.length === 0) return reply.status(200).send({ distribution: { avg_sec: 0, min_sec: 0, max_sec: 0, p50_sec: 0, p95_sec: 0, total: 0 } });

  const sorted = [...times].sort((a, b) => a - b);
  const avg = Math.round(times.reduce((s, t) => s + t, 0) / times.length);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  return reply.status(200).send({
    distribution: { avg_sec: avg, min_sec: sorted[0], max_sec: sorted[sorted.length - 1], p50_sec: p50, p95_sec: p95, total: times.length },
  });
}

export async function reportOutgoingMessages(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const count = await prisma.messages.count({
    where: { account_id: parseInt(account_id, 10), message_type: 1 },
  });
  return reply.status(200).send({ count });
}

// ═══ Summary Reports V2 ═══

export async function summaryReportAgent(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const agents = await prisma.account_users.findMany({
    where: { account_id: accId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const reports = await Promise.all(agents.map(async (au) => {
    const [assigned, resolved] = await Promise.all([
      prisma.conversations.count({ where: { account_id: accId, assignee_id: au.user?.id } }),
      prisma.conversations.count({ where: { account_id: accId, assignee_id: au.user?.id, status: 1 } }),
    ]);
    return {
      id: au.user?.id, name: au.user?.name, email: au.user?.email,
      assigned_conversations: assigned, resolved_conversations: resolved,
      resolution_rate: assigned > 0 ? Math.round((resolved / assigned) * 100) : 0,
    };
  }));
  return reply.status(200).send({ agent_reports: reports });
}
export async function summaryReportTeam(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const teams = await prisma.teams.findMany({ where: { account_id: parseInt(account_id, 10) }, include: { team_members: true } });

  const reports = teams.map((t) => ({
    id: t.id, name: t.name, description: t.description,
    member_count: t.team_members?.length ?? 0,
  }));
  return reply.status(200).send({ team_reports: reports });
}
export async function summaryReportInbox(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const inboxes = await prisma.inboxes.findMany({ where: { account_id: accId } });

  const reports = await Promise.all(inboxes.map(async (ib) => {
    const [total, open] = await Promise.all([
      prisma.conversations.count({ where: { inbox_id: ib.id } }),
      prisma.conversations.count({ where: { inbox_id: ib.id, status: 0 } }),
    ]);
    return { id: ib.id, name: ib.name, channel_type: ib.channel_type, total_conversations: total, open_conversations: open };
  }));
  return reply.status(200).send({ inbox_reports: reports });
}
export async function summaryReportLabel(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const labels = await prisma.labels.findMany({ where: { account_id: accId } });

  const reports = await Promise.all(labels.map(async (l) => {
    const count = await prisma.conversations.count({
      where: { account_id: accId, cached_label_list: { contains: l.title ?? '' } },
    });
    return { id: l.id, title: l.title, color: l.color, conversation_count: count };
  }));
  return reply.status(200).send({ label_reports: reports });
}
export async function summaryReportChannel(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const inboxes = await prisma.inboxes.findMany({ where: { account_id: accId }, select: { channel_type: true } });

  const channels = [...new Set(inboxes.map(i => i.channel_type).filter(Boolean))];
  const reports = await Promise.all(channels.map(async (ch) => {
    const channelInboxes = await prisma.inboxes.findMany({ where: { account_id: accId, channel_type: ch }, select: { id: true } });
    const ids = channelInboxes.map(i => i.id);
    const count = ids.length > 0 ? await prisma.conversations.count({ where: { inbox_id: { in: ids } } }) : 0;
    return { channel: ch, inbox_count: channelInboxes.length, conversation_count: count };
  }));
  return reply.status(200).send({ channel_reports: reports });
}

// ═══ Live Reports ═══

export async function liveConversationMetrics(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const [open, waiting] = await Promise.all([
    prisma.conversations.count({ where: { account_id: accId, status: 0 } }),
    prisma.conversations.count({ where: { account_id: accId, status: 0, assignee_id: null } }),
  ]);
  return reply.status(200).send({ open_conversations: open, unassigned: waiting });
}

export async function liveGroupedMetrics(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const inboxes = await prisma.inboxes.findMany({ where: { account_id: accId }, select: { id: true, name: true } });
  const result = await Promise.all(inboxes.map(async (ib) => {
    const count = await prisma.conversations.count({ where: { inbox_id: ib.id, status: 0 } });
    return { inbox_id: ib.id, inbox_name: ib.name, open_count: count };
  }));
  return reply.status(200).send(result);
}

// ═══ Year in Review ═══

export async function yearInReview(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const year = new Date().getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const [totalConvs, totalMessages, resolvedConvs] = await Promise.all([
    prisma.conversations.count({ where: { account_id: accId, created_at: { gte: start, lt: end } } }),
    prisma.messages.count({ where: { account_id: accId, created_at: { gte: start, lt: end } } }),
    prisma.conversations.count({ where: { account_id: accId, status: 1, created_at: { gte: start, lt: end } } }),
  ]);

  const monthlyBreakdown = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const mStart = new Date(year, i, 1);
    const mEnd = new Date(year, i + 1, 1);
    const count = await prisma.conversations.count({
      where: { account_id: accId, created_at: { gte: mStart, lt: mEnd } },
    });
    return { month: i + 1, conversations: count };
  }));

  return reply.status(200).send({
    year,
    summary: {
      total_conversations: totalConvs,
      total_messages: totalMessages,
      resolved_conversations: resolvedConvs,
      resolution_rate: totalConvs > 0 ? Math.round((resolvedConvs / totalConvs) * 100) : 0,
      monthly_breakdown: monthlyBreakdown,
    },
  });
}

// ═══ Audit Logs ═══

export async function showAuditLogs(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const query = request.query as { page?: string; per_page?: string };
  const accId = parseInt(account_id, 10);
  const page = parseInt(query.page ?? '1', 10);
  const perPage = Math.min(parseInt(query.per_page ?? '25', 10), 100);

  const [total, logs] = await Promise.all([
    prisma.audit_logs.count({ where: { account_id: accId } }),
    prisma.audit_logs.findMany({
      where: { account_id: accId },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return reply.status(200).send({ audit_logs: logs, meta: { current_page: page, total_count: total, per_page: perPage } });
}
