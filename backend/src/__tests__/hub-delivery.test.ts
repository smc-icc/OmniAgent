import { describe, expect, it } from 'vitest';
import { defaultHubConfig } from '../integrations/hub/config/defaults.js';
import { EventTypes } from '../integrations/hub/contract/event-types.js';
import type { BusinessEvent } from '../integrations/hub/contract/event.js';
import { createDeliveryEngine } from '../integrations/hub/core/delivery-engine.js';
import { createHubMetrics } from '../integrations/hub/observability/metrics.js';
import { createMemoryHubStore } from '../integrations/hub/store/memory.js';
import type { DeliveryItem, DeliveryResult, SinkAdapter } from '../integrations/hub/sinks/sink.js';
import { HubDeliveryError } from '../integrations/hub/core/errors.js';

const silent = {
  info() { /* test */ },
  warn() { /* test */ },
  error() { /* test */ },
};

function event(id: string, partitionKey: string, seq?: number): BusinessEvent {
  return {
    eventId: id,
    eventType: EventTypes.VOICEMAIL_CREATED,
    eventVersion: 1,
    occurredAt: '2026-08-26T03:00:00.000Z',
    source: { system: 'icc', component: 'ivr' },
    tenant: { vdnId: 1 },
    subject: { type: 'voicemail', id: partitionKey },
    partitionKey,
    payload: { leavewordId: seq ?? 1, duration: 3, callerNumber: '1' },
  };
}

function recordingSink(name = 'log'): SinkAdapter & { seen: string[] } {
  const seen: string[] = [];
  const sink: SinkAdapter & { seen: string[] } = {
    name,
    seen,
    capabilities: { batch: true, maxBatchSize: 10, transactional: true, ordered: true },
    async init() { /* */ },
    async deliver(items: DeliveryItem[]): Promise<DeliveryResult> {
      for (const i of items) seen.push(i.event.eventId);
      return { results: items.map((i) => ({ eventId: i.event.eventId, ok: true })) };
    },
    async health() { return { ok: true }; },
    async close() { /* */ },
  };
  return sink;
}

