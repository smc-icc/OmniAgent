import type { HubLegacySyncConfig } from '../config/schema.js';
import type { OutboxExec } from './outbox.source.js';
import { assertLookupSql, assertMysqlIdent, FORBIDDEN_SYNC_TABLES, quoteIdent, rowField, asPlainRow } from './ident.js';
import type { Cursor, IngestSource, RawIngestRecord, SourceHealth } from './source.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function aggregateTypeFromEventType(eventType: string): string {
  const parts = eventType.split('.');
  return parts.length >= 2 ? parts[1]! : eventType;
}

function pickOccurredAt(row: Record<string, unknown>): string | Date {
  const v = rowField(row, 'EndTime') ?? rowField(row, 'BeginTime') ?? rowField(row, 'CreateTime') ?? rowField(row, 'OccurredAt');
  if (v instanceof Date || typeof v === 'string') return v;
  return new Date();
}

export function validateLegacySyncTables(tables: HubLegacySyncConfig['tables']): void {
  for (const [name, spec] of Object.entries(tables)) {
    if (FORBIDDEN_SYNC_TABLES.has(name.toLowerCase())) {
      throw new Error(`${name} 是 CCS PID 高水位表，禁止作为 legacy_sync 源`);
    }
    assertMysqlIdent(name, 'table');
    assertLookupSql(spec.lookup);
  }
}

export function createLegacySyncSource(opts: {
  db: OutboxExec;
  config: HubLegacySyncConfig;
  getOffset: () => Promise<Record<string, unknown> | null>;
  setOffset: (cursor: Record<string, unknown>) => Promise<void>;
  shouldPause?: () => boolean;
  onHealth?: (h: SourceHealth) => void;
}): IngestSource {
  validateLegacySyncTables(opts.config.tables);
  let stopped = false;
  let emitFn: ((raw: RawIngestRecord[]) => Promise<void>) | undefined;
  let lastHealth: SourceHealth = { ok: true };
  const pollIntervalMs = opts.config.pollIntervalMs ?? 50;
  const idleMaxMs = opts.config.idleMaxMs ?? 500;
  const batchSize = opts.config.batchSize ?? 200;
  let idleMs = pollIntervalMs;

  function lastPids(raw: Record<string, unknown> | null): Record<string, string> {
    const t = raw?.tables;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return {};
    return Object.fromEntries(Object.entries(t as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }

  async function applyCursor(cursor: Cursor): Promise<void> {
    const table = cursor.table != null ? String(cursor.table) : '';
    const pid = cursor.id != null ? String(cursor.id) : '';
    if (!table || !pid) return;
    assertMysqlIdent(table, 'table');
    if (cursor.deleteAfterRead) {
      await opts.db.execute(`DELETE FROM ${quoteIdent(table, 'table')} WHERE PID = ?`, [pid]);
    }
    const prev = lastPids(await opts.getOffset());
    prev[table] = pid;
    await opts.setOffset({ tables: prev });
  }

  async function pollTable(syncTable: string): Promise<RawIngestRecord[]> {
    const spec = opts.config.tables[syncTable]!;
    const offset = lastPids(await opts.getOffset());
    const ident = quoteIdent(syncTable, 'table');
    const last = offset[syncTable] ?? '0';
    const pids = spec.deleteAfterRead
      ? await opts.db.query<{ PID: unknown }>(`SELECT PID FROM ${ident} ORDER BY PID ASC LIMIT ?`, [batchSize])
      : await opts.db.query<{ PID: unknown }>(
        `SELECT PID FROM ${ident} WHERE PID > ? ORDER BY PID ASC LIMIT ?`,
        [last, batchSize],
      );
    const raws: RawIngestRecord[] = [];
    for (const row of pids) {
      const pid = row.PID ?? rowField(asPlainRow(row), 'PID');
      if (pid == null) continue;
      const lookupRows = await opts.db.query<Record<string, unknown>>(spec.lookup, [pid]);
      const found = lookupRows[0];
      if (!found) {
        await applyCursor({
          id: String(pid),
          table: syncTable,
          deleteAfterRead: spec.deleteAfterRead,
        });
        continue;
      }
      const plain = asPlainRow(found);
      const eventType = spec.eventType;
      const aggregateType = aggregateTypeFromEventType(eventType);
      const callId = rowField(plain, 'CallID');
      const aggregateId = callId != null ? String(callId) : String(pid);
      const vdn = rowField(plain, 'VDNId') ?? rowField(plain, 'vdnId');
      raws.push({
        eventId: `legacy:${syncTable}:${pid}`,
        eventType,
        eventVersion: 1,
        aggregateType,
        aggregateId,
        partitionKey: `${aggregateType}:${aggregateId}`,
        vdnId: vdn == null ? 0 : Number(vdn) || 0,
        sourceComponent: 'fucus',
        payload: { ...plain, pid },
        occurredAt: pickOccurredAt(plain),
        cursor: {
          id: String(pid),
          table: syncTable,
          deleteAfterRead: spec.deleteAfterRead,
        },
      });
    }
    return raws;
  }

  async function pollOnce(): Promise<number> {
    if (opts.shouldPause?.()) return 0;
    const raws: RawIngestRecord[] = [];
    for (const table of Object.keys(opts.config.tables)) {
      raws.push(...await pollTable(table));
    }
    if (!raws.length) return 0;
    await emitFn?.(raws);
    return raws.length;
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        const n = await pollOnce();
        idleMs = n > 0 ? pollIntervalMs : Math.min(idleMaxMs, Math.max(pollIntervalMs, idleMs * 2));
        lastHealth = { ok: true };
        opts.onHealth?.(lastHealth);
      } catch (err) {
        lastHealth = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        opts.onHealth?.(lastHealth);
        idleMs = idleMaxMs;
      }
      await sleep(idleMs);
    }
  }

  return {
    kind: 'legacy_sync',
    async start(emit) {
      emitFn = emit;
      stopped = false;
      void loop();
    },
    async commit(cursor: Cursor) {
      await applyCursor(cursor);
    },
    async stop() {
      stopped = true;
    },
    async health() { return lastHealth; },
  };
}
