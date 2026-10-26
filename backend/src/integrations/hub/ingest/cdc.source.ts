import type { HubCdcConfig } from '../config/schema.js';
import {
  isCursorAfter,
  mapCdcChange,
  mergeCdcCursor,
  type CdcChange,
  type CdcCursor,
} from './cdc-map.js';
import type { Cursor, IngestSource, RawIngestRecord, SourceHealth } from './source.js';

export type { CdcChange, CdcCursor } from './cdc-map.js';

export interface CdcReader {
  start(from: CdcCursor | null): Promise<void>;
  next(batchSize: number): Promise<CdcChange[]>;
  ack?(cursor: CdcCursor): Promise<void>;
  stop(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function asCdcCursor(v: Record<string, unknown> | CdcCursor | null | undefined): CdcCursor | null {
  if (!v) return null;
  const tables = v.tables && typeof v.tables === 'object' && !Array.isArray(v.tables)
    ? Object.fromEntries(Object.entries(v.tables as Record<string, unknown>).map(([k, val]) => [k, String(val)]))
    : undefined;
  return {
    gtid: v.gtid != null ? String(v.gtid) : undefined,
    file: v.file != null ? String(v.file) : undefined,
    pos: v.pos != null ? Number(v.pos) : undefined,
    seq: v.seq != null ? Number(v.seq) : undefined,
    tables,
  };
}

/** 可注入的内存 CDC 流，供单测与外部 binlog/Debezium adapter 使用。 */
export function createMemoryCdcReader(initial: CdcChange[] = []): CdcReader & { push(change: CdcChange): void } {
  const items = [...initial];
  let ackedIdx = 0;
  const acked = new Set<string>();

  function keyOf(c: CdcCursor): string {
    if (c.seq != null) return `seq:${c.seq}`;
    if (c.gtid) return `gtid:${c.gtid}`;
    if (c.file != null && c.pos != null) return `bin:${c.file}:${c.pos}`;
    return JSON.stringify(c);
  }

  return {
    push(change) { items.push(change); },
    async start(from) {
      acked.clear();
      if (!from) {
        ackedIdx = 0;
        return;
      }
      const idx = items.findIndex((c) => isCursorAfter(c.cursor, from));
      ackedIdx = idx < 0 ? items.length : idx;
    },
    async next(batchSize) {
      return items.slice(ackedIdx, ackedIdx + batchSize);
    },
    async ack(cursor) {
      acked.add(keyOf(cursor));
      while (ackedIdx < items.length && acked.has(keyOf(items[ackedIdx]!.cursor))) {
        ackedIdx += 1;
      }
    },
    async stop() { /* no-op */ },
  };
}

export function createCdcSource(opts: {
  reader: CdcReader;
  config: HubCdcConfig;
  getOffset: () => Promise<Record<string, unknown> | null>;
  setOffset: (cursor: CdcCursor) => Promise<void>;
  shouldPause?: () => boolean;
  onHealth?: (h: SourceHealth) => void;
}): IngestSource {
  let stopped = false;
  let emitFn: ((raw: RawIngestRecord[]) => Promise<void>) | undefined;
  let lastHealth: SourceHealth = { ok: true };
  let idleMs = opts.config.pollIntervalMs ?? 50;
  const pollIntervalMs = opts.config.pollIntervalMs ?? 50;
  const idleMaxMs = opts.config.idleMaxMs ?? 500;
  const batchSize = opts.config.batchSize ?? 200;

  async function pollOnce(): Promise<number> {
    if (opts.shouldPause?.()) return 0;
    const changes = await opts.reader.next(batchSize);
    const raws: RawIngestRecord[] = [];
    for (const ch of changes) {
      const raw = mapCdcChange(ch, opts.config.tables);
      if (raw) raws.push(raw);
      else await opts.reader.ack?.(ch.cursor);
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
    kind: 'cdc',
    async start(emit) {
      emitFn = emit;
      stopped = false;
      const from = asCdcCursor(await opts.getOffset());
      await opts.reader.start(from);
      void loop();
    },
    async commit(cursor: Cursor) {
      const next = asCdcCursor(cursor) ?? {};
      const prev = asCdcCursor(await opts.getOffset());
      const merged = mergeCdcCursor(prev, next);
      await opts.setOffset(merged);
      await opts.reader.ack?.(next);
    },
    async stop() {
      stopped = true;
      await opts.reader.stop();
    },
    async health() { return lastHealth; },
  };
}
