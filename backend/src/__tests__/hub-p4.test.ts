import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { EventTypes } from '../integrations/hub/contract/event-types.js';
import type { BusinessEvent } from '../integrations/hub/contract/event.js';
import { hubConfigSchema } from '../integrations/hub/config/schema.js';
import { startHub } from '../integrations/hub/runtime.js';
import { handleHubHealth, handleHubLiveness } from '../integrations/hub/admin/handlers.js';
import { reconcileDay, uuidFromKey } from '../integrations/hub/admin/reconcile.js';
import { buildOracleMergeSql, createOracleSink, type OracleExecutor } from '../integrations/hub/sinks/oracle.sink.js';
import { createMemoryMqPublisher, createMqSink, mqPartitionFor } from '../integrations/hub/sinks/mq.sink.js';
import { verifyHttpSignature } from '../integrations/hub/sinks/http-verify.js';
import { signHttpBody } from '../integrations/hub/sinks/http.sink.js';
import { createMemoryHubStore } from '../integrations/hub/store/memory.js';
import { hashMod } from '../integrations/hub/core/hash.js';
import { createTokenBucket } from '../integrations/hub/core/rate-limit.js';
import type { DeliveryItem } from '../integrations/hub/sinks/sink.js';
import type { OutboxExec } from '../integrations/hub/ingest/outbox.source.js';

function event(id: string, partitionKey = 'call:1'): BusinessEvent {
  return {
    eventId: id,
    eventType: EventTypes.CALL_ENDED,
    eventVersion: 1,
    occurredAt: '2026-08-26T03:00:00.000Z',
    source: { system: 'icc', component: 'ccs' },
    tenant: { vdnId: 1 },
    subject: { type: 'call', id: partitionKey },
    partitionKey,
    payload: { pid: 1 },
  };
}

function item(n: number, sink = 'customer_oracle'): DeliveryItem {
  const id = uuidFromKey(`ora:${n}`);
  return {
    event: event(id, `call:${n}`),
    record: { PID: n, CALLER: '138', SOURCE_EVENT_SUBJECT: String(n) },
    sinkName: sink,
  };
}

const silent = {
  info() { /* */ },
  warn() { /* */ },
  error() { /* */ },
};

describe('oracle MERGE', () => {
  it('builds MERGE with bind names and conflict key', () => {
    const sql = buildOracleMergeSql({
      table: 'ICC_CALL_LOG',
      columns: ['PID', 'CALLER'],
      conflictKey: ['PID'],
    });
    expect(sql).toContain('MERGE INTO "ICC_CALL_LOG" t');
    expect(sql).toContain('ON (t."PID" = s."PID")');
    expect(sql).toContain('WHEN MATCHED THEN UPDATE SET');
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT');
    expect(sql).toContain(':PID');
  });

  it('executeMany 10 万条分批无错', async () => {
    const seen: number[] = [];
    const executor: OracleExecutor = {
      async executeMany(_sql, binds) {
        seen.push(binds.length);
        return binds.length;
      },
      async ping() { /* */ },
      async close() { /* */ },
    };
    const sink = createOracleSink({
      spec: { kind: 'oracle', table: 'ICC_CALL_LOG', conflictKey: ['PID'], batch: { maxSize: 200 } },
      name: 'customer_oracle',
      executor,
    });
    await sink.init();
    const total = 100_000;
    const chunk = 200;
    for (let i = 0; i < total; i += chunk) {
      const n = Math.min(chunk, total - i);
      const items = Array.from({ length: n }, (_, j) => item(i + j));
      const r = await sink.deliver(items);
      expect(r.results.every((x) => x.ok)).toBe(true);
    }
    expect(seen.reduce((a, b) => a + b, 0)).toBe(total);
    await sink.close();
  }, 60_000);
});

