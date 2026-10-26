import type { HubCdcConfig, HubCdcTableConfig } from '../config/schema.js';
import type { RawIngestRecord } from './source.js';
import { asPlainRow, rowField } from './ident.js';

export type CdcOp = 'insert' | 'update' | 'delete';

export interface CdcCursor {
  gtid?: string;
  file?: string;
  pos?: number;
  seq?: number;
  tables?: Record<string, string>;
  [k: string]: unknown;
}

export interface CdcChange {
  table: string;
  op: CdcOp;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  cursor: CdcCursor;
  occurredAt?: string | Date;
}

const ROW_ALIASES: Record<string, string> = {
  Caller: 'callerNumber',
  LeaveWordFile: 'fileName',
  VDNId: 'vdnId',
  CallID: 'callId',
  PID: 'pid',
};

export function interpolateTemplate(tpl: string, row: Record<string, unknown>): string {
  return tpl.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) => {
    const v = rowField(row, key);
    return v == null ? '' : String(v);
  });
}

export function mergeCdcCursor(prev: CdcCursor | null | undefined, next: CdcCursor): CdcCursor {
  return {
    ...(prev ?? {}),
    ...next,
    tables: { ...(prev?.tables ?? {}), ...(next.tables ?? {}) },
  };
}

/** 位点 A 是否严格在 B 之后（重启续传用）。 */
export function isCursorAfter(a: CdcCursor, b: CdcCursor): boolean {
  if (a.seq != null && b.seq != null) return a.seq > b.seq;
  if (a.gtid && b.gtid) return a.gtid > b.gtid;
  if (a.file && b.file && a.pos != null && b.pos != null) {
    if (a.file !== b.file) return a.file > b.file;
    return a.pos > b.pos;
  }
  return false;
}

export function cdcEventId(change: CdcChange, subjectId: string): string {
  const c = change.cursor;
  const loc = c.gtid
    ? `gtid:${c.gtid}`
    : c.file != null && c.pos != null
      ? `bin:${c.file}:${c.pos}`
      : c.seq != null
        ? `seq:${c.seq}`
        : `id:${subjectId}`;
  return `cdc:${change.table}:${change.op}:${subjectId}:${loc}`;
}

function eventTypeFor(op: CdcOp, table: HubCdcTableConfig): string | undefined {
  if (op === 'insert') return table.insert;
  if (op === 'update') return table.update;
  return table.delete;
}

function aggregateTypeFromEventType(eventType: string): string {
  const parts = eventType.split('.');
  return parts.length >= 2 ? parts[1]! : eventType;
}

function enrichPayload(row: Record<string, unknown>, eventType: string, subjectId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...row };
  for (const [from, to] of Object.entries(ROW_ALIASES)) {
    const v = rowField(row, from);
    if (v != null && payload[to] == null) payload[to] = v;
  }
  if (eventType.startsWith('icc.voicemail.') && payload.leavewordId == null) {
    payload.leavewordId = subjectId;
  }
  if (eventType.startsWith('icc.call.') && payload.callId == null) {
    payload.callId = rowField(row, 'CallID') ?? subjectId;
  }
  return payload;
}

export function mapCdcChange(
  change: CdcChange,
  tables: HubCdcConfig['tables'],
): RawIngestRecord | null {
  const spec = tables[change.table];
  if (!spec) return null;
  const eventType = eventTypeFor(change.op, spec);
  if (!eventType) return null;
  const image = change.op === 'delete'
    ? asPlainRow(change.before ?? change.after)
    : asPlainRow(change.after ?? change.before);
  const subjectRaw = rowField(image, spec.subjectId);
  if (subjectRaw == null || subjectRaw === '') return null;
  const subjectId = String(subjectRaw);
  const aggregateType = aggregateTypeFromEventType(eventType);
  const partitionKey = spec.partitionKey
    ? interpolateTemplate(spec.partitionKey, image)
    : `${aggregateType}:${subjectId}`;
  const vdn = rowField(image, 'VDNId') ?? rowField(image, 'vdnId');
  return {
    eventId: cdcEventId(change, subjectId),
    eventType,
    eventVersion: 1,
    aggregateType,
    aggregateId: subjectId,
    partitionKey,
    vdnId: vdn == null ? 0 : Number(vdn) || 0,
    sourceComponent: 'hub',
    payload: {
      ...enrichPayload(image, eventType, subjectId),
      _op: change.op,
      _table: change.table,
      ...(change.before && change.op !== 'delete' ? { _before: change.before } : {}),
    },
    occurredAt: change.occurredAt ?? new Date(),
    cursor: { ...change.cursor },
  };
}

