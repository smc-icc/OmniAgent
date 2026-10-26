import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventTypes } from '../integrations/hub/contract/event-types.js';
import { hubConfigSchema } from '../integrations/hub/config/schema.js';
import { defaultHubConfig } from '../integrations/hub/config/defaults.js';
import { loadHubConfig } from '../integrations/hub/config/loader.js';
import { resolveIngestKinds, startHub } from '../integrations/hub/runtime.js';
import {
  mapCdcChange,
  unwrapCanal,
  unwrapDebezium,
  type CdcChange,
} from '../integrations/hub/ingest/cdc-map.js';
import { createCdcSource, createMemoryCdcReader } from '../integrations/hub/ingest/cdc.source.js';
import { createWatermarkCdcReader } from '../integrations/hub/ingest/cdc-watermark.js';
import { createMemoryMqConsumer, createMqSource, toRawFromMq } from '../integrations/hub/ingest/mq.source.js';
import { createLegacySyncSource, validateLegacySyncTables } from '../integrations/hub/ingest/legacy-sync.source.js';
import { createMemoryHubStore } from '../integrations/hub/store/memory.js';
import type { OutboxExec } from '../integrations/hub/ingest/outbox.source.js';
import type { RawIngestRecord } from '../integrations/hub/ingest/source.js';
import type { DeliveryItem, DeliveryResult, SinkAdapter } from '../integrations/hub/sinks/sink.js';

const silent = {
  info() { /* test */ },
  warn() { /* test */ },
  error() { /* test */ },
};

async function waitUntil(pred: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('timeout');
}

const leavewordTable = {
  insert: EventTypes.VOICEMAIL_CREATED,
  update: EventTypes.VOICEMAIL_UPDATED,
  subjectId: 'ID',
  partitionKey: 'voicemail:{ID}',
};

function parsedCdcConfig() {
  return hubConfigSchema.parse({
    enabled: true,
    ingest: {
      mode: 'cdc',
      cdc: {
        driver: 'native',
        pollIntervalMs: 5,
        idleMaxMs: 20,
        batchSize: 20,
        tables: { t_icc_base_leaveword: leavewordTable },
      },
    },
    sinks: {},
    routes: [{
      name: 'all',
      match: { eventType: ['*'] },
      sinks: ['probe'],
      transform: 'passthrough',
      onError: 'dlq',
    }],
    delivery: { ...defaultHubConfig.delivery, retryBaseMs: 10, retryMaxMs: 20, maxAttempts: 3 },
  });
}

function change(seq: number, over: Partial<CdcChange> = {}): CdcChange {
  return {
    table: 't_icc_base_leaveword',
    op: 'insert',
    after: { ID: seq, Caller: '13800138000', LeaveWordFile: `lw/${seq}.wav`, VDNId: 1 },
    cursor: { gtid: `g:${seq}`, seq },
    occurredAt: '2026-08-26T03:00:00.000Z',
    ...over,
  };
}

describe('hub ingest mode switch', () => {
  it('switches ingest kinds by config only', () => {
    const outbox = hubConfigSchema.parse({ ingest: { mode: 'outbox' } });
    const cdc = hubConfigSchema.parse({
      ingest: { mode: 'cdc', cdc: { tables: { t_icc_base_leaveword: { subjectId: 'ID', insert: EventTypes.VOICEMAIL_CREATED } } } },
    });
    const mq = hubConfigSchema.parse({
      ingest: { mode: 'mq', mq: { url: 'redis://127.0.0.1:6379', topics: ['icc.events'] } },
    });
    const legacy = hubConfigSchema.parse({
      ingest: {
        mode: 'legacy_sync',
        legacy_sync: {
          tables: {
            t_icc_base_call_log_sync: {
              lookup: 'SELECT * FROM t_icc_base_call_log WHERE PID = ?',
              eventType: EventTypes.CALL_ENDED,
            },
          },
        },
      },
    });
    const multi = hubConfigSchema.parse({
      ingest: {
        mode: 'multi',
        multi: [
          { kind: 'outbox', enabled: true },
          { kind: 'legacy_sync', enabled: true },
          { kind: 'cdc', enabled: false },
        ],
        legacy_sync: {
          tables: {
            t_icc_base_call_log_sync: {
              lookup: 'SELECT * FROM t_icc_base_call_log WHERE PID = ?',
              eventType: EventTypes.CALL_ENDED,
            },
          },
        },
      },
    });
    expect(resolveIngestKinds(outbox)).toEqual(['outbox']);
    expect(resolveIngestKinds(cdc)).toEqual(['cdc']);
    expect(resolveIngestKinds(mq)).toEqual(['mq']);
    expect(resolveIngestKinds(legacy)).toEqual(['legacy_sync']);
    expect(resolveIngestKinds(multi)).toEqual(['outbox', 'legacy_sync']);
  });

  it('HUB_INGEST_MODE overlays ingest.mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-cfg-'));
    const path = join(dir, 'hub.json');
    writeFileSync(path, JSON.stringify({
      ingest: {
        mode: 'outbox',
        cdc: { tables: { t_icc_base_leaveword: { subjectId: 'ID', insert: EventTypes.VOICEMAIL_CREATED } } },
      },
    }));
    const cfg = loadHubConfig({ HUB_CONFIG_PATH: path, HUB_INGEST_MODE: 'cdc', HUB_ENABLED: '1' });
    expect(cfg.ingest.mode).toBe('cdc');
    expect(cfg.ingest.cdc?.tables.t_icc_base_leaveword?.subjectId).toBe('ID');
  });

  it('rejects multi with cdc enabled but no cdc config', () => {
    expect(() => hubConfigSchema.parse({
      ingest: { mode: 'multi', multi: [{ kind: 'cdc', enabled: true }] },
    })).toThrow();
  });
});