describe('hub delivery engine', () => {
  it('delivers in partition order and skips duplicate eventId', async () => {
    const store = createMemoryHubStore();
    const sink = recordingSink('log');
    const engine = createDeliveryEngine({
      config: defaultHubConfig,
      store,
      sinks: new Map([['log', sink], ['omni_pg', sink], ['agent_ws', sink]]),
      log: silent,
      metrics: createHubMetrics(),
    });
    const a = event('00000000-0000-4000-8000-00000000000a', 'voicemail:1', 1);
    const b = event('00000000-0000-4000-8000-00000000000b', 'voicemail:1', 2);
    await engine.submit(a);
    await engine.submit(b);
    await engine.submit(a);
    await engine.drain();
    expect(sink.seen.filter((id) => id === a.eventId)).toHaveLength(3);
    expect(sink.seen.filter((id) => id === b.eventId)).toHaveLength(3);
    expect(sink.seen.slice(0, 3).every((id) => id === a.eventId)).toBe(true);
    expect(sink.seen.slice(3).every((id) => id === b.eventId)).toBe(true);
    const d = await store.getDelivery(a.eventId, 'log');
    expect(d?.status).toBe('succeeded');
    await engine.close();
  });

  it('retries retryable errors then succeeds', async () => {
    const store = createMemoryHubStore();
    let n = 0;
    const flaky: SinkAdapter = {
      name: 'log',
      capabilities: { batch: true, maxBatchSize: 1, transactional: true, ordered: true },
      async init() { /* */ },
      async deliver(items) {
        n += 1;
        if (n < 3) throw new HubDeliveryError('temp', 'retryable');
        return { results: items.map((i) => ({ eventId: i.event.eventId, ok: true })) };
      },
      async health() { return { ok: true }; },
      async close() { /* */ },
    };
    const cfg = {
      ...defaultHubConfig,
      routes: [{ name: 'only-log', match: { eventType: ['icc.*'] }, sinks: ['log'], transform: 'passthrough', onError: 'dlq' as const }],
      delivery: { ...defaultHubConfig.delivery, retryBaseMs: 5, retryMaxMs: 20, maxAttempts: 5 },
    };
    const engine = createDeliveryEngine({
      config: cfg,
      store,
      sinks: new Map([['log', flaky]]),
      log: silent,
      metrics: createHubMetrics(),
    });
    await engine.submit(event('00000000-0000-4000-8000-00000000000c', 'voicemail:9'));
    await engine.drain();
    expect(n).toBe(3);
    expect((await store.getDelivery('00000000-0000-4000-8000-00000000000c', 'log'))?.status).toBe('succeeded');
    await engine.close();
  });

  it('sends fatal transform errors to DLQ without retry storm', async () => {
    const store = createMemoryHubStore();
    const sink = recordingSink('log');
    const cfg = {
      ...defaultHubConfig,
      transforms: {
        boom: { kind: 'mapping' as const, fields: { x: { expr: '$.payload.nope', required: true } } },
      },
      routes: [{ name: 'bad', match: { eventType: ['icc.*'] }, sinks: ['log'], transform: 'boom', onError: 'dlq' as const }],
    };
    const engine = createDeliveryEngine({
      config: cfg,
      store,
      sinks: new Map([['log', sink]]),
      log: silent,
      metrics: createHubMetrics(),
    });
    await engine.submit(event('00000000-0000-4000-8000-00000000000d', 'voicemail:8'));
    await engine.drain();
    expect(sink.seen).toEqual([]);
    expect((await store.getDelivery('00000000-0000-4000-8000-00000000000d', 'log'))?.status).toBe('dlq');
    expect(await store.countDlq()).toBe(1);
    await engine.close();
  });

  it('does not block a healthy sink when another sink is failing', async () => {
    const store = createMemoryHubStore();
    const good = recordingSink('good');
    const bad: SinkAdapter = {
      name: 'bad',
      capabilities: { batch: true, maxBatchSize: 1, transactional: false, ordered: false },
      async init() { /* */ },
      async deliver() {
        await new Promise((r) => setTimeout(r, 40));
        throw new HubDeliveryError('down', 'retryable');
      },
      async health() { return { ok: false }; },
      async close() { /* */ },
    };
    const cfg = {
      ...defaultHubConfig,
      routes: [{
        name: 'both',
        match: { eventType: ['icc.*'] },
        sinks: ['bad', 'good'],
        transform: 'passthrough' as const,
        onError: 'dlq' as const,
      }],
      delivery: { ...defaultHubConfig.delivery, retryBaseMs: 20, retryMaxMs: 40, maxAttempts: 3, circuitFailureThreshold: 8 },
    };
    const engine = createDeliveryEngine({
      config: cfg,
      store,
      sinks: new Map([['bad', bad], ['good', good]]),
      log: silent,
      metrics: createHubMetrics(),
    });
    const ev = event('00000000-0000-4000-8000-00000000000e', 'voicemail:iso');
    await engine.submit(ev);
    await engine.drain();
    expect(good.seen).toEqual([ev.eventId]);
    expect((await store.getDelivery(ev.eventId, 'good'))?.status).toBe('succeeded');
    expect((await store.getDelivery(ev.eventId, 'bad'))?.status).toBe('dlq');
    await engine.close();
  });

  it('replays a DLQ row onto a recovered sink', async () => {
    const store = createMemoryHubStore();
    let fail = true;
    const flaky: SinkAdapter = {
      name: 'http',
      capabilities: { batch: true, maxBatchSize: 1, transactional: false, ordered: false },
      async init() { /* */ },
      async deliver(items) {
        if (fail) throw new HubDeliveryError('boom', 'fatal', 400);
        return { results: items.map((i) => ({ eventId: i.event.eventId, ok: true })) };
      },
      async health() { return { ok: true }; },
      async close() { /* */ },
    };
    const cfg = {
      ...defaultHubConfig,
      routes: [{ name: 'h', match: { eventType: ['icc.*'] }, sinks: ['http'], transform: 'passthrough' as const, onError: 'dlq' as const }],
    };
    const engine = createDeliveryEngine({
      config: cfg,
      store,
      sinks: new Map([['http', flaky]]),
      log: silent,
      metrics: createHubMetrics(),
    });
    const ev = event('00000000-0000-4000-8000-00000000000f', 'voicemail:rp');
    await engine.submit(ev);
    await engine.drain();
    expect((await store.getDelivery(ev.eventId, 'http'))?.status).toBe('dlq');
    const rows = await store.listDlq();
    expect(rows).toHaveLength(1);
    fail = false;
    await engine.replayToSink(ev, 'http');
    expect((await store.getDelivery(ev.eventId, 'http'))?.status).toBe('succeeded');
    await store.markDlqReplayed(rows[0]!.id!);
    expect(await store.countDlq()).toBe(0);
    await engine.close();
  });
});
