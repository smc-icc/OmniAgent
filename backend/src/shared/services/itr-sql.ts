/**
 * ITR SqlExe：仅允许单条 SELECT，禁止写操作与多语句。
 * 实际查询走 ICC MySQL（Omni 连接池），不在 ITR 进程内直连。
 */

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|create|replace|grant|revoke|call|into|outfile|dumpfile|load_file)\b/i;

export function isSafeSelectSql(sql: string): { ok: true; sql: string } | { ok: false; reason: string } {
  const s = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!s) return { ok: false, reason: 'empty' };
  if (s.includes(';')) return { ok: false, reason: 'multi-statement' };
  if (!/^\s*select\b/i.test(s)) return { ok: false, reason: 'not-select' };
  if (FORBIDDEN.test(` ${s} `)) return { ok: false, reason: 'forbidden-token' };
  if (s.length > 4000) return { ok: false, reason: 'too-long' };
  return { ok: true, sql: s };
}

export async function runIccSelect(sql: string): Promise<Record<string, unknown>[]> {
  const check = isSafeSelectSql(sql);
  if (!check.ok) throw new Error(`sql blocked: ${check.reason}`);
  const { getIccMysqlPool } = await import('./icc-groups-dal.js');
  const pool = await getIccMysqlPool();
  if (!pool) throw new Error('icc mysql unavailable');
  const [rows] = await pool.query(
    /\blimit\s+\d+/i.test(check.sql) ? check.sql : `${check.sql} LIMIT 50`,
  );
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[]).slice(0, 50).map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'bigint') out[k] = Number(v);
      else if (v instanceof Date) out[k] = v.toISOString();
      else if (Buffer.isBuffer(v)) out[k] = v.toString('utf8');
      else out[k] = v as unknown;
    }
    return out;
  });
}