describe('cdc mapping', () => {
  it('maps leaveword insert to voicemail.created', () => {
    const raw = mapCdcChange(change(42), { t_icc_base_leaveword: leavewordTable });
    expect(raw?.eventType).toBe(EventTypes.VOICEMAIL_CREATED);
    expect(raw?.aggregateId).toBe('42');
    expect(raw?.partitionKey).toBe('voicemail:42');
    expect((raw?.payload as { callerNumber: string }).callerNumber).toBe('13800138000');
    expect(raw?.eventId).toContain('cdc:t_icc_base_leaveword:insert:42');
  });

  it('skips unmapped ops', () => {
    expect(mapCdcChange(change(1, { op: 'delete' }), { t_icc_base_leaveword: leavewordTable })).toBeNull();
  });

  it('unwraps debezium and canal envelopes', () => {
    const [d] = unwrapDebezium({
      payload: {
        op: 'c',
        after: { ID: 7, Caller: '1' },
        source: { table: 't_icc_base_leaveword', file: 'mysql-bin.000003', pos: 4096, gtid: 'abc:1' },
        ts_ms: Date.parse('2026-08-26T03:00:00.000Z'),
      },
    });
    expect(d?.table).toBe('t_icc_base_leaveword');
    expect(d?.op).toBe('insert');
    expect(d?.cursor.gtid).toBe('abc:1');

    const canal = unwrapCanal({
      type: 'INSERT',
      table: 't_icc_base_leaveword',
      data: [{ ID: 8 }, { ID: 9 }],
      gtid: 'c:1',
    });
    expect(canal).toHaveLength(2);
    expect(canal[1]?.after?.ID).toBe(9);
  });
});

describe('cdc source resume', () => {
  it('restarts from persisted GTID and does not re-emit committed changes', async () => {
    const cfg = parsedCdcConfig().ingest.cdc!;
    const store = createMemoryHubStore();
    const first = [change(1), change(2), change(3)];
    const reader = createMemoryCdcReader(first);
    const emitted: string[] = [];
    const src = createCdcSource({
      reader,
      config: cfg,
      getOffset: () => store.getOffset('cdc'),
      setOffset: (c) => store.setOffset('cdc', c),
    });
    await src.start(async (raws) => {
      for (const raw of raws) {
        emitted.push(raw.eventId);
        await src.commit(raw.cursor);
      }
    });
    await waitUntil(() => emitted.length >= 3);
    await src.stop();
    expect(emitted).toHaveLength(3);

    const replayed: string[] = [];
    const reader2 = createMemoryCdcReader([...first, change(4)]);
    const src2 = createCdcSource({
      reader: reader2,
      config: cfg,
      getOffset: () => store.getOffset('cdc'),
      setOffset: (c) => store.setOffset('cdc', c),
    });
    await src2.start(async (raws) => {
      for (const raw of raws) {
        replayed.push(raw.eventId);
        await src2.commit(raw.cursor);
      }
    });
    await waitUntil(() => replayed.length >= 1);
    await src2.stop();
    expect(replayed).toEqual([mapCdcChange(change(4), { t_icc_base_leaveword: leavewordTable })!.eventId]);
    const offset = await store.getOffset('cdc');
    expect(offset?.gtid).toBe('g:4');
  });

  it('watermark reader tails subjectId inserts', async () => {
    const rows = [
      { ID: 10, Caller: 'a', VDNId: 1 },
      { ID: 11, Caller: 'b', VDNId: 1 },
    ];
    const db: OutboxExec = {
      async query(sql, params) {
        const last = Number(params[0] ?? 0);
        const limit = Number(params[1] ?? 100);
        return rows.filter((r) => r.ID > last).slice(0, limit) as never;
      },
      async execute() { return 0; },
    };
    const store = createMemoryHubStore();
    const cfg = parsedCdcConfig().ingest.cdc!;
    const reader = createWatermarkCdcReader({
      db,
      config: cfg,
      getOffset: () => store.getOffset('cdc'),
    });
    const src = createCdcSource({
      reader,
      config: cfg,
      getOffset: () => store.getOffset('cdc'),
      setOffset: (c) => store.setOffset('cdc', c),
    });
    const emitted: string[] = [];
    await src.start(async (raws) => {
      for (const raw of raws) {
        emitted.push(raw.aggregateId);
        await src.commit(raw.cursor);
      }
    });
    await waitUntil(() => emitted.length >= 2);
    await src.stop();
    expect(emitted).toEqual(['10', '11']);
    const offset = await store.getOffset('cdc');
    expect((offset?.tables as Record<string, string>).t_icc_base_leaveword).toBe('11');
  });
});