function asOp(v: unknown): CdcOp | undefined {
  const s = String(v ?? '').toLowerCase();
  if (s === 'c' || s === 'create' || s === 'insert' || s === 'r' || s === 'read') return 'insert';
  if (s === 'u' || s === 'update') return 'update';
  if (s === 'd' || s === 'delete') return 'delete';
  return undefined;
}

/** Debezium JSON envelope → 行变更。 */
export function unwrapDebezium(msg: unknown): CdcChange[] {
  if (!msg || typeof msg !== 'object') return [];
  const root = msg as Record<string, unknown>;
  const payload = (root.payload && typeof root.payload === 'object'
    ? root.payload
    : root) as Record<string, unknown>;
  const op = asOp(payload.op);
  if (!op) return [];
  const source = (payload.source && typeof payload.source === 'object'
    ? payload.source
    : {}) as Record<string, unknown>;
  const table = String(source.table ?? payload.table ?? '');
  if (!table) return [];
  const after = payload.after && typeof payload.after === 'object'
    ? asPlainRow(payload.after)
    : undefined;
  const before = payload.before && typeof payload.before === 'object'
    ? asPlainRow(payload.before)
    : undefined;
  const gtid = source.gtid != null ? String(source.gtid) : undefined;
  const file = source.file != null ? String(source.file) : undefined;
  const pos = source.pos != null ? Number(source.pos) : undefined;
  const ts = payload.ts_ms != null ? new Date(Number(payload.ts_ms)) : undefined;
  return [{
    table,
    op,
    after,
    before,
    cursor: { gtid, file, pos },
    occurredAt: ts && !Number.isNaN(ts.getTime()) ? ts : undefined,
  }];
}

/** Canal JSON → 行变更（一条消息可能多行）。 */
export function unwrapCanal(msg: unknown): CdcChange[] {
  if (!msg || typeof msg !== 'object') return [];
  const root = msg as Record<string, unknown>;
  const op = asOp(root.type ?? root.eventType);
  if (!op) return [];
  const table = String(root.table ?? '');
  if (!table) return [];
  const data = Array.isArray(root.data) ? root.data : (root.data ? [root.data] : []);
  const old = Array.isArray(root.old) ? root.old : (root.old ? [root.old] : []);
  const gtid = root.gtid != null ? String(root.gtid) : undefined;
  const es = root.es != null ? new Date(Number(root.es)) : undefined;
  if (!data.length && op === 'delete' && old.length) {
    return old.map((row, i) => ({
      table,
      op,
      before: asPlainRow(row),
      cursor: { gtid, seq: i },
      occurredAt: es,
    }));
  }
  return data.map((row, i) => ({
    table,
    op,
    after: asPlainRow(row),
    before: old[i] ? asPlainRow(old[i]) : undefined,
    cursor: { gtid, seq: i },
    occurredAt: es,
  }));
}

export function unwrapCdcEnvelope(driver: HubCdcConfig['driver'], msg: unknown): CdcChange[] {
  if (driver === 'debezium') return unwrapDebezium(msg);
  if (driver === 'canal') return unwrapCanal(msg);
  if (msg && typeof msg === 'object' && 'table' in msg && 'op' in msg) {
    const m = msg as CdcChange;
    return [{
      table: String(m.table),
      op: (asOp(m.op) ?? 'insert'),
      after: m.after,
      before: m.before,
      cursor: m.cursor ?? {},
      occurredAt: m.occurredAt,
    }];
  }
  return [];
}
