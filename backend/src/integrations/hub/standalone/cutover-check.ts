/**
 * 现网建表与开关校验。默认只读（HUB_CUTOVER_APPLY=0），不会对生产执行 DDL。
 *
 *   pnpm hub:cutover-check
 *   HUB_CUTOVER_APPLY=1 pnpm hub:cutover-check   # 仅在确认窗口执行 outbox DDL
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

export interface CutoverFacts {
  env: Record<string, string | undefined>;
  apply: boolean;
  mysql?: {
    reachable: boolean;
    version?: string;
    outbox: boolean;
    archive: boolean;
    consumedAt: boolean;
  };
  postgres?: { reachable: boolean; hubSchema: boolean; iccSchema: boolean };
  health?: { ok: boolean; status: number };
}

export interface CutoverReport {
  ok: boolean;
  apply: boolean;
  env: Record<string, string>;
  findings: string[];
  actions: string[];
  mysql?: CutoverFacts['mysql'];
  postgres?: CutoverFacts['postgres'];
  health?: CutoverFacts['health'];
}

const WATCHED_ENV = [
  'HUB_ENABLED',
  'HUB_ROLE',
  'HUB_INGEST',
  'HUB_CONFIG_PATH',
  'CCS_OUTBOX_ENABLED',
  'CCS_OUTBOX_VDNS',
  'IVR_OUTBOX_ENABLED',
  'IVR_OUTBOX_VDNS',
  'HUB_TEST_VDN',
  'HUB_RECONCILE_VDNS',
  'HUB_TO_OMNI_SECRET',
  'HUB_CUTOVER_APPLY',
] as const;

export function evaluateCutover(facts: CutoverFacts): CutoverReport {
  const findings: string[] = [];
  const actions: string[] = [];
  const env: Record<string, string> = {};
  for (const k of WATCHED_ENV) {
    env[k] = facts.env[k] ?? '(unset)';
  }

  if ((facts.env.HUB_ENABLED ?? '0') === '1') {
    findings.push('HUB_ENABLED=1：Hub 会启动摄取/投递，确认已灰度。');
  } else {
    findings.push('HUB_ENABLED 未打开（默认 0），零副作用。');
  }
  if ((facts.env.CCS_OUTBOX_ENABLED ?? '0') === '1') {
    findings.push(
      facts.env.CCS_OUTBOX_VDNS
        ? `CCS_OUTBOX_ENABLED=1，VDN 名单 ${facts.env.CCS_OUTBOX_VDNS}`
        : 'CCS_OUTBOX_ENABLED=1 且未设 CCS_OUTBOX_VDNS：将对全部 VDN 写 outbox。灰度请设 CCS_OUTBOX_VDNS。',
    );
  }
  if ((facts.env.IVR_OUTBOX_ENABLED ?? '0') === '1') {
    findings.push(
      facts.env.IVR_OUTBOX_VDNS
        ? `IVR_OUTBOX_ENABLED=1，VDN 名单 ${facts.env.IVR_OUTBOX_VDNS}`
        : 'IVR_OUTBOX_ENABLED=1 且未设 IVR_OUTBOX_VDNS：将对全部 VDN 写 outbox。灰度请设 IVR_OUTBOX_VDNS。',
    );
  }

  if (facts.mysql?.reachable) {
    if (!facts.mysql.outbox) {
      findings.push('MySQL 无 t_icc_outbox_event。');
      actions.push(facts.apply ? 'APPLY: 执行 outbox DDL' : '将 HUB_CUTOVER_APPLY=1 后执行 outbox DDL');
    }
    if (!facts.mysql.archive) {
      findings.push('MySQL 无 t_icc_outbox_event_archive。');
      actions.push(facts.apply ? 'APPLY: 创建 archive 表' : '将 HUB_CUTOVER_APPLY=1 后创建 archive 表');
    }
    if (facts.mysql.outbox && !facts.mysql.consumedAt) {
      findings.push('t_icc_outbox_event 缺 ConsumedAt 列，归档作业无法安全区分已消费行。');
      actions.push(facts.apply ? 'APPLY: ALTER ADD ConsumedAt' : '将 HUB_CUTOVER_APPLY=1 后执行 outbox.alter.consumed.sql');
    }
  }

  if (facts.postgres && !facts.postgres.reachable) {
    findings.push('PostgreSQL 不可达，Hub Store（hub.*）无法确认。');
  } else if (facts.postgres && !facts.postgres.hubSchema) {
    findings.push('PG 无 hub schema / 表，需 prisma migrate。');
  } else if (facts.postgres && facts.postgres.reachable && !facts.postgres.iccSchema) {
    findings.push('PG 无 icc schema（报表镜像表），需 prisma migrate 20260826140000_icc_report_mirror。');
  }

  if (facts.health && !facts.health.ok) {
    findings.push(`GET health 返回 ${facts.health.status}，就绪检查未通过。`);
  }

  const blocking = findings.some((f) =>
    f.includes('无 t_icc_outbox_event')
    || f.includes('缺 ConsumedAt')
    || f.includes('无 hub schema'),
  );
  return {
    ok: !blocking,
    apply: facts.apply,
    env,
    findings,
    actions,
    mysql: facts.mysql,
    postgres: facts.postgres,
    health: facts.health,
  };
}

function sqlDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../sql');
}

function pickOutboxDdl(version: string): string {
  return version.startsWith('5.6') ? 'outbox.mysql56.sql' : 'outbox.mysql.sql';
}

async function tableExists(conn: mysql.Connection, name: string): Promise<boolean> {
  const [rows] = await conn.query(
    `SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
    [name],
  );
  return (rows as unknown[]).length > 0;
}

async function columnExists(conn: mysql.Connection, table: string, column: string): Promise<boolean> {
  const [rows] = await conn.query(
    `SELECT 1 AS ok FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column],
  );
  return (rows as unknown[]).length > 0;
}

async function applyMysqlDdl(conn: mysql.Connection, version: string, needAlter: boolean): Promise<void> {
  const file = join(sqlDir(), pickOutboxDdl(version));
  const sql = readFileSync(file, 'utf8');
  const parts = sql.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('--'));
  for (const stmt of parts) {
    await conn.query(stmt);
  }
  if (needAlter) {
    const outbox = await tableExists(conn, 't_icc_outbox_event');
    const consumed = outbox && await columnExists(conn, 't_icc_outbox_event', 'ConsumedAt');
    if (outbox && !consumed) {
      await conn.query(`ALTER TABLE t_icc_outbox_event
        ADD COLUMN ConsumedAt DATETIME(3) DEFAULT NULL COMMENT '投递完成时间' AFTER ClaimedAt`);
      try {
        await conn.query('ALTER TABLE t_icc_outbox_event ADD KEY idx_consumed (ConsumedAt)');
      } catch { /* 索引可能已存在 */ }
    }
  }
}

