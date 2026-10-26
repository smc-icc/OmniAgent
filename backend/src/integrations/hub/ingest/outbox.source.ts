import type { HubOutboxConfig } from '../config/schema.js';
import type { Cursor, IngestSource, RawIngestRecord, SourceHealth } from './source.js';

export interface OutboxRow {
  ID: number | bigint | string;
  EventId: string;
  EventType: string;
  EventVersion: number;
  AggregateType: string;
  AggregateId: string;
  PartitionKey: string;
  VdnId: number;
  SourceComponent: string;
  SourceNodeId?: string | null;
  Payload: unknown;
  OccurredAt: Date | string;
  CreateTime: Date | string;
  ClaimedAt?: Date | string | null;
  ConsumedAt?: Date | string | null;
}

export interface OutboxExec {
  query<T = OutboxRow>(sql: string, params: unknown[]): Promise<T[]>;
  execute(sql: string, params: unknown[]): Promise<number>;
}

export interface OutboxDb extends OutboxExec {
  version(): Promise<string>;
  /** MySQL 8 SKIP LOCKED 必须在同一连接上事务领取 */
  withTransaction<T>(fn: (exec: OutboxExec) => Promise<T>): Promise<T>;
}

export function asTime(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * 5.7 位点+滞后窗口：只把 offset 推进到 CreateTime < now-safetyLag 的最大 ID。
 * 窗口内的行每次重扫，靠 eventId 幂等。这样 ID=101 先可见也不会永久漏掉未提交的 100。
 */
export function advanceLagWindowOffset(opts: {
  rows: OutboxRow[];
  offsetId: bigint;
  now: Date;
  safetyLagMs: number;
}): { emit: OutboxRow[]; newOffset: bigint } {
  const cutoff = new Date(opts.now.getTime() - opts.safetyLagMs);
  const emit = [...opts.rows].sort((a, b) => Number(BigInt(a.ID) - BigInt(b.ID)));
  let newOffset = opts.offsetId;
  for (const row of emit) {
    const created = asTime(row.CreateTime);
    const id = BigInt(row.ID);
    if (created < cutoff && id > newOffset) newOffset = id;
  }
  return { emit, newOffset };
}

function parsePayload(v: unknown): unknown {
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return { raw: v }; }
  }
  return v;
}

