/**
 * 测试 VDN 端到端只读检查。不写业务表、不注入事件。
 *
 *   HUB_TEST_VDN=12 pnpm hub:e2e
 *
 * 期望：该 VDN 近 --minutes 分钟内 outbox 有 voicemail/call.ended，且 hub.delivery 有 succeeded。
 */
import mysql from 'mysql2/promise';
import { vdnAllowed } from '../config/vdn-allowlist.js';

export interface E2eFacts {
  testVdn: number;
  minutes: number;
  env: Record<string, string | undefined>;
  ivrEnabled: boolean;
  ccsEnabled: boolean;
  ivrAllowsTestVdn: boolean;
  ccsAllowsTestVdn: boolean;
  mysql?: {
    reachable: boolean;
    voicemail: number;
    callEnded: number;
    agentState: number;
    agentLeg: number;
  };
  postgres?: { reachable: boolean; succeeded: number };
  health?: { ok: boolean; status: number };
}

export interface E2eReport {
  ok: boolean;
  testVdn: number;
  findings: string[];
  facts: E2eFacts;
}

export function evaluateE2e(facts: E2eFacts): E2eReport {
  const findings: string[] = [];
  if (!facts.ivrEnabled) findings.push('IVR_OUTBOX_ENABLED 未开。');
  else if (!facts.ivrAllowsTestVdn) findings.push(`IVR_OUTBOX_VDNS 不含测试 VDN ${facts.testVdn}。`);
  if (!facts.ccsEnabled) findings.push('CCS_OUTBOX_ENABLED 未开。');
  else if (!facts.ccsAllowsTestVdn) findings.push(`CCS_OUTBOX_VDNS 不含测试 VDN ${facts.testVdn}。`);
  const ivrVdns = facts.env.IVR_OUTBOX_VDNS?.trim();
  const ccsVdns = facts.env.CCS_OUTBOX_VDNS?.trim();
  if (facts.ivrEnabled && !ivrVdns) findings.push('IVR_OUTBOX_ENABLED=1 但未设 IVR_OUTBOX_VDNS：会对全部 VDN 写 outbox。');
  if (facts.ccsEnabled && !ccsVdns) findings.push('CCS_OUTBOX_ENABLED=1 但未设 CCS_OUTBOX_VDNS：会对全部 VDN 写 outbox。');

  if (facts.mysql?.reachable) {
    if (facts.mysql.voicemail === 0) findings.push(`近 ${facts.minutes} 分钟测试 VDN 无 icc.voicemail.created。请在该 VDN 留一条言。`);
    if (facts.mysql.callEnded === 0) findings.push(`近 ${facts.minutes} 分钟测试 VDN 无 icc.call.ended。请在该 VDN 打一通并挂断。`);
    if (facts.mysql.agentLeg === 0) findings.push(`近 ${facts.minutes} 分钟测试 VDN 无 icc.agent.leg_ended（坐席路由段）。请确认已发布含该 outbox 的 CCS。`);
  } else if (facts.mysql) {
    findings.push('MySQL 不可达，无法核对 outbox。');
  }

  if (facts.postgres?.reachable && facts.mysql?.voicemail) {
    if (facts.postgres.succeeded === 0) {
      findings.push('outbox 有留言事件但 hub.delivery 无 succeeded，查 Hub 是否 HUB_ENABLED=1 以及 sink。');
    }
  }

  if (facts.health && !facts.health.ok) {
    findings.push(`health=${facts.health.status}，Hub 未就绪。`);
  }

  const blocking = findings.some((f) =>
    f.includes('未开')
    || f.includes('不含测试 VDN')
    || f.includes('无 icc.voicemail')
    || f.includes('无 succeeded')
    || f.includes('未就绪'),
  );
  return { ok: !blocking, testVdn: facts.testVdn, findings, facts };
}

export async function collectE2eFacts(env: NodeJS.ProcessEnv, minutes = 30): Promise<E2eFacts> {
  const testVdn = Number(env.HUB_TEST_VDN || env.HUB_RECONCILE_VDNS?.split(/[,;]/)[0] || 0);
  const ivrEnabled = ['1', 'true', 'yes', 'on'].includes(String(env.IVR_OUTBOX_ENABLED ?? '0').toLowerCase());
  const ccsEnabled = ['1', 'true', 'yes', 'on'].includes(String(env.CCS_OUTBOX_ENABLED ?? '0').toLowerCase());
  const facts: E2eFacts = {
    testVdn,
    minutes,
    env,
    ivrEnabled,
    ccsEnabled,
    ivrAllowsTestVdn: vdnAllowed(testVdn, env.IVR_OUTBOX_VDNS),
    ccsAllowsTestVdn: vdnAllowed(testVdn, env.CCS_OUTBOX_VDNS),
  };

  if (env.ICC_MYSQL_DISABLED !== '1' && testVdn > 0) {
    try {
      const conn = await mysql.createConnection({
        host: env.ICC_MYSQL_HOST || '127.0.0.1',
        port: Number(env.ICC_MYSQL_PORT || 3306),
        user: env.ICC_MYSQL_USER || 'root',
        password: env.ICC_MYSQL_PASSWORD || '',
        database: env.ICC_MYSQL_DB || 'icc',
        connectTimeout: 5000,
      });
      try {
        const sinceSql = 'CreateTime >= DATE_SUB(NOW(3), INTERVAL ? MINUTE) AND VdnId = ?';
        const count = async (eventType: string) => {
          const [rows] = await conn.query(
            `SELECT COUNT(*) AS n FROM t_icc_outbox_event WHERE EventType = ? AND ${sinceSql}`,
            [eventType, minutes, testVdn],
          );
          return Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
        };
        facts.mysql = {
          reachable: true,
          voicemail: await count('icc.voicemail.created'),
          callEnded: await count('icc.call.ended'),
          agentState: await count('icc.agent.state_changed'),
          agentLeg: await count('icc.agent.leg_ended'),
        };
      } finally {
        await conn.end();
      }
    } catch {
      facts.mysql = { reachable: false, voicemail: 0, callEnded: 0, agentState: 0, agentLeg: 0 };
    }
  }

  if (env.DATABASE_URL && testVdn > 0) {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        await prisma.$connect();
        const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*)::bigint AS n FROM hub.delivery
          WHERE status = 'succeeded' AND updated_at > now() - make_interval(mins => ${minutes})
        `;
        facts.postgres = { reachable: true, succeeded: Number(rows[0]?.n ?? 0) };
      } finally {
        await prisma.$disconnect();
      }
    } catch {
      facts.postgres = { reachable: false, succeeded: 0 };
    }
  }

  const healthUrl = env.HUB_HEALTH_URL;
  if (healthUrl) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      facts.health = { ok: res.ok, status: res.status };
    } catch {
      facts.health = { ok: false, status: 0 };
    }
  }

  return facts;
}

async function main() {
  const minutes = Number(process.env.HUB_E2E_MINUTES || 30);
  const facts = await collectE2eFacts(process.env, minutes);
  if (!facts.testVdn) {
    console.error('请设置 HUB_TEST_VDN（测试 VDN 数字）');
    process.exit(2);
  }
  const report = evaluateE2e(facts);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (process.argv[1]?.includes('e2e-check')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
