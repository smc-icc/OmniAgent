/**
 * ICC 话务补充指标：响应/等待时长、质检均分、满意度。
 * 库不可达或表结构差异时返回 null，不抛错。
 */
import { confTenancyEnabled } from './conf-tenancy.js';
import { getIccReadPool as getIccMysqlPool } from './icc-tenant-read.js';

function isMissingTable(e: unknown): boolean {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return code === 'ER_NO_SUCH_TABLE' || /doesn't exist|does not exist|Unknown column/i.test(msg);
}

function normalizeWorkNos(workNos: string | string[]): string[] {
  const list = Array.isArray(workNos) ? workNos : [workNos];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const wn = String(raw ?? '').trim();
    if (!wn || seen.has(wn)) continue;
    seen.add(wn);
    out.push(wn);
  }
  return out;
}

function inPlaceholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

function asAvgSeconds(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  // 时长秒数；排除 AVG(datetime) 被当成时间戳的异常值
  if (!Number.isFinite(n) || n < 0 || n > 86400) return null;
  return Math.round(n);
}

/** 多 SQL 变体取第一个有效均秒；工号占位与 avgIccQualityScore 一致（WorkNO + AgentName/AgentID）。 */
async function avgIccSeconds(
  workNo: string | string[],
  from: Date,
  to: Date,
  queries: string[],
  logLabel: string,
): Promise<number | null> {
  const wns = normalizeWorkNos(workNo);
  if (!wns.length) return null;
  const p = await getIccMysqlPool();
  if (!p) return null;

  for (const sql of queries) {
    try {
      const [rows] = await p.query(sql, [...wns, ...wns, from, to]);
      const avg = (rows as Array<{ avg_sec?: number | string | null }>)[0]?.avg_sec;
      const n = asAvgSeconds(avg);
      if (n != null) return n;
    } catch (e) {
      if (!isMissingTable(e)) {
        console.error(`[icc-metrics] ${logLabel} failed`, e);
      }
    }
  }
  return null;
}

/**
 * 平均响应时长（秒）：已接听通话的振铃时长。
 * 优先 t_icc_ag_call_record.RingTime / RingTimeLong，失败回退 t_icc_ag_route_log.RingTimeLong。
 */
export async function avgIccResponseSec(
  workNo: string | string[],
  from: Date,
  to: Date,
): Promise<number | null> {
  const wns = normalizeWorkNos(workNo);
  if (!wns.length) return null;
  const ph = inPlaceholders(wns.length);
  const agentFilter = `(WorkNO IN (${ph}) OR AgentName IN (${ph}))`;
  const agentFilterId = `(WorkNO IN (${ph}) OR AgentID IN (${ph}))`;
  return avgIccSeconds(
    workNo,
    from,
    to,
    [
      `SELECT AVG(RingTime) AS avg_sec FROM t_icc_ag_call_record
       WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?
         AND AnswerTime IS NOT NULL AND RingTime > 0`,
      `SELECT AVG(RingTimeLong) AS avg_sec FROM t_icc_ag_call_record
       WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?
         AND AnswerTime IS NOT NULL AND RingTimeLong > 0`,
      `SELECT AVG(RingTimeLong) AS avg_sec FROM t_icc_ag_route_log
       WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?
         AND AnswerTime IS NOT NULL AND RingTimeLong > 0`,
      `SELECT AVG(RingTimeLong) AS avg_sec FROM t_icc_ag_route_log
       WHERE ${agentFilterId} AND BeginTime >= ? AND BeginTime < ?
         AND AnswerTime IS NOT NULL AND RingTimeLong > 0`,
    ],
    'avgIccResponseSec',
  );
}

/**
 * 平均客户等待时长（秒）：排队入队到坐席应答。
 * 优先 call_record.BeginQueueTime→AnswerTime，失败回退 route_log.EnterACDTime→AnswerTime。
 */
