import { describe, expect, it } from 'vitest';
import { evaluateCutover } from '../integrations/hub/standalone/cutover-check.js';
import { evaluateE2e } from '../integrations/hub/standalone/e2e-check.js';
import { parseVdnAllowlist, vdnAllowed } from '../integrations/hub/config/vdn-allowlist.js';
import { archiveOutbox, deliveriesReadyToArchive, shouldRunDailyArchive, shouldRunDailyAt, previousYmd } from '../integrations/hub/admin/archive.js';
import {
  buildBinlogDumpPacket,
  COM_BINLOG_DUMP,
  encodeEvent,
  encodeMysqlValue,
  encodeRowsBody,
  encodeTableMapBody,
  EventType,
  MysqlType,
  parseBinlogEvent,
  parseDumpPayload,
  rowsEventToChanges,
  wrapMysqlPacket,
  writeLenenc,
  type TableMap,
} from '../integrations/hub/ingest/cdc-binlog-parse.js';
import { ensureTraceId } from '../integrations/hub/observability/tracing.js';
import { createHubMetrics, prometheusText } from '../integrations/hub/observability/metrics.js';
import { createMemoryHubStore } from '../integrations/hub/store/memory.js';
import type { OutboxDb, OutboxExec, OutboxRow } from '../integrations/hub/ingest/outbox.source.js';
import type { BusinessEvent } from '../integrations/hub/contract/event.js';
import { EventTypes } from '../integrations/hub/contract/event-types.js';

function sampleEvent(id: string): BusinessEvent {
  return {
    eventId: id,
    eventType: EventTypes.CALL_ENDED,
    eventVersion: 1,
    occurredAt: '2026-08-26T03:00:00.000Z',
    source: { system: 'icc', component: 'ccs' },
    tenant: { vdnId: 1 },
    subject: { type: 'call', id: '1' },
    partitionKey: 'call:1',
    payload: {},
  };
}

describe('outbox archive', () => {
  it('only archives when every delivery is succeeded', () => {
    expect(deliveriesReadyToArchive([])).toBe(false);
    expect(deliveriesReadyToArchive([{ eventId: 'a', sink: 'log', status: 'succeeded', attempts: 1 }])).toBe(true);
    expect(deliveriesReadyToArchive([
      { eventId: 'a', sink: 'log', status: 'succeeded', attempts: 1 },
      { eventId: 'a', sink: 'pg', status: 'dlq', attempts: 8 },
    ])).toBe(false);
    expect(deliveriesReadyToArchive([{ eventId: 'a', sink: 'log', status: 'pending', attempts: 1 }])).toBe(false);
  });

  it('runs once in the local 03:00 window', () => {
    const now = new Date(2026, 7, 26, 3, 4, 0);
    expect(shouldRunDailyArchive(now, 3, null)).toBe(true);
    expect(shouldRunDailyArchive(now, 3, '2026-08-26')).toBe(false);
    expect(shouldRunDailyArchive(new Date(2026, 7, 26, 3, 15, 0), 3, null)).toBe(false);
    expect(shouldRunDailyArchive(new Date(2026, 7, 26, 4, 0, 0), 3, null)).toBe(false);
  });

  it('reconcile window is 03:30 local and previousYmd is yesterday', () => {
    expect(shouldRunDailyAt(new Date(2026, 7, 26, 3, 30, 0), 3, 30, null)).toBe(true);
    expect(shouldRunDailyAt(new Date(2026, 7, 26, 3, 4, 0), 3, 30, null)).toBe(false);
    expect(previousYmd(new Date(2026, 7, 26, 3, 30, 0))).toBe('2026-08-25');
  });

  it('moves succeeded rows and never deletes pending/dlq', async () => {
    const store = createMemoryHubStore();
    await store.upsertDelivery({ eventId: 'ok-1', sink: 'log', status: 'succeeded', attempts: 1 });
    await store.upsertDelivery({ eventId: 'dlq-1', sink: 'log', status: 'dlq', attempts: 8 });
    const rows: OutboxRow[] = [
      { ID: 1, EventId: 'ok-1', EventType: 'icc.call.ended', EventVersion: 1, AggregateType: 'call', AggregateId: '1', PartitionKey: 'call:1', VdnId: 1, SourceComponent: 'ccs', Payload: {}, OccurredAt: new Date(), CreateTime: new Date(), ConsumedAt: new Date() },
      { ID: 2, EventId: 'dlq-1', EventType: 'icc.call.ended', EventVersion: 1, AggregateType: 'call', AggregateId: '2', PartitionKey: 'call:2', VdnId: 1, SourceComponent: 'ccs', Payload: {}, OccurredAt: new Date(), CreateTime: new Date(), ConsumedAt: new Date() },
      { ID: 3, EventId: 'none-1', EventType: 'icc.call.ended', EventVersion: 1, AggregateType: 'call', AggregateId: '3', PartitionKey: 'call:3', VdnId: 1, SourceComponent: 'ccs', Payload: {}, OccurredAt: new Date(), CreateTime: new Date(), ConsumedAt: new Date() },
    ];
    const deleted: unknown[] = [];
    let scanned = 0;
    const exec: OutboxExec = {
      async query<T>(_sql: string, _params: unknown[]) {
        scanned += 1;
        if (scanned > 1) return [] as T[];
        return rows as T[];
      },
      async execute(sql, params) {
        if (sql.includes('DELETE FROM t_icc_outbox_event ') && !sql.includes('archive')) {
          deleted.push(params[0]);
        }
        return 1;
      },
    };
    const db: OutboxDb = {
      query: exec.query,
      execute: exec.execute,
      async version() { return '8.0.36'; },
      async withTransaction(fn) { return fn(exec); },
    };
    const report = await archiveOutbox({ db, store, retentionDays: 7, batchSize: 50 });
    expect(deleted).toEqual([1]);
    expect(report.archived).toBe(1);
    expect(report.skippedNotSucceeded).toBe(1);
    expect(report.skippedNoDelivery).toBe(1);
  });
});

