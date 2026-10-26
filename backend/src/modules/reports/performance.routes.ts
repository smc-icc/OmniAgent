import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../plugins/db.js';
import {
  KPI_DEFINITIONS,
  compositeScore,
  dayKey,
  monthWindow,
  personalWindow,
  ratingToCsatPct,
} from '../../shared/services/omni-metrics.js';

type Goal = {
  id: string;
  period: string;
  agent_id: string;
  agent_name: string;
  kpi_id: string;
  kpi_name: string;
  target_value: string;
  owner: string;
};

const goals: Goal[] = [];

function parseMonthQuery(raw: unknown): string | undefined {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : undefined;
}

async function loadMonthStats(periodYm?: string) {
  const { from, to, label } = monthWindow(periodYm);
  const where = { created_at: { gte: from, lte: to } };
  const [rows, csat] = await Promise.all([
    prisma.omni_session_records.findMany({
      where,
      select: {
        created_at: true,
        wait_sec: true,
        talk_sec: true,
        assigned_at: true,
        ended_at: true,
        skill_group_name: true,
        assignee_name: true,
        assignee_work_no: true,
        assignee_user_id: true,
      },
    }),
    prisma.csat_survey_responses.findMany({
      where,
      select: { rating: true, assigned_agent_id: true, created_at: true },
    }),
  ]);
  return { from, to, label, rows, csat };
}