export async function avgIccQueueWaitSec(
  workNo: string | string[],
  from: Date,
  to: Date,
): Promise<number | null> {
  const wns = normalizeWorkNos(workNo);
  if (!wns.length) return null;
  const ph = inPlaceholders(wns.length);
  const agentFilter = `(WorkNO IN (${ph}) OR AgentName IN (${ph}))`;
  const agentFilterId = `(WorkNO IN (${ph}) OR AgentID IN (${ph}))`;
  return avgIccSeconds(
    workNo,
    from,
    to,
    [
      `SELECT AVG(TIMESTAMPDIFF(SECOND, BeginQueueTime, AnswerTime)) AS avg_sec
       FROM t_icc_ag_call_record
       WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?
         AND BeginQueueTime IS NOT NULL AND BeginQueueTime > '1970-01-01'
         AND AnswerTime IS NOT NULL
         AND TIMESTAMPDIFF(SECOND, BeginQueueTime, AnswerTime) >= 0`,
      `SELECT AVG(TIMESTAMPDIFF(SECOND, EnterACDTime, AnswerTime)) AS avg_sec
       FROM t_icc_ag_call_record
       WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?
         AND EnterACDTime IS NOT NULL AND AnswerTime IS NOT NULL
         AND TIMESTAMPDIFF(SECOND, EnterACDTime, AnswerTime) >= 0`,
      `SELECT AVG(TIMESTAMPDIFF(SECOND, EnterACDTime, AnswerTime)) AS avg_sec
       FROM t_icc_ag_route_log
       WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?
         AND EnterACDTime IS NOT NULL AND AnswerTime IS NOT NULL
         AND TIMESTAMPDIFF(SECOND, EnterACDTime, AnswerTime) >= 0`,
      `SELECT AVG(TIMESTAMPDIFF(SECOND, EnterACDTime, AnswerTime)) AS avg_sec
       FROM t_icc_ag_route_log
       WHERE ${agentFilterId} AND BeginTime >= ? AND BeginTime < ?
         AND EnterACDTime IS NOT NULL AND AnswerTime IS NOT NULL
         AND TIMESTAMPDIFF(SECOND, EnterACDTime, AnswerTime) >= 0`,
    ],
    'avgIccQueueWaitSec',
  );
}

/** 时间窗内话单条数（含未接）；表不存在则试下一变体，都失败返回 0。 */
export async function countIccCalls(
  workNo: string | string[],
  from: Date,
  to: Date,
): Promise<number> {
  const wns = normalizeWorkNos(workNo);
  if (!wns.length) return 0;
  const p = await getIccMysqlPool();
  if (!p) return 0;
  const ph = inPlaceholders(wns.length);
  const agentFilter = `(WorkNO IN (${ph}) OR AgentName IN (${ph}))`;
  const queries = [
    `SELECT COUNT(*) AS cnt FROM t_icc_ag_call_record
     WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?`,
    `SELECT COUNT(*) AS cnt FROM t_icc_ag_route_log
     WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?`,
  ];
  for (const sql of queries) {
    try {
      const [rows] = await p.query(sql, [...wns, ...wns, from, to]);
      const n = Number((rows as Array<{ cnt?: number | string }>)[0]?.cnt ?? 0);
      if (Number.isFinite(n)) return n;
    } catch (e) {
      if (!isMissingTable(e)) {
        console.error('[icc-metrics] countIccCalls failed', e);
      }
    }
  }
  return 0;
}

/** 按自然日（话单 BeginTime 原值）聚合电话接通量，供渠道图时间轴。 */
export async function listIccCallCountsByDay(
  workNo: string | string[],
  from: Date,
  to: Date,
): Promise<Array<{ date: string; count: number }>> {
  const wns = normalizeWorkNos(workNo);
  if (!wns.length) return [];
  const p = await getIccMysqlPool();
  if (!p) return [];
  const ph = inPlaceholders(wns.length);
  const agentFilter = `(WorkNO IN (${ph}) OR AgentName IN (${ph}))`;
  const queries = [
    `SELECT DATE_FORMAT(BeginTime, '%Y-%m-%d') AS d, COUNT(*) AS cnt
     FROM t_icc_ag_call_record
     WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?
     GROUP BY DATE_FORMAT(BeginTime, '%Y-%m-%d')`,
    `SELECT DATE_FORMAT(BeginTime, '%Y-%m-%d') AS d, COUNT(*) AS cnt
     FROM t_icc_ag_route_log
     WHERE ${agentFilter} AND BeginTime >= ? AND BeginTime < ?
     GROUP BY DATE_FORMAT(BeginTime, '%Y-%m-%d')`,
  ];
  for (const sql of queries) {
    try {
      const [rows] = await p.query(sql, [...wns, ...wns, from, to]);
      return (rows as Array<{ d?: string; cnt?: number | string }>).map((r) => ({
        date: String(r.d ?? ''),
        count: Number(r.cnt ?? 0) || 0,
      })).filter((r) => r.date);
    } catch (e) {
      if (!isMissingTable(e)) {
        console.error('[icc-metrics] listIccCallCountsByDay failed', e);
      }
    }
  }
  return [];
}