describe('binlog parser', () => {
  it('builds COM_BINLOG_DUMP packet', () => {
    const pkt = buildBinlogDumpPacket({ file: 'mysql-bin.000001', pos: 4, serverId: 65535 });
    expect(pkt[4]).toBe(COM_BINLOG_DUMP);
    expect(pkt.readUInt32LE(5)).toBe(4);
    expect(pkt.readUInt32LE(11)).toBe(65535);
    expect(pkt.subarray(15).toString('utf8')).toBe('mysql-bin.000001');
  });

  it('round-trips TABLE_MAP + WRITE_ROWS into CdcChange', () => {
    const types = [MysqlType.LONG, MysqlType.VARCHAR];
    const metadata = Buffer.from([64, 0]);
    const mapBody = encodeTableMapBody({
      tableId: 42,
      schema: 'icc',
      table: 't_icc_base_leaveword',
      types,
      metadata,
      columnNames: ['ID', 'Caller'],
    });
    const mapEv = encodeEvent(EventType.TABLE_MAP, mapBody, { nextPos: 120, timestamp: 1_700_000_000 });
    const tableMaps = new Map<string, TableMap>();
    const parsedMap = parseBinlogEvent(mapEv, { tableMaps });
    expect(parsedMap.tableMap?.table).toBe('t_icc_base_leaveword');
    expect(parsedMap.tableMap?.columnNames).toEqual(['ID', 'Caller']);

    const rowBody = encodeRowsBody({
      tableId: 42,
      v2: true,
      columnCount: 2,
      images: [{
        values: [
          encodeMysqlValue(MysqlType.LONG, 9),
          encodeMysqlValue(MysqlType.VARCHAR, '13800138000', metadata),
        ],
      }],
    });
    const rowEv = encodeEvent(EventType.WRITE_ROWS, rowBody, { nextPos: 240, timestamp: 1_700_000_000 });
    const parsedRows = parseBinlogEvent(rowEv, { tableMaps });
    const changes = rowsEventToChanges(parsedRows, tableMaps, { file: 'mysql-bin.000001', pos: 240 });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.op).toBe('insert');
    expect(changes[0]?.table).toBe('t_icc_base_leaveword');
    expect(changes[0]?.after).toEqual({ ID: 9, Caller: '13800138000' });
  });

  it('parses dump payload OK-wrapped events', () => {
    const body = encodeTableMapBody({
      tableId: 1,
      schema: 'icc',
      table: 't',
      types: [MysqlType.LONG],
    });
    const ev = encodeEvent(EventType.TABLE_MAP, body);
    const packet = wrapMysqlPacket(Buffer.concat([Buffer.from([0x00]), ev]));
    const len = packet[0]! | (packet[1]! << 8) | (packet[2]! << 16);
    const payload = packet.subarray(4, 4 + len);
    const state = { checksumBytes: 0, tableMaps: new Map<string, TableMap>() };
    const parsed = parseDumpPayload(payload, state);
    expect(parsed && !('error' in parsed) && parsed.tableMap?.table).toBe('t');
  });

  it('encodes lenenc integers', () => {
    expect(writeLenenc(20)[0]).toBe(20);
    expect(writeLenenc(300)[0]).toBe(0xfc);
  });
});

