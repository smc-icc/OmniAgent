import type { HubMqIngestConfig } from '../config/schema.js';
import type { Cursor, IngestSource, RawIngestRecord, SourceHealth } from './source.js';

export interface MqMessage {
  id: string;
  topic: string;
  body: unknown;
  cursor: Cursor;
}

export interface MqConsumer {
  read(max: number): Promise<MqMessage[]>;
  ack(id: string, topic: string): Promise<void>;
  stop(): Promise<void>;
}

/** 单测用：未 ack 的消息会再投（模拟 PEL）。 */
export function createMemoryMqConsumer(initial: MqMessage[] = []): MqConsumer & {
  push(msg: MqMessage): void;
  acked: string[];
} {
  const pending: MqMessage[] = [...initial];
  const inFlight: MqMessage[] = [];
  const acked: string[] = [];
  return {
    acked,
    push(msg) { pending.push(msg); },
    async read(max) {
      if (inFlight.length) return inFlight.slice(0, max);
      const batch = pending.splice(0, max);
      inFlight.push(...batch);
      return batch;
    },
    async ack(id) {
      const i = inFlight.findIndex((m) => m.id === id);
      if (i >= 0) inFlight.splice(i, 1);
      acked.push(id);
    },
    async stop() { /* no-op */ },
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function parseBody(body: unknown): unknown {
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return { raw: body }; }
  }
  return body;
}

