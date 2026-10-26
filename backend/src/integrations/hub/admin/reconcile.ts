import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { isBusinessEvent, type BusinessEvent } from '../contract/event.js';
import { EventTypes } from '../contract/event-types.js';
import type { OutboxExec } from '../ingest/outbox.source.js';
import type { HubLogger } from '../sinks/sink.js';
import type { HubStore } from '../store/memory.js';

export function uuidFromKey(key: string): string {
  const b = createHash('sha1').update(key).digest();
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface ReconcileBucket {
  src: number;
  dst: number;
  missing: number;
}

export interface ReconcileReport {
  day: string;
  leaveword: ReconcileBucket;
  callLog: ReconcileBucket;
  agRoute: ReconcileBucket;
  stateTrk: ReconcileBucket;
  login: ReconcileBucket;
  cdr: ReconcileBucket;
  acdRoute: ReconcileBucket;
  ivrRoute: ReconcileBucket;
  ivrTrace: ReconcileBucket;
  dlqInserted: number;
}

function dayBounds(day: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`非法日期: ${day}`);
  return { start: `${day} 00:00:00`, end: `${day} 23:59:59.999` };
}

export async function reconcileDay(opts: {
  mysql: OutboxExec;
  store: HubStore;
  prisma?: PrismaClient;
  day: string;
  sink?: string;
  vdnIds?: number[];
  log?: HubLogger;
}): Promise<ReconcileReport> {
  const { start, end } = dayBounds(opts.day);
  const sink = opts.sink ?? 'omni_pg';
  const vdnIds = (opts.vdnIds ?? []).filter((n) => Number.isInteger(n) && n >= 0);
  const vdnClause = vdnIds.length
    ? ` AND VDNId IN (${vdnIds.map(() => '?').join(',')})`
    : '';
  const bounds = [start, end, ...vdnIds];
  const srcRows = await opts.mysql.query<{ Id: unknown; ID?: unknown; Caller?: unknown; LeaveWordFile?: unknown; VDNId?: unknown }>(
    `SELECT Id, Caller, LeaveWordFile, VDNId, BeginTime FROM t_icc_base_leaveword
     WHERE BeginTime >= ? AND BeginTime <= ?${vdnClause}`,
    bounds,
  );
  const srcIds = srcRows.map((r) => String(r.Id ?? r.ID ?? '')).filter(Boolean);
  let dstSubjects = new Set<string>();
  if (opts.prisma) {
    const dst = await opts.prisma.icc_voicemails.findMany({
      where: {
        occurred_at: { gte: new Date(start), lte: new Date(end) },
        ...(vdnIds.length ? { vdn_id: { in: vdnIds } } : {}),
      },
      select: { source_event_subject: true },
    });
    dstSubjects = new Set(dst.map((d) => d.source_event_subject));
  }
  let missing = 0;
  let dlqInserted = 0;
  for (const row of srcRows) {
    const id = String(row.Id ?? row.ID ?? '');
    if (!id) continue;
    if (dstSubjects.has(id) || dstSubjects.has(`voicemail:${id}`)) continue;
    missing += 1;
    const event: BusinessEvent = {
      eventId: uuidFromKey(`reconcile:leaveword:${id}:${opts.day}`),
      eventType: EventTypes.VOICEMAIL_CREATED,
      eventVersion: 1,
      occurredAt: new Date(start).toISOString(),
      source: { system: 'icc', component: 'hub' },
      tenant: { vdnId: Number(row.VDNId ?? 0) || 0 },
      subject: { type: 'voicemail', id },
      partitionKey: `voicemail:${id}`,
      payload: {
        leavewordId: id,
        callerNumber: row.Caller ?? null,
        fileName: row.LeaveWordFile ?? null,
        vdnId: row.VDNId ?? 0,
        reconcile: true,
      },
    };
    if (!isBusinessEvent(event)) continue;
    await opts.store.insertDlq({
      eventId: event.eventId,
      sink,
      event,
      error: 'reconcile-missing',
    });
    dlqInserted += 1;
  }

  const callVdn = vdnIds.length
    ? ` AND VDNID IN (${vdnIds.map(() => '?').join(',')})`
    : '';
  const callBounds = [start, end, ...vdnIds];
  const mysqlCallPids = await opts.mysql.query<{ PID?: unknown; pid?: unknown }>(
    `SELECT PID FROM t_icc_base_call_log WHERE BeginTime >= ? AND BeginTime <= ?${callVdn}`,
    callBounds,
  );
  const mysqlAgPids = await opts.mysql.query<{ PID?: unknown; pid?: unknown }>(
    `SELECT PID FROM t_icc_ag_route_log WHERE CreateCallTime >= ? AND CreateCallTime <= ?${callVdn}`,
    callBounds,
  );

  async function pgPidSet(sql: string, params: unknown[] = [start, end, ...vdnIds]): Promise<Set<string> | null> {
    if (!opts.prisma) return null;
    try {
      const rows = await opts.prisma.$queryRawUnsafe<Array<{ pid: unknown }>>(sql, ...params);
      return new Set(rows.map((r) => String(r.pid ?? '')).filter(Boolean));
    } catch {
      return null;
    }
  }

  const vdnPg = vdnIds.length
    ? ` AND vdnid IN (${vdnIds.map((_, i) => `$${i + 3}`).join(',')})`
    : '';
  const pgCall = await pgPidSet(
    `SELECT pid::text AS pid FROM icc.t_icc_base_call_log
     WHERE begintime >= $1::timestamp AND begintime <= $2::timestamp${vdnPg}`,
  );
  const pgAg = await pgPidSet(
    `SELECT pid::text AS pid FROM icc.t_icc_ag_route_log
     WHERE createcalltime >= $1::timestamp AND createcalltime <= $2::timestamp${vdnPg}`,
  );

  async function enqueueMissing(
    srcPids: string[],
    dst: Set<string> | null,
    eventType: string,
    factSink: string,
    subjectType: string,
  ): Promise<{ dst: number; missing: number }> {
    if (!dst) return { dst: 0, missing: 0 };
    let miss = 0;
    for (const pid of srcPids) {
      if (dst.has(pid)) continue;
      miss += 1;
      const event: BusinessEvent = {
        eventId: uuidFromKey(`reconcile:${subjectType}:${pid}:${opts.day}`),
        eventType,
        eventVersion: 1,
        occurredAt: new Date(start).toISOString(),
        source: { system: 'icc', component: 'hub' },
        tenant: { vdnId: vdnIds[0] ?? 0 },
        subject: { type: subjectType, id: pid },
        partitionKey: `${subjectType}:${pid}`,
        payload: { pid, reconcile: true },
      };
      if (!isBusinessEvent(event)) continue;
      await opts.store.insertDlq({
        eventId: event.eventId,
        sink: factSink,
        event,
        error: 'reconcile-missing',
      });
      dlqInserted += 1;
    }
    return { dst: dst.size, missing: miss };
  }

  const callSrc = mysqlCallPids.map((r) => String(r.PID ?? r.pid ?? '')).filter(Boolean);
  const agSrc = mysqlAgPids.map((r) => String(r.PID ?? r.pid ?? '')).filter(Boolean);
  const callCmp = await enqueueMissing(callSrc, pgCall, EventTypes.CALL_ENDED, 'icc_call_log', 'call');
  const agCmp = await enqueueMissing(agSrc, pgAg, EventTypes.AGENT_LEG_ENDED, 'icc_ag_route', 'agent_leg');

  async function countOnly(
    mysqlSql: string,
    pgSql: string,
    mysqlParams: unknown[],
    pgParams: unknown[],
  ): Promise<ReconcileBucket> {
    const srcRows = await opts.mysql.query<Record<string, unknown>>(mysqlSql, mysqlParams);
    const src = srcRows
      .map((r) => String(r.pid ?? r.PID ?? r.id ?? r.ID ?? ''))
      .filter(Boolean);
    const dst = await pgPidSet(pgSql, pgParams);
    if (!dst) return { src: src.length, dst: 0, missing: 0 };
    let missing = 0;
    for (const id of src) if (!dst.has(id)) missing += 1;
    return { src: src.length, dst: dst.size, missing };
  }

  const dayParams = [start, end];
  const vdnParams = [start, end, ...vdnIds];
  const stateTrk = await countOnly(
    `SELECT ID FROM t_icc_ag_state_trk_record WHERE BeginTime >= ? AND BeginTime <= ?${callVdn}`,
    `SELECT id::text AS pid FROM icc.t_icc_ag_state_trk_record
     WHERE begintime >= $1::timestamp AND begintime <= $2::timestamp${vdnPg}`,
    vdnParams,
    vdnParams,
  );
  const login = await countOnly(
    `SELECT PID FROM t_icc_ag_login_log WHERE LoginTime >= ? AND LoginTime <= ?${callVdn}`,
    `SELECT pid::text AS pid FROM icc.t_icc_ag_login_log
     WHERE logintime >= $1::timestamp AND logintime <= $2::timestamp${vdnPg}`,
    vdnParams,
    vdnParams,
  );
  const cdr = await countOnly(
    `SELECT ID FROM t_icc_base_cdr WHERE InitializeTime >= ? AND InitializeTime <= ?`,
    `SELECT id::text AS pid FROM icc.t_icc_base_cdr
     WHERE initializetime >= $1::timestamp AND initializetime <= $2::timestamp`,
    dayParams,
    dayParams,
  );
  const acdRoute = await countOnly(
    `SELECT PID FROM t_icc_acd_route_log WHERE BeginTime >= ? AND BeginTime <= ?${callVdn}`,
    `SELECT pid::text AS pid FROM icc.t_icc_acd_route_log
     WHERE begintime >= $1::timestamp AND begintime <= $2::timestamp${vdnPg}`,
    vdnParams,
    vdnParams,
  );
  const ivrRoute = await countOnly(
    `SELECT PID FROM t_icc_ivr_route_log WHERE BeginTime >= ? AND BeginTime <= ?${callVdn}`,
    `SELECT pid::text AS pid FROM icc.t_icc_ivr_route_log
     WHERE begintime >= $1::timestamp AND begintime <= $2::timestamp${vdnPg}`,
    vdnParams,
    vdnParams,
  );
  const ivrTrace = await countOnly(
    `SELECT PID FROM t_icc_ivr_trace_log WHERE BeginTime >= ? AND BeginTime <= ?`,
    `SELECT pid::text AS pid FROM icc.t_icc_ivr_trace_log
     WHERE begintime >= $1::timestamp AND begintime <= $2::timestamp`,
    dayParams,
    dayParams,
  );

  const report: ReconcileReport = {
    day: opts.day,
    leaveword: { src: srcIds.length, dst: dstSubjects.size, missing },
    callLog: { src: callSrc.length, dst: callCmp.dst, missing: callCmp.missing },
    agRoute: { src: agSrc.length, dst: agCmp.dst, missing: agCmp.missing },
    stateTrk,
    login,
    cdr,
    acdRoute,
    ivrRoute,
    ivrTrace,
    dlqInserted,
  };
  opts.log?.warn?.(report, 'hub reconcile');
  return report;
}