describe('tracing / metrics / cutover', () => {
  it('ensureTraceId keeps existing and fills from eventId', () => {
    const a = sampleEvent('evt-a');
    expect(ensureTraceId(a)).toBe('evt-a');
    expect(a.trace?.traceId).toBe('evt-a');
    a.trace = { traceId: 'keep-me' };
    expect(ensureTraceId(a)).toBe('keep-me');
  });

  it('exposes p50/p99 and circuit in prometheus text', () => {
    const m = createHubMetrics();
    m.observeLatency(10);
    m.observeLatency(20);
    m.observeLatency(100);
    m.setCircuitOpenCount(1);
    const snap = m.snapshot();
    expect(snap.latencyP50Ms).toBeGreaterThan(0);
    expect(snap.latencyP99Ms).toBeGreaterThanOrEqual(snap.latencyP50Ms);
    const text = prometheusText(snap);
    expect(text).toContain('hub_latency_p50_ms');
    expect(text).toContain('hub_latency_p99_ms');
    expect(text).toContain('hub_circuit_open_count 1');
  });

  it('cutover dry-run never implies APPLY and flags missing ConsumedAt', () => {
    const report = evaluateCutover({
      env: { HUB_ENABLED: '0', CCS_OUTBOX_ENABLED: '0', IVR_OUTBOX_ENABLED: '0' },
      apply: false,
      mysql: { reachable: true, version: '8.0.36', outbox: true, archive: true, consumedAt: false },
    });
    expect(report.apply).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.actions.some((a) => a.includes('HUB_CUTOVER_APPLY=1'))).toBe(true);
    expect(report.actions.some((a) => a.startsWith('APPLY:'))).toBe(false);
  });

  it('vdn allowlist: empty=all, list=only those ids', () => {
    expect(parseVdnAllowlist(undefined)).toBeNull();
    expect(parseVdnAllowlist('12, 34')).toEqual([12, 34]);
    expect(vdnAllowed(12, undefined)).toBe(true);
    expect(vdnAllowed(12, '12,34')).toBe(true);
    expect(vdnAllowed(99, '12,34')).toBe(false);
    expect(vdnAllowed(1, 'abc')).toBe(false);
  });

  it('e2e grayscale requires allowlist and recent voicemail', () => {
    const bad = evaluateE2e({
      testVdn: 12,
      minutes: 30,
      env: { IVR_OUTBOX_ENABLED: '1', CCS_OUTBOX_ENABLED: '1' },
      ivrEnabled: true,
      ccsEnabled: true,
      ivrAllowsTestVdn: true,
      ccsAllowsTestVdn: true,
      mysql: { reachable: true, voicemail: 0, callEnded: 1, agentState: 0, agentLeg: 0 },
    });
    expect(bad.ok).toBe(false);
    expect(bad.findings.some((f) => f.includes('全部 VDN'))).toBe(true);
    const good = evaluateE2e({
      testVdn: 12,
      minutes: 30,
      env: { IVR_OUTBOX_ENABLED: '1', IVR_OUTBOX_VDNS: '12', CCS_OUTBOX_ENABLED: '1', CCS_OUTBOX_VDNS: '12' },
      ivrEnabled: true,
      ccsEnabled: true,
      ivrAllowsTestVdn: true,
      ccsAllowsTestVdn: true,
      mysql: { reachable: true, voicemail: 1, callEnded: 1, agentState: 0, agentLeg: 1 },
      postgres: { reachable: true, succeeded: 2 },
      health: { ok: true, status: 200 },
    });
    expect(good.ok).toBe(true);
  });
});