export function toRawFromMq(msg: MqMessage): RawIngestRecord {
  const parsed = parseBody(msg.body);
  const rec = asRecord(parsed) ?? { value: parsed };
  const nested = asRecord(rec.payload) ?? rec;
  const eventType = String(rec.eventType ?? nested.eventType ?? 'icc.unknown');
  const eventId = String(rec.eventId ?? `mq:${msg.topic}:${msg.id}`);
  const parts = eventType.split('.');
  const aggregateType = String(rec.aggregateType ?? nested.aggregateType ?? (parts[1] ?? 'event'));
  const aggregateId = String(rec.aggregateId ?? rec.subjectId ?? nested.id ?? msg.id);
  const subject = asRecord(rec.subject);
  const tenant = asRecord(rec.tenant);
  const vdn = rec.vdnId ?? nested.vdnId ?? tenant?.vdnId ?? 0;
  const occurred = rec.occurredAt ?? nested.occurredAt ?? new Date();
  return {
    eventId,
    eventType,
    eventVersion: Number(rec.eventVersion ?? 1),
    aggregateType,
    aggregateId: subject?.id != null ? String(subject.id) : aggregateId,
    partitionKey: rec.partitionKey != null ? String(rec.partitionKey) : `${aggregateType}:${aggregateId}`,
    vdnId: Number(vdn ?? 0) || 0,
    sourceComponent: String(asRecord(rec.source)?.component ?? rec.sourceComponent ?? 'hub'),
    payload: rec.payload ?? nested,
    occurredAt: occurred as string | Date,
    cursor: { id: msg.id, topic: msg.topic, ...msg.cursor },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createMqSource(opts: {
  consumer: MqConsumer;
  config: HubMqIngestConfig;
  shouldPause?: () => boolean;
  onHealth?: (h: SourceHealth) => void;
}): IngestSource {
  let stopped = false;
  let emitFn: ((raw: RawIngestRecord[]) => Promise<void>) | undefined;
  let lastHealth: SourceHealth = { ok: true };
  const pollIntervalMs = 10;
  const idleMaxMs = Math.max(opts.config.blockMs ?? 50, 50);
  const batchSize = opts.config.maxInFlight ?? 100;
  let idleMs = pollIntervalMs;

  async function pollOnce(): Promise<number> {
    if (opts.shouldPause?.()) return 0;
    const msgs = await opts.consumer.read(batchSize);
    if (!msgs.length) return 0;
    await emitFn?.(msgs.map(toRawFromMq));
    return msgs.length;
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
    kind: 'mq',
    async start(emit) {
      emitFn = emit;
      stopped = false;
      void loop();
    },
    async commit(cursor: Cursor) {
      const id = cursor.id != null ? String(cursor.id) : '';
      const topic = cursor.topic != null ? String(cursor.topic) : '';
      if (id) await opts.consumer.ack(id, topic);
    },
    async stop() {
      stopped = true;
      await opts.consumer.stop();
    },
    async health() { return lastHealth; },
  };
}

export interface RedisStreamClient {
  xgroup(...args: unknown[]): Promise<unknown>;
  xreadgroup(...args: unknown[]): Promise<unknown>;
  xack(stream: string, group: string, ...ids: string[]): Promise<unknown>;
  xautoclaim?(...args: unknown[]): Promise<unknown>;
  connect?(): Promise<unknown>;
  quit?(): Promise<unknown>;
  disconnect?(): void;
}

function fieldsToObject(fields: unknown): Record<string, string> {
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    return Object.fromEntries(Object.entries(fields as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  const arr = Array.isArray(fields) ? fields : [];
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < arr.length; i += 2) {
    out[String(arr[i])] = String(arr[i + 1]);
  }
  return out;
}

function parseXread(res: unknown): MqMessage[] {
  if (!res) return [];
  const streams = Array.isArray(res) ? res : [];
  const out: MqMessage[] = [];
  for (const streamEntry of streams) {
    if (!Array.isArray(streamEntry) || streamEntry.length < 2) continue;
    const topic = String(streamEntry[0]);
    const entries = Array.isArray(streamEntry[1]) ? streamEntry[1] : [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const id = String(entry[0]);
      const fields = fieldsToObject(entry[1]);
      const raw = fields.payload ?? fields.data ?? fields.event ?? JSON.stringify(fields);
      let body: unknown = raw;
      if (typeof raw === 'string') {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }
      out.push({ id, topic, body, cursor: { id, topic } });
    }
  }
  return out;
}

function parseAutoclaim(res: unknown, topic: string): MqMessage[] {
  if (!Array.isArray(res) || res.length < 2) return [];
  const entries = Array.isArray(res[1]) ? res[1] : [];
  const fakeXread = [[topic, entries]];
  return parseXread(fakeXread);
}

export async function createRedisStreamConsumer(opts: {
  config: HubMqIngestConfig;
  redis?: RedisStreamClient;
}): Promise<MqConsumer> {
  const url = opts.config.url;
  let redis = opts.redis;
  let owned = false;
  if (!redis) {
    if (!url) throw new Error('ingest.mq.url 未配置且未注入 redis');
    const { default: Redis } = await import('ioredis');
    redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      lazyConnect: true,
    }) as unknown as RedisStreamClient;
    owned = true;
    await redis.connect?.();
  }
  const group = opts.config.consumerGroup;
  const consumer = opts.config.consumerName ?? 'icc-hub';
  const topics = opts.config.topics.length ? opts.config.topics : ['icc.events'];
  const blockMs = opts.config.blockMs ?? 50;
  const claimIdleMs = opts.config.claimIdleMs ?? 120_000;

  for (const topic of topics) {
    try {
      await redis.xgroup('CREATE', topic, group, '$', 'MKSTREAM');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/BUSYGROUP/i.test(msg)) throw err;
    }
  }

  const client = redis;
  return {
    async read(max) {
      const pendingArgs: unknown[] = ['GROUP', group, consumer, 'COUNT', max, 'STREAMS', ...topics, ...topics.map(() => '0')];
      const pending = parseXread(await client.xreadgroup(...pendingArgs));
      if (pending.length) return pending;
      if (typeof client.xautoclaim === 'function') {
        for (const topic of topics) {
          try {
            const claimed = parseAutoclaim(
              await client.xautoclaim(topic, group, consumer, String(claimIdleMs), '0-0', 'COUNT', max),
              topic,
            );
            if (claimed.length) return claimed;
          } catch {
            /* Redis < 6.2 无 XAUTOCLAIM */
          }
        }
      }
      const freshArgs: unknown[] = ['GROUP', group, consumer, 'COUNT', max, 'BLOCK', blockMs, 'STREAMS', ...topics, ...topics.map(() => '>')];
      return parseXread(await client.xreadgroup(...freshArgs));
    },
    async ack(id, topic) {
      const stream = topic || topics[0]!;
      await client.xack(stream, group, id);
    },
    async stop() {
      if (owned) await client.quit?.();
    },
  };
}