/**
 * 满意度百分比：Satisficing>0 中 1/2 视为满意（与 ICC 统计口径接近）。
 * 支持单工号或 account 内多工号聚合；无有效评价返回 null。
 */
export async function avgIccSatisfactionPct(
  workNo: string | string[],
  from: Date,
  to: Date,
): Promise<number | null> {
  const wns = normalizeWorkNos(workNo);
  if (!wns.length) return null;
  const p = await getIccMysqlPool();
  if (!p) return null;

  const ph = inPlaceholders(wns.length);
  try {
    const [rows] = await p.query(
      `SELECT
         SUM(CASE WHEN Satisficing IN (1, 2) THEN 1 ELSE 0 END) AS good_cnt,
         SUM(CASE WHEN Satisficing > 0 THEN 1 ELSE 0 END) AS total_cnt
       FROM t_icc_ag_call_record
       WHERE (WorkNO IN (${ph}) OR AgentName IN (${ph}))
         AND EndTime >= ? AND EndTime < ?
         AND Satisficing IS NOT NULL`,
      [...wns, ...wns, from, to],
    );
    const row = (rows as Array<{ good_cnt?: number; total_cnt?: number }>)[0];
    const total = Number(row?.total_cnt ?? 0);
    if (!total) return null;
    const good = Number(row?.good_cnt ?? 0);
    return Math.round((good / total) * 1000) / 10;
  } catch (e) {
    if (!isMissingTable(e)) {
      console.error('[icc-metrics] avgIccSatisfactionPct failed', e);
    }
    return null;
  }
}

/** 按主叫/被叫查最近话单摘要（客户画像用）。 */
export async function listRecentCallsByPhone(
  phone: string,
  limit = 10,
): Promise<
  Array<{
    begin_time: string;
    end_time: string;
    caller: string;
    called: string;
    talk_sec: number;
    work_no: string;
    satisficing: number | null;
  }>
> {
  const ph = String(phone ?? '').trim();
  if (!ph) return [];
  const p = await getIccMysqlPool();
  if (!p) return [];
  try {
    const [rows] = await p.query(
      `SELECT
         DATE_FORMAT(BeginTime, '%Y-%m-%d %H:%i:%s') AS begin_time,
         DATE_FORMAT(EndTime, '%Y-%m-%d %H:%i:%s') AS end_time,
         IFNULL(Caller, '') AS caller,
         IFNULL(Called, '') AS called,
         IFNULL(TalkTime, 0) AS talk_sec,
         IFNULL(WorkNO, '') AS work_no,
         Satisficing AS satisficing
       FROM t_icc_ag_call_record
       WHERE Caller = ? OR Called = ?
       ORDER BY BeginTime DESC
       LIMIT ?`,
      [ph, ph, limit],
    );
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      begin_time: String(r.begin_time ?? ''),
      end_time: String(r.end_time ?? ''),
      caller: String(r.caller ?? ''),
      called: String(r.called ?? ''),
      talk_sec: Number(r.talk_sec ?? 0),
      work_no: String(r.work_no ?? ''),
      satisficing: r.satisficing == null ? null : Number(r.satisficing),
    }));
  } catch (e) {
    if (!isMissingTable(e)) {
      console.error('[icc-metrics] listRecentCallsByPhone failed', e);
    }
    return [];
  }
}

/** Omni 改密后尽力同步 ICC 明文口令（失败仅打日志）。 */
export async function trySyncIccPassword(workNo: string, plainPassword: string): Promise<void> {
  if (confTenancyEnabled()) return; // Managed passwords are owned by ConfManager; never use legacy Name/ID updates.
  const wn = String(workNo ?? '').trim();
  if (!wn || !plainPassword) return;
  const p = await getIccMysqlPool();
  if (!p) return;
  try {
    await p.query('UPDATE t_user_users SET PassWord = ? WHERE Name = ? OR ID = ? LIMIT 1', [
      plainPassword,
      wn,
      wn,
    ]);
  } catch (e) {
    console.error('[icc-metrics] trySyncIccPassword failed', e);
  }
}