export async function collectCutoverFacts(env: NodeJS.ProcessEnv): Promise<CutoverFacts> {
  const apply = env.HUB_CUTOVER_APPLY === '1';
  const facts: CutoverFacts = { env, apply };

  if (env.ICC_MYSQL_DISABLED !== '1') {
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
        const [ver] = await conn.query('SELECT VERSION() AS v');
        const version = String((ver as Array<{ v: string }>)[0]?.v ?? '');
        const outbox = await tableExists(conn, 't_icc_outbox_event');
        const archive = await tableExists(conn, 't_icc_outbox_event_archive');
        const consumedAt = outbox && await columnExists(conn, 't_icc_outbox_event', 'ConsumedAt');
        facts.mysql = { reachable: true, version, outbox, archive, consumedAt };
        if (apply) {
          await applyMysqlDdl(conn, version, outbox && !consumedAt);
          facts.mysql.outbox = await tableExists(conn, 't_icc_outbox_event');
          facts.mysql.archive = await tableExists(conn, 't_icc_outbox_event_archive');
          facts.mysql.consumedAt = await columnExists(conn, 't_icc_outbox_event', 'ConsumedAt');
        }
      } finally {
        await conn.end();
      }
    } catch (err) {
      facts.mysql = {
        reachable: false,
        outbox: false,
        archive: false,
        consumedAt: false,
      };
      facts.env = { ...facts.env, _mysqlError: err instanceof Error ? err.message : String(err) };
    }
  }

  if (env.DATABASE_URL) {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        await prisma.$connect();
        const rows = await prisma.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema = 'hub' AND table_name IN ('ingest_offset','delivery','dlq')
        `;
        const icc = await prisma.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema = 'icc' AND table_name IN (
            't_icc_base_call_log','t_icc_ag_route_log','t_icc_acd_route_log','t_icc_ag_state_trk_record',
            't_icc_ag_login_log','t_icc_base_cdr','t_icc_ivr_route_log','t_icc_ivr_trace_log'
          )
        `;
        facts.postgres = {
          reachable: true,
          hubSchema: Number(rows[0]?.n ?? 0) >= 3,
          iccSchema: Number(icc[0]?.n ?? 0) >= 8,
        };
      } finally {
        await prisma.$disconnect();
      }
    } catch {
      facts.postgres = { reachable: false, hubSchema: false, iccSchema: false };
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
  const facts = await collectCutoverFacts(process.env);
  const report = evaluateCutover(facts);
  console.log(JSON.stringify(report, null, 2));
  if (facts.apply && !report.ok) process.exit(2);
  if (!report.ok) process.exit(1);
}

const isDirect = process.argv[1]?.includes('cutover-check');
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
