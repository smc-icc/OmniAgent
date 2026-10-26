import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../plugins/db.js';
import {
  bumpHeatmap,
  csvEscape,
  dayKey,
  emptyHeatmap,
  periodWindow,
  ratingToCsatPct,
  yoyDelta,
  type BiPeriod,
} from '../../shared/services/omni-metrics.js';

function parsePeriod(raw: unknown): BiPeriod {
  return String(raw || '') === '30d' ? '30d' : '7d';
}

async function loadPack(period: BiPeriod) {
  const { from, prevFrom, prevTo, days } = periodWindow(period);
  const where = { created_at: { gte: from } };
  const prevWhere = { created_at: { gte: prevFrom, lte: prevTo } };

  const [rows, prevRows, csat, prevCsat] = await Promise.all([
    prisma.omni_session_records.findMany({
      where,
      select: {
        created_at: true,
        ended_at: true,
        assigned_at: true,
        wait_sec: true,
        talk_sec: true,
        channel: true,
        skill_group_name: true,
        assignee_name: true,
        assignee_work_no: true,
        assignee_user_id: true,
        method: true,
      },
    }),
    prisma.omni_session_records.findMany({
      where: prevWhere,
      select: { id: true, ended_at: true, assigned_at: true },
    }),
    prisma.csat_survey_responses.aggregate({
      where: { created_at: { gte: from } },
      _avg: { rating: true },
      _count: { id: true },
    }),
    prisma.csat_survey_responses.aggregate({
      where: { created_at: { gte: prevFrom, lte: prevTo } },
      _avg: { rating: true },
      _count: { id: true },
    }),
  ]);

  const labels: string[] = [];
  const handledByDay = new Map<string, number>();
  const abandonedByDay = new Map<string, number>();
  const slaByDay = new Map<string, { ok: number; n: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    const key = dayKey(d);
    labels.push(key.slice(5));
    handledByDay.set(key, 0);
    abandonedByDay.set(key, 0);
    slaByDay.set(key, { ok: 0, n: 0 });
  }

  const heatmap = emptyHeatmap();
  const channelMap = new Map<string, number>();
  const queueMap = new Map<string, { handled: number; wait: number; talk: number; slaOk: number }>();
  const agentMap = new Map<string, { name: string; handled: number; talk: number; nTalk: number }>();

  let assigned = 0;
  let ended = 0;
  let waitSum = 0;
  let talkSum = 0;
  let talkN = 0;

  for (const r of rows) {
    const key = dayKey(r.created_at);
    bumpHeatmap(heatmap.matrix, r.created_at);
    const ch = r.channel || 'media';
    channelMap.set(ch, (channelMap.get(ch) || 0) + 1);
    const qn = r.skill_group_name || '全媒体';
    const q = queueMap.get(qn) || { handled: 0, wait: 0, talk: 0, slaOk: 0 };
    q.handled += 1;
    q.wait += r.wait_sec || 0;
    q.talk += r.talk_sec || 0;
    if ((r.wait_sec || 0) <= 30) q.slaOk += 1;
    queueMap.set(qn, q);

    if (r.assignee_user_id || r.assignee_name || r.assignee_work_no) {
      const id = String(r.assignee_user_id || r.assignee_work_no || r.assignee_name);
      const a = agentMap.get(id) || {
        name: r.assignee_name || r.assignee_work_no || id,
        handled: 0,
        talk: 0,
        nTalk: 0,
      };
      a.handled += 1;
      if (r.talk_sec) {
        a.talk += r.talk_sec;
        a.nTalk += 1;
      }
      agentMap.set(id, a);
    }

    if (r.assigned_at) assigned += 1;
    if (r.ended_at) ended += 1;
    waitSum += r.wait_sec || 0;
    if (r.talk_sec) {
      talkSum += r.talk_sec;
      talkN += 1;
    }

    if (!handledByDay.has(key)) continue;
    if (r.assigned_at || r.ended_at) {
      handledByDay.set(key, (handledByDay.get(key) || 0) + 1);
    }
    if (!r.assigned_at && r.ended_at) {
      abandonedByDay.set(key, (abandonedByDay.get(key) || 0) + 1);
    }
    const sla = slaByDay.get(key);
    if (sla) {
      sla.n += 1;
      if ((r.wait_sec || 0) <= 30) sla.ok += 1;
    }
  }

  const handled = labels.map((_, i) => {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    return handledByDay.get(dayKey(d)) || 0;
  });
  const abandoned = labels.map((_, i) => {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    return abandonedByDay.get(dayKey(d)) || 0;
  });
  const slaSeries = labels.map((_, i) => {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    const s = slaByDay.get(dayKey(d)) || { ok: 0, n: 0 };
    return s.n ? Math.round((s.ok / s.n) * 1000) / 10 : 0;
  });

  const totalH = handled.reduce((a, b) => a + b, 0);
  const totalAb = abandoned.reduce((a, b) => a + b, 0);
  const abandonRate = Math.round((1000 * totalAb) / Math.max(1, totalH + totalAb)) / 10;
  const avgSla = (() => {
    const vals: number[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      const s = slaByDay.get(dayKey(d)) || { ok: 0, n: 0 };
      if (s.n > 0) vals.push((s.ok / s.n) * 100);
    }
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
  })();
  const csatPct = ratingToCsatPct(csat._avg.rating, csat._count.id);
  const prevCsatPct = ratingToCsatPct(prevCsat._avg.rating, prevCsat._count.id);
  const prevHandled = prevRows.filter((r) => r.assigned_at || r.ended_at).length;
  const prevAbandon = prevRows.filter((r) => !r.assigned_at && r.ended_at).length;
  const prevAbandonRate = Math.round((1000 * prevAbandon) / Math.max(1, prevHandled + prevAbandon)) / 10;

  const handledYoy = yoyDelta(totalH, prevHandled);
  const abandonYoy = yoyDelta(abandonRate, prevAbandonRate, 'pct');
  abandonYoy.status = abandonRate <= prevAbandonRate ? 'good' : 'warn';
  const csatYoy = yoyDelta(csatPct ?? 0, prevCsatPct ?? 0, 'pct');

  const channel_mix = [...channelMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const queues = [...queueMap.entries()]
    .map(([name, q]) => ({
      queue_id: name,
      name,
      handled: q.handled,
      avg_wait_sec: q.handled ? Math.round(q.wait / q.handled) : 0,
      sl_met_pct: q.handled ? Math.round((q.slaOk / q.handled) * 1000) / 10 : 0,
      aht_sec: q.handled ? Math.round(q.talk / q.handled) : 0,
    }))
    .sort((a, b) => b.handled - a.handled);

  const csatByAgent = await prisma.csat_survey_responses.groupBy({
    by: ['assigned_agent_id'],
    where: { created_at: { gte: from }, assigned_agent_id: { not: null } },
    _avg: { rating: true },
    _count: { id: true },
  });
  const csatMap = new Map<string, number>();
  for (const row of csatByAgent) {
    if (row.assigned_agent_id) {
      csatMap.set(String(row.assigned_agent_id), ratingToCsatPct(row._avg.rating, row._count.id) ?? 0);
    }
  }

  const agents = [...agentMap.entries()]
    .map(([id, a]) => ({
      agent_id: id,
      name: a.name,
      handled: a.handled,
      csat_pct: csatMap.get(id) ?? csatPct ?? 0,
      quality_avg: Math.round(((csatMap.get(id) ?? csatPct ?? 0) / 20) * 10) / 10,
      aht_sec: a.nTalk ? Math.round(a.talk / a.nTalk) : 0,
    }))
    .sort((a, b) => b.handled - a.handled)
    .map((a, i) => ({ rank: i + 1, ...a }));

  const quality_csat = {
    labels,
    quality_avg: slaSeries.map((_, i) => {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      return 0;
    }),
    csat_pct: labels.map(() => csatPct ?? 0),
  };

  const dailyCsat = await prisma.csat_survey_responses.findMany({
    where: { created_at: { gte: from } },
    select: { created_at: true, rating: true },
  });
  const csatDay = new Map<string, { s: number; n: number }>();
  for (const r of dailyCsat) {
    const k = dayKey(r.created_at);
    const cur = csatDay.get(k) || { s: 0, n: 0 };
    cur.s += r.rating;
    cur.n += 1;
    csatDay.set(k, cur);
  }
  quality_csat.csat_pct = labels.map((_, i) => {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    const cur = csatDay.get(dayKey(d));
    return cur ? Math.round((cur.s / cur.n / 5) * 1000) / 10 : 0;
  });
  quality_csat.quality_avg = quality_csat.csat_pct.map((p) => Math.round((p / 20) * 10) / 10);

  return {
    period,
    generated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    kpi: [
      { key: 'handled', label: '总处理量', value: String(totalH), unit: '通/件', ...handledYoy },
      {
        key: 'abandon_rate',
        label: '放弃率',
        value: String(abandonRate),
        unit: '%',
        yoy: abandonYoy.yoy,
        status: abandonYoy.status,
      },
      { key: 'sla', label: 'SLA 达成(等待≤30s)', value: String(avgSla), unit: '%', yoy: '—', status: 'neutral' },
      {
        key: 'csat',
        label: 'CSAT',
        value: csatPct == null ? '—' : String(csatPct),
        unit: '%',
        ...csatYoy,
      },
      {
        key: 'wait',
        label: '平均等待',
        value: String(rows.length ? Math.round(waitSum / rows.length) : 0),
        unit: '秒',
        yoy: '—',
        status: 'neutral',
      },
      {
        key: 'aht',
        label: '平均处理时长',
        value: String(talkN ? Math.round(talkSum / talkN) : 0),
        unit: '秒',
        yoy: '—',
        status: 'neutral',
      },
    ],
    volume: { labels, handled, abandoned },
    sla: { labels, sl_met_pct: slaSeries },
    channel_mix: channel_mix.length ? channel_mix : [{ name: 'media', value: rows.length }],
    queues,
    agents,
    heatmap,
    quality_csat,
    _meta: { sessions: rows.length, assigned, ended, csat_count: csat._count.id },
  };
}

export async function biRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/bi/catalog', auth, async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      intro:
        '全媒体报表覆盖：进线与处理量、排队放弃、等待 SLA、渠道结构、技能组对比、坐席处理量与 CSAT。数据来自 omni_session_records 与 csat_survey_responses。',
      themes: [
        { id: 'exec', name: '管理驾驶舱', metrics: ['处理量', 'SLA', '放弃率', 'CSAT'] },
        { id: 'traffic', name: '话务与接通', metrics: ['分日进线', '放弃', '峰值时段'] },
        { id: 'queue', name: '队列服务', metrics: ['各队列处理量', '平均等待', 'SLA 对比'] },
        { id: 'agent', name: '坐席绩效', metrics: ['处理量排名', 'AHT', 'CSAT'] },
        { id: 'heatmap', name: '进线热力', metrics: ['星期×小时矩阵'] },
        { id: 'quality', name: '体验与质检', metrics: ['CSAT 趋势'] },
      ],
    });
  });

  fastify.get('/api/bi/data-pack', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const period = parsePeriod((req.query as { period?: string }).period);
    try {
      return reply.send(await loadPack(period));
    } catch (err) {
      req.log.warn({ err }, 'bi data-pack failed');
      return reply.send({
        period,
        generated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        kpi: [],
        volume: { labels: [], handled: [], abandoned: [] },
        sla: { labels: [], sl_met_pct: [] },
        channel_mix: [],
        queues: [],
        agents: [],
        heatmap: emptyHeatmap(),
        quality_csat: { labels: [], quality_avg: [], csat_pct: [] },
      });
    }
  });

  fastify.get('/api/bi/export/summary', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const period = parsePeriod((req.query as { period?: string }).period);
    const pack = await loadPack(period);
    const lines = ['\ufeffdate,handled,abandoned,sl_met_pct'];
    pack.volume.labels.forEach((lab, i) => {
      lines.push(`${csvEscape(lab)},${pack.volume.handled[i]},${pack.volume.abandoned[i]},${pack.sla.sl_met_pct[i]}`);
    });
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="omni_bi_${period}.csv"`);
    return reply.send(lines.join('\n'));
  });

  fastify.get('/api/omnichannel/csat/summary', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { from?: string; to?: string; dim?: string };
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || ''))
      ? new Date(`${q.from}T00:00:00`)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() - 6);
          d.setHours(0, 0, 0, 0);
          return d;
        })();
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || ''))
      ? new Date(`${q.to}T23:59:59.999`)
      : new Date();
    const dim = String(q.dim || '全中心');
    const where = { created_at: { gte: from, lte: to } };
    const [agg, rows, sessions] = await Promise.all([
      prisma.csat_survey_responses.aggregate({
        where,
        _avg: { rating: true },
        _count: { id: true },
      }),
      prisma.csat_survey_responses.findMany({
        where,
        select: {
          rating: true,
          created_at: true,
          assigned_agent_id: true,
          assigned_agent: { select: { name: true } },
          conversation: {
            select: {
              inbox: { select: { name: true } },
            },
          },
        },
        take: 500,
      }),
      prisma.omni_session_records.count({ where }),
    ]);
    const low = rows.filter((r) => r.rating <= 2).length;
    const csatPct = ratingToCsatPct(agg._avg.rating, agg._count.id);
    const groups = new Map<string, { recv: number; sum: number }>();
    for (const r of rows) {
      let key = '全中心';
      if (dim === '坐席') key = r.assigned_agent?.name || `坐席${r.assigned_agent_id || ''}` || '未分配';
      else if (dim === '技能组') key = r.conversation?.inbox?.name || '全媒体';
      const g = groups.get(key) || { recv: 0, sum: 0 };
      g.recv += 1;
      g.sum += r.rating;
      groups.set(key, g);
    }
    if (!groups.size) groups.set('全中心', { recv: 0, sum: 0 });
    const detail = [...groups.entries()].map(([queue, g]) => {
      const avg = g.recv ? Math.round((g.sum / g.recv) * 100) / 100 : 0;
      return {
        period: `${from.toISOString().slice(0, 10)} ~ ${to.toISOString().slice(0, 10)}`,
        queue,
        sent: String(sessions),
        recv: String(g.recv),
        rate: sessions ? `${Math.round((g.recv / sessions) * 1000) / 10}%` : '0%',
        csat: g.recv ? String(Math.round((avg / 5) * 1000) / 10) : '0',
        avg: String(avg),
      };
    });
    return reply.send({
      count: agg._count.id,
      avg_rating: agg._avg.rating == null ? null : Math.round(agg._avg.rating * 100) / 100,
      csat_pct: csatPct,
      low_pct: agg._count.id ? Math.round((low / agg._count.id) * 1000) / 10 : 0,
      rows: detail,
    });
  });
}