describe('mq source ack', () => {
  it('acks only after emit (after-delivery) and redelivers if not acked', async () => {
    const consumer = createMemoryMqConsumer([{
      id: '1-0',
      topic: 'icc.events',
      body: { eventId: 'e-call', eventType: EventTypes.CALL_ENDED, aggregateType: 'call', aggregateId: 'c1' },
      cursor: { id: '1-0', topic: 'icc.events' },
    }]);
    const cfg = hubConfigSchema.parse({
      ingest: { mode: 'mq', mq: { url: 'redis://unused', pollIntervalMs: 5, maxInFlight: 10, blockMs: 10 } },
    }).ingest.mq!;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let entered = false;
    const src = createMqSource({ consumer, config: cfg });
    await src.start(async (raws) => {
      entered = true;
      await gate;
      for (const raw of raws) await src.commit(raw.cursor);
    });
    await waitUntil(() => entered);
    expect(consumer.acked).toEqual([]);
    release();
    await waitUntil(() => consumer.acked.includes('1-0'));
    await src.stop();

    const consumer2 = createMemoryMqConsumer();
    consumer2.push({
      id: '2-0',
      topic: 'icc.events',
      body: { eventId: 'e2', eventType: EventTypes.CALL_ENDED, aggregateType: 'call', aggregateId: 'c2' },
      cursor: { id: '2-0', topic: 'icc.events' },
    });
    const seen: string[] = [];
    const srcHold = createMqSource({ consumer: consumer2, config: cfg });
    await srcHold.start(async (raws) => {
      for (const raw of raws) seen.push(raw.eventId);
      /* 故意不 commit → 模拟投递中崩溃 */
    });
    await waitUntil(() => seen.length >= 1);
    await srcHold.stop();
    expect(consumer2.acked).toEqual([]);

    const seen2: string[] = [];
    const srcRetry = createMqSource({ consumer: consumer2, config: cfg });
    await srcRetry.start(async (raws) => {
      for (const raw of raws) {
        seen2.push(raw.eventId);
        await srcRetry.commit(raw.cursor);
      }
    });
    await waitUntil(() => seen2.length >= 1 && consumer2.acked.includes('2-0'));
    await srcRetry.stop();
    expect(seen2).toEqual(['e2']);
  });

  it('normalizes mq body to raw ingest record', () => {
    const raw = toRawFromMq({
      id: '9-1',
      topic: 'icc.events',
      body: { eventType: EventTypes.CALL_ENDED, payload: { pid: 1 }, tenant: { vdnId: 3 } },
      cursor: { id: '9-1' },
    });
    expect(raw.eventType).toBe(EventTypes.CALL_ENDED);
    expect(raw.eventId).toBe('mq:icc.events:9-1');
    expect(raw.vdnId).toBe(3);
  });
});