export async function performanceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/performance/overview', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const period = parseMonthQuery((req.query as { period?: string }).period);
    const { label, rows, csat } = await loadMonthStats(period);
    const handled = rows.filter((r) => r.assigned_at || r.ended_at).length;
    const talkN = rows.filter((r) => (r.talk_sec || 0) > 0);
    const aht = talkN.length ? Math.round(talkN.reduce((s, r) => s + (r.talk_sec || 0), 0) / talkN.length) : 0;
    const waitN = rows.length ? Math.round(rows.reduce((s, r) => s + (r.wait_sec || 0), 0) / rows.length) : 0;
    const csatAvg = csat.length ? csat.reduce((s, r) => s + r.rating, 0) / csat.length : null;
    const csatPct = ratingToCsatPct(csatAvg, csat.length);
    const agentIds = new Set(rows.map((r) => r.assignee_user_id).filter((id): id is number => !!id));
    const teams = new Set(rows.map((r) => r.skill_group_name || '').filter(Boolean));
    const score = compositeScore(csatPct, handled, aht);
    return reply.send({
      period: label,
      center_avg_score: score,
      active_agents: agentIds.size,
      teams_count: teams.size || 1,
      kpis: [
        { key: 'csat', label: '整体 CSAT', value: csatPct == null ? '—' : String(csatPct), unit: '%', trend: '—' },
        { key: 'handled', label: '处理量', value: String(handled), unit: '通', trend: '—' },
        { key: 'aht', label: '平均处理时长', value: String(aht), unit: '秒', trend: '—' },
        { key: 'wait', label: '平均等待', value: String(waitN), unit: '秒', trend: '—' },
      ],
      highlights: [
        csat.length ? `本期回收评价 ${csat.length} 条` : '本期尚无 CSAT 评价',
        `全媒体会话 ${rows.length} 通，已处理 ${handled}`,
      ],
    });
  });

  fastify.get('/api/performance/kpi-definitions', auth, async (_req, reply) => {
    return reply.send({ items: KPI_DEFINITIONS });
  });

  fastify.get('/api/performance/me', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.currentUser?.id;
    if (!userId) return reply.status(401).send({ error: 'unauthorized' });
    const periodKey = String((req.query as { period?: string }).period || 'week');
    const { from, to, label } = personalWindow(periodKey);
    const where = { created_at: { gte: from, lte: to } };
    const [user, rows, csat] = await Promise.all([
      prisma.users.findUnique({
        where: { id: userId },
        select: { id: true, name: true, uid: true, email: true, display_name: true },
      }),
      prisma.omni_session_records.findMany({
        where: { ...where, assignee_user_id: userId },
        select: {
          wait_sec: true,
          talk_sec: true,
          assigned_at: true,
          ended_at: true,
          skill_group_name: true,
        },
      }),
      prisma.csat_survey_responses.findMany({
        where: { ...where, assigned_agent_id: userId },
        select: { rating: true },
      }),
    ]);
    const handled = rows.filter((r) => r.assigned_at || r.ended_at).length;
    const talkN = rows.filter((r) => (r.talk_sec || 0) > 0);
    const aht = talkN.length ? Math.round(talkN.reduce((s, r) => s + (r.talk_sec || 0), 0) / talkN.length) : 0;
    const waitN = rows.length ? Math.round(rows.reduce((s, r) => s + (r.wait_sec || 0), 0) / rows.length) : 0;
    const csatAvg = csat.length ? csat.reduce((s, r) => s + r.rating, 0) / csat.length : null;
    const csatPct = ratingToCsatPct(csatAvg, csat.length);
    const dsatN = csat.filter((r) => r.rating <= 2).length;
    const dsatPct = csat.length ? Math.round((dsatN / csat.length) * 1000) / 10 : null;
    const team = rows.find((r) => r.skill_group_name)?.skill_group_name || '全媒体组';
    return reply.send({
      period: label,
      period_key: periodKey === 'day' || periodKey === 'month' ? periodKey : 'week',
      agent: {
        id: userId,
        name: user?.display_name || user?.name || req.currentUser?.name || '坐席',
        uid: user?.uid || '',
        email: user?.email || req.currentUser?.email || '',
        role: '在线坐席',
        team,
      },
      handled,
      inbound: rows.length,
      aht_sec: aht,
      wait_sec_avg: waitN,
      csat_pct: csatPct,
      csat_count: csat.length,
      dsat_pct: dsatPct,
      quality_rate: null,
      fcr_pct: null,
      attendance_pct: null,
      utilization_pct: null,
      aux_min: null,
      nps: null,
      exam_pass: null,
      high_risk: { flag: false, detail: '' },
      source: 'omni_session_records + csat_survey_responses',
    });
  });

  fastify.get('/api/performance/team-scores', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const period = parseMonthQuery((req.query as { period?: string }).period);
    const { rows, csat } = await loadMonthStats(period);
    const csatPct = ratingToCsatPct(
      csat.length ? csat.reduce((s, r) => s + r.rating, 0) / csat.length : null,
      csat.length,
    );
    const teams = new Map<
      string,
      { handled: number; talk: number; talkN: number; wait: number; users: Set<number> }
    >();
    for (const r of rows) {
      const name = r.skill_group_name || '全媒体组';
      const t = teams.get(name) || { handled: 0, talk: 0, talkN: 0, wait: 0, users: new Set<number>() };
      if (r.assigned_at || r.ended_at) t.handled += 1;
      t.wait += r.wait_sec || 0;
      if (r.talk_sec) {
        t.talk += r.talk_sec;
        t.talkN += 1;
      }
      if (r.assignee_user_id) t.users.add(r.assignee_user_id);
      teams.set(name, t);
    }
    const items = [...teams.entries()].map(([team_name, t], i) => {
      const aht = t.talkN ? Math.round(t.talk / t.talkN) : 0;
      return {
        team_id: `T${i + 1}`,
        team_name,
        headcount: t.users.size,
        composite_score: compositeScore(csatPct, t.handled, aht),
        csat_pct: csatPct ?? 0,
        fcr_pct: 0,
        aht_sec: aht,
        quality_avg: csatPct ?? 0,
        utilization_pct: 0,
      };
    });
    return reply.send({ items });
  });

  fastify.get('/api/performance/agent-scores', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const period = parseMonthQuery((req.query as { period?: string }).period);
    const { rows, csat } = await loadMonthStats(period);
    const csatByAgent = new Map<number, { s: number; n: number }>();
    for (const r of csat) {
      if (!r.assigned_agent_id) continue;
      const g = csatByAgent.get(r.assigned_agent_id) || { s: 0, n: 0 };
      g.s += r.rating;
      g.n += 1;
      csatByAgent.set(r.assigned_agent_id, g);
    }
    const agents = new Map<
      string,
      { name: string; userId: number; handled: number; talk: number; talkN: number; team: string }
    >();
    for (const r of rows) {
      if (!r.assignee_user_id && !r.assignee_name && !r.assignee_work_no) continue;
      const id = String(r.assignee_user_id || r.assignee_work_no || r.assignee_name);
      const a = agents.get(id) || {
        name: r.assignee_name || r.assignee_work_no || id,
        userId: r.assignee_user_id || 0,
        handled: 0,
        talk: 0,
        talkN: 0,
        team: r.skill_group_name || '全媒体组',
      };
      if (r.assigned_at || r.ended_at) a.handled += 1;
      if (r.talk_sec) {
        a.talk += r.talk_sec;
        a.talkN += 1;
      }
      agents.set(id, a);
    }
    const items = [...agents.entries()].map(([agent_id, a]) => {
      const cg = a.userId ? csatByAgent.get(a.userId) : undefined;
      const csatPct = cg ? ratingToCsatPct(cg.s / cg.n, cg.n) : null;
      const aht = a.talkN ? Math.round(a.talk / a.talkN) : 0;
      return {
        agent_id,
        name: a.name,
        team_name: a.team,
        composite_score: compositeScore(csatPct, a.handled, aht),
        csat_pct: csatPct ?? 0,
        handled: a.handled,
        aht_sec: aht,
        quality_avg: csatPct ?? 0,
        adherence_pct: 0,
      };
    });
    items.sort((a, b) => b.handled - a.handled);
    return reply.send({ items });
  });

  fastify.get('/api/performance/trend', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { metric?: string; period?: string };
    const metric = String(q.metric || 'aht');
    const { from, to, label } = monthWindow(parseMonthQuery(q.period));
    const where = { created_at: { gte: from, lte: to } };
    const [rows, csat] = await Promise.all([
      prisma.omni_session_records.findMany({
        where,
        select: { created_at: true, talk_sec: true, assigned_at: true, ended_at: true },
      }),
      prisma.csat_survey_responses.findMany({
        where,
        select: { created_at: true, rating: true },
      }),
    ]);
    const days: string[] = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      days.push(dayKey(new Date(d)));
    }
    const byDay = new Map(days.map((k) => [k, { handled: 0, talk: 0, talkN: 0, csat: 0, csatN: 0 }]));
    for (const r of rows) {
      const g = byDay.get(dayKey(r.created_at));
      if (!g) continue;
      if (r.assigned_at || r.ended_at) g.handled += 1;
      if (r.talk_sec) {
        g.talk += r.talk_sec;
        g.talkN += 1;
      }
    }
    for (const r of csat) {
      const g = byDay.get(dayKey(r.created_at));
      if (!g) continue;
      g.csat += r.rating;
      g.csatN += 1;
    }
    const unit = metric === 'csat' || metric === 'quality' ? (metric === 'csat' ? '%' : '分') : metric === 'handled' ? '通' : '秒';
    const points = days.map((day) => {
      const g = byDay.get(day)!;
      let value = 0;
      if (metric === 'csat') value = g.csatN ? Math.round((g.csat / g.csatN / 5) * 1000) / 10 : 0;
      else if (metric === 'quality') value = g.csatN ? Math.round((g.csat / g.csatN) * 10) / 10 : 0;
      else if (metric === 'handled') value = g.handled;
      else value = g.talkN ? Math.round(g.talk / g.talkN) : 0;
      return { day, value };
    });
    return reply.send({ metric, unit, period: label, points });
  });

  fastify.get('/api/performance/calibration-queue', auth, async (_req, reply) => {
    return reply.send({ items: [] });
  });

  fastify.get('/api/performance/periods', auth, async (_req, reply) => {
    const now = new Date();
    const items = [0, 1, 2].map((offset) => {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return {
        id,
        label: id,
        start: dayKey(d),
        end: dayKey(end),
        status: offset === 0 ? '进行中' : '已结束',
      };
    });
    return reply.send({ items });
  });

  fastify.get('/api/performance/goals', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const period = parseMonthQuery((req.query as { period?: string }).period);
    const items = period ? goals.filter((g) => g.period === period) : goals;
    return reply.send({ items });
  });

  fastify.post('/api/performance/goals', auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as {
      period?: string;
      agent_id?: string;
      kpi_id?: string;
      target_value?: string;
      owner?: string;
    };
    const kpi = KPI_DEFINITIONS.find((k) => k.id === body.kpi_id) || KPI_DEFINITIONS[0];
    const item: Goal = {
      id: `G-${Date.now()}`,
      period: parseMonthQuery(body.period) || monthWindow().label,
      agent_id: String(body.agent_id || ''),
      agent_name: String(body.agent_id || ''),
      kpi_id: kpi.id,
      kpi_name: kpi.name,
      target_value: String(body.target_value || ''),
      owner: String(body.owner || req.currentUser?.name || ''),
    };
    if (item.agent_id) {
      const u = await prisma.users.findFirst({
        where: {
          OR: [
            { uid: item.agent_id },
            { email: item.agent_id },
            ...(Number(item.agent_id) > 0 ? [{ id: Number(item.agent_id) }] : []),
          ],
        },
        select: { name: true },
      });
      if (u?.name) item.agent_name = u.name;
    }
    goals.unshift(item);
    return reply.send({ ok: true, item });
  });
}