describe('mq sink partition', () => {
  it('same partitionKey maps to the same partition and preserves order', async () => {
    const pub = createMemoryMqPublisher();
    const sink = createMqSink({
      spec: { kind: 'mq', driver: 'redis-streams', url: 'redis://unused', topic: 'icc.events', partitions: 16 },
      name: 'partner_mq',
      publisher: pub,
    });
    await sink.init();
    const key = 'call:42';
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ];
    for (const id of ids) {
      await sink.deliver([{ event: event(id, key), record: {}, sinkName: 'partner_mq' }]);
    }
    await sink.deliver([{ event: event('00000000-0000-4000-8000-000000000099', 'call:99'), record: {}, sinkName: 'partner_mq' }]);
    const same = pub.published.filter((p) => p.key === key);
    expect(same).toHaveLength(3);
    expect(new Set(same.map((p) => p.partition)).size).toBe(1);
    expect(same.map((p) => p.eventId)).toEqual(ids);
    expect(mqPartitionFor(key, 16)).toBe(hashMod(key, 16));
    await sink.close();
  });
});

describe('http notify verify', () => {
  it('accepts HMAC and rejects skew', () => {
    const secret = 's3cret';
    const ts = String(Date.now());
    const body = '{"eventId":"x"}';
    const signature = signHttpBody(secret, ts, body);
    expect(verifyHttpSignature({ secret, timestamp: ts, rawBody: body, signature }).ok).toBe(true);
    expect(verifyHttpSignature({
      secret, timestamp: String(Date.now() - 10 * 60 * 1000), rawBody: body, signature: createHmac('sha256', secret).update('nope').digest('hex'),
    }).ok).toBe(false);
    expect(verifyHttpSignature({
      secret, timestamp: String(Date.now() - 10 * 60 * 1000), rawBody: body, signature, nowMs: Date.now(),
    }).error).toBe('timestamp skew');
  });
});

describe('admin health / reconcile', () => {
  it('liveness 200; readiness 503 when sink down', async () => {
    const cfg = hubConfigSchema.parse({
      enabled: true,
      role: 'standalone',
      runIngest: false,
      sinks: {},
      routes: [],
    });
    const live = handleHubLiveness(cfg);
    expect(live.status).toBe(200);
    const hub = await startHub({
      config: cfg,
      log: silent,
      store: createMemoryHubStore(),
      extraSinks: [{
        name: 'broken',
        capabilities: { batch: true, maxBatchSize: 1, transactional: true, ordered: true },
        async init() { /* */ },
        async deliver() { return { results: [] }; },
        async health() { return { ok: false, detail: 'down' }; },
        async close() { /* */ },
      }],
    });
    const ready = await handleHubHealth(hub, cfg);
    expect(ready.status).toBe(503);
    await hub.stop();
  });

  it('reconcile inserts dlq for missing leavewords', async () => {
    const store = createMemoryHubStore();
    const db: OutboxExec = {
      async query(sql) {
        if (sql.includes('t_icc_base_leaveword')) {
          return [{ Id: 9, Caller: '138', LeaveWordFile: 'a.wav', VDNId: 1 }] as never;
        }
        if (sql.includes('t_icc_ag_route_log')) return [] as never;
        if (sql.includes('t_icc_base_call_log')) return [{ PID: 3 }, { PID: 4 }, { PID: 5 }] as never;
        return [] as never;
      },
      async execute() { return 0; },
    };
    const report = await reconcileDay({ mysql: db, store, day: '2026-08-26' });
    expect(report.leaveword.src).toBe(1);
    expect(report.leaveword.missing).toBe(1);
    expect(report.dlqInserted).toBe(1);
    expect(report.callLog.src).toBe(3);
    expect(report.agRoute.src).toBe(0);
    const rows = await store.listDlq();
    expect(rows[0]?.error).toBe('reconcile-missing');
  });
});

describe('catchup limiter', () => {
  it('token bucket waits when empty', async () => {
    const b = createTokenBucket(100);
    const t0 = Date.now();
    await b.take(1);
    await b.take(1);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