describe('legacy-sync', () => {
  it('looks up PID, emits call.ended, deletes sync row after commit', async () => {
    const sync = [{ PID: 100 }];
    const calls = [{ PID: 100, CallID: 'c1', VDNId: 2, EndTime: '2026-08-26T03:00:00.000Z' }];
    const deleted: string[] = [];
    const db: OutboxExec = {
      async query(sql, params) {
        if (sql.includes('t_icc_base_call_log_sync') && sql.startsWith('SELECT PID')) return [...sync] as never;
        if (sql.includes('t_icc_base_call_log') && params.length === 1) {
          return calls.filter((c) => String(c.PID) === String(params[0])) as never;
        }
        return [];
      },
      async execute(sql, params) {
        if (sql.includes('DELETE')) {
          deleted.push(String(params[0]));
          const i = sync.findIndex((s) => String(s.PID) === String(params[0]));
          if (i >= 0) sync.splice(i, 1);
          return 1;
        }
        return 0;
      },
    };
    const cfg = hubConfigSchema.parse({
      ingest: {
        mode: 'legacy_sync',
        legacy_sync: {
          pollIntervalMs: 5,
          idleMaxMs: 20,
          tables: {
            t_icc_base_call_log_sync: {
              lookup: 'SELECT * FROM t_icc_base_call_log WHERE PID = ?',
              eventType: EventTypes.CALL_ENDED,
              deleteAfterRead: true,
            },
          },
        },
      },
    }).ingest.legacy_sync!;
    const store = createMemoryHubStore();
    const src = createLegacySyncSource({
      db,
      config: cfg,
      getOffset: () => store.getOffset('legacy_sync'),
      setOffset: (c) => store.setOffset('legacy_sync', c),
    });
    const emitted: RawIngestRecord[] = [];
    await src.start(async (raws) => {
      for (const raw of raws) {
        emitted.push(raw);
        await src.commit(raw.cursor);
      }
    });
    await waitUntil(() => emitted.length >= 1 && deleted.includes('100'));
    await src.stop();
    expect(emitted[0]?.eventType).toBe(EventTypes.CALL_ENDED);
    expect(emitted[0]?.eventId).toBe('legacy:t_icc_base_call_log_sync:100');
    expect(emitted[0]?.aggregateId).toBe('c1');
    expect(emitted[0]?.vdnId).toBe(2);
    expect(sync).toHaveLength(0);
  });

  it('rejects unsafe table names and CCS max-pid table', () => {
    expect(() => validateLegacySyncTables({
      't_icc_base_call_log_sync;drop': {
        lookup: 'SELECT * FROM t_icc_base_call_log WHERE PID = ?',
        eventType: EventTypes.CALL_ENDED,
        deleteAfterRead: true,
      },
    })).toThrow(/非法/);
    expect(() => validateLegacySyncTables({
      t_icc_ccs_log_sync_max_pid: {
        lookup: 'SELECT * FROM t_icc_base_call_log WHERE PID = ?',
        eventType: EventTypes.CALL_ENDED,
        deleteAfterRead: true,
      },
    })).toThrow(/高水位/);
    expect(() => validateLegacySyncTables({
      t_icc_base_call_log_sync: {
        lookup: 'DELETE FROM t_icc_base_call_log WHERE PID = ?',
        eventType: EventTypes.CALL_ENDED,
        deleteAfterRead: true,
      },
    })).toThrow(/SELECT/);
  });
});

describe('startHub cdc wiring', () => {
  it('delivers cdc events through the engine when reader is injected', async () => {
    const cfg = parsedCdcConfig();
    const store = createMemoryHubStore();
    const reader = createMemoryCdcReader([change(5)]);
    const seen: string[] = [];
    const sink: SinkAdapter = {
      name: 'probe',
      capabilities: { batch: true, maxBatchSize: 10, transactional: true, ordered: true },
      async init() { /* */ },
      async deliver(items: DeliveryItem[]): Promise<DeliveryResult> {
        for (const i of items) seen.push(i.event.eventId);
        return { results: items.map((i) => ({ eventId: i.event.eventId, ok: true })) };
      },
      async health() { return { ok: true }; },
      async close() { /* */ },
    };
    const hub = await startHub({
      config: cfg,
      log: silent,
      store,
      cdcReader: reader,
      extraSinks: [sink],
    });
    const expectId = mapCdcChange(change(5), { t_icc_base_leaveword: leavewordTable })!.eventId;
    await waitUntil(() => seen.includes(expectId));
    const d = await store.getDelivery(expectId, 'probe');
    expect(d?.status).toBe('succeeded');
    await hub.stop();
  });

  it('skips kafka mq driver without injected consumer', async () => {
    const warnings: string[] = [];
    const cfg = hubConfigSchema.parse({
      ingest: { mode: 'mq', mq: { driver: 'kafka', url: 'kafka://broker' } },
      sinks: { log: { kind: 'log' } },
      routes: [],
    });
    const hub = await startHub({
      config: cfg,
      log: {
        info() { /* */ },
        warn(_o, msg) { warnings.push(msg); },
        error() { /* */ },
      },
      store: createMemoryHubStore(),
    });
    expect(warnings.some((w) => w.includes('mq driver'))).toBe(true);
    await hub.stop();
  });
});