function toRaw(row: OutboxRow): RawIngestRecord {
  return {
    eventId: String(row.EventId),
    eventType: String(row.EventType),
    eventVersion: Number(row.EventVersion ?? 1),
    aggregateType: String(row.AggregateType),
    aggregateId: String(row.AggregateId),
    partitionKey: String(row.PartitionKey),
    vdnId: Number(row.VdnId ?? 0),
    sourceComponent: String(row.SourceComponent ?? 'hub'),
    sourceNodeId: row.SourceNodeId ? String(row.SourceNodeId) : undefined,
    payload: parsePayload(row.Payload),
    occurredAt: row.OccurredAt,
    cursor: { id: String(row.ID) },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createOutboxSource(opts: {
  db: OutboxDb;
  config: HubOutboxConfig;
  getOffset: () => Promise<bigint>;
  setOffset: (id: bigint) => Promise<void>;
  shouldPause?: () => boolean;
  now?: () => Date;
  onHealth?: (h: SourceHealth) => void;
}): IngestSource {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let idleMs = opts.config.pollIntervalMs;
  let emitFn: ((raw: RawIngestRecord[]) => Promise<void>) | undefined;
  let mysql8 = opts.config.mysql8;
  let lastHealth: SourceHealth = { ok: true };
  let hasConsumedAt: boolean | undefined;

  async function detectConsumedAt(): Promise<boolean> {
    if (typeof hasConsumedAt === 'boolean') return hasConsumedAt;
    try {
      await opts.db.query('SELECT ConsumedAt FROM t_icc_outbox_event LIMIT 0', []);
      hasConsumedAt = true;
    } catch {
      hasConsumedAt = false;
    }
    return hasConsumedAt;
  }

  async function detectMysql8(): Promise<boolean> {
    if (typeof mysql8 === 'boolean') return mysql8;
    const v = await opts.db.version();
    mysql8 = /^8\./.test(v) || v.startsWith('8');
    return mysql8;
  }

  async function claimMysql8(): Promise<OutboxRow[]> {
    const timeoutSec = Math.max(1, Math.floor(opts.config.claimTimeoutMs / 1000));
    const consumed = await detectConsumedAt();
    const consumedClause = consumed ? 'ConsumedAt IS NULL AND ' : '';
    return opts.db.withTransaction(async (exec) => {
      const rows = await exec.query<OutboxRow>(
        `SELECT ID, EventId, EventType, EventVersion, AggregateType, AggregateId, PartitionKey,
                VdnId, SourceComponent, SourceNodeId, Payload, OccurredAt, CreateTime, ClaimedAt
         FROM t_icc_outbox_event
         WHERE ${consumedClause}(ClaimedAt IS NULL OR ClaimedAt < DATE_SUB(NOW(3), INTERVAL ? SECOND))
         ORDER BY ID
         LIMIT ?
         FOR UPDATE SKIP LOCKED`,
        [timeoutSec, opts.config.batchSize],
      );
      if (rows.length) {
        const ids = rows.map((r) => r.ID);
        await exec.execute(
          `UPDATE t_icc_outbox_event SET ClaimedAt = NOW(3) WHERE ID IN (${ids.map(() => '?').join(',')})`,
          ids,
        );
      }
      return rows;
    });
  }

  async function scanLagWindow(): Promise<{ emit: OutboxRow[]; newOffset: bigint }> {
    const offset = await opts.getOffset();
    const consumed = await detectConsumedAt();
    const consumedClause = consumed ? 'ConsumedAt IS NULL AND ' : '';
    const rows = await opts.db.query<OutboxRow>(
      `SELECT ID, EventId, EventType, EventVersion, AggregateType, AggregateId, PartitionKey,
              VdnId, SourceComponent, SourceNodeId, Payload, OccurredAt, CreateTime, ClaimedAt
       FROM t_icc_outbox_event
       WHERE ${consumedClause}(ID > ? OR CreateTime >= DATE_SUB(NOW(3), INTERVAL ? MILLISECOND))
       ORDER BY ID
       LIMIT ?`,
      [offset.toString(), opts.config.safetyLagMs * 2, opts.config.batchSize],
    );
    const { emit, newOffset } = advanceLagWindowOffset({
      rows,
      offsetId: offset,
      now: (opts.now ?? (() => new Date()))(),
      safetyLagMs: opts.config.safetyLagMs,
    });
    return { emit, newOffset };
  }

  async function refreshHealth(): Promise<void> {
    try {
      const consumed = await detectConsumedAt();
      const stats = await opts.db.query<{ n: number; oldest: Date | string | null }>(
        consumed
          ? `SELECT COUNT(*) AS n, MIN(CreateTime) AS oldest FROM t_icc_outbox_event WHERE ConsumedAt IS NULL`
          : `SELECT COUNT(*) AS n, MIN(CreateTime) AS oldest FROM t_icc_outbox_event`,
        [],
      );
      const n = Number(stats[0]?.n ?? 0);
      const oldest = stats[0]?.oldest ? asTime(stats[0].oldest) : null;
      const oldestSeconds = oldest ? Math.max(0, (Date.now() - oldest.getTime()) / 1000) : 0;
      lastHealth = { ok: true, backlog: n, oldestSeconds };
      opts.onHealth?.(lastHealth);
    } catch (err) {
      lastHealth = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      opts.onHealth?.(lastHealth);
    }
  }

  async function pollOnce(): Promise<number> {
    if (opts.shouldPause?.()) return 0;
    const use8 = await detectMysql8();
    if (use8) {
      const rows = await claimMysql8();
      if (!rows.length) return 0;
      await emitFn?.(rows.map(toRaw));
      return rows.length;
    }
    const { emit, newOffset } = await scanLagWindow();
    if (emit.length) await emitFn?.(emit.map(toRaw));
    await opts.setOffset(newOffset);
    return emit.length;
  }

  async function loop(): Promise<void> {
    await refreshHealth();
    while (!stopped) {
      try {
        const n = await pollOnce();
        idleMs = n > 0 ? opts.config.pollIntervalMs : Math.min(opts.config.idleMaxMs, Math.max(opts.config.pollIntervalMs, idleMs * 2));
      } catch (err) {
        lastHealth = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        opts.onHealth?.(lastHealth);
        idleMs = opts.config.idleMaxMs;
      }
      await sleep(idleMs);
    }
  }

  return {
    kind: 'outbox',
    async start(emit) {
      emitFn = emit;
      stopped = false;
      void loop();
    },
    async commit(cursor: Cursor) {
      if (cursor.id === undefined) return;
      const consumed = await detectConsumedAt();
      if (consumed) {
        await opts.db.execute(
          'UPDATE t_icc_outbox_event SET ConsumedAt = NOW(3) WHERE ID = ? AND ConsumedAt IS NULL',
          [cursor.id],
        );
        return;
      }
      if (mysql8) {
        await opts.db.execute('DELETE FROM t_icc_outbox_event WHERE ID = ?', [cursor.id]);
      }
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    async health() { return lastHealth; },
  };
}

export function notImplementedSource(kind: IngestSource['kind']): IngestSource {
  return {
    kind,
    async start() {
      throw new Error(`${kind} 摄取尚未实现（计划 P3）。请使用 ingest.mode=outbox`);
    },
    async commit() { /* no-op */ },
    async stop() { /* no-op */ },
    async health() { return { ok: false, detail: `${kind} not implemented` }; },
  };
}
