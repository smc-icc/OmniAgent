import type { HubSinkConfig } from '../config/schema.js';
import { hashMod } from '../core/hash.js';
import { HubDeliveryError } from '../core/errors.js';
import type { DeliveryItem, DeliveryResult, SinkAdapter } from './sink.js';

export interface MqPublishRequest {
  topic: string;
  partition: number;
  key: string;
  payload: string;
  eventId: string;
}

export interface MqPublisher {
  publish(req: MqPublishRequest): Promise<void>;
  ping?(): Promise<void>;
  close(): Promise<void>;
}

export function mqPartitionFor(partitionKey: string, partitions: number): number {
  return hashMod(partitionKey, partitions);
}

export function createMemoryMqPublisher(): MqPublisher & {
  published: MqPublishRequest[];
} {
  const published: MqPublishRequest[] = [];
  return {
    published,
    async publish(req) { published.push({ ...req }); },
    async ping() { /* */ },
    async close() { /* */ },
  };
}

export function createMqSink(opts: {
  spec: HubSinkConfig;
  name: string;
  publisher?: MqPublisher;
}): SinkAdapter {
  const spec = opts.spec;
  const driver = spec.driver ?? 'redis-streams';
  const topic = spec.topic ?? spec.url ?? 'icc.events';
  const partitions = spec.partitions ?? 16;
  let publisher = opts.publisher;
  let owned = false;

  return {
    name: opts.name,
    capabilities: { batch: true, maxBatchSize: spec.batch?.maxSize ?? 100, transactional: false, ordered: true },
    async init() {
      if (publisher) return;
      if (driver !== 'redis-streams') {
        throw new Error(`mq sink ${opts.name} driver=${driver} 需注入 publisher（kafka/rabbitmq 未内置）`);
      }
      const url = spec.url;
      if (!url) throw new Error(`mq sink ${opts.name} 缺少 url`);
      const { default: Redis } = await import('ioredis');
      const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true, enableReadyCheck: false });
      await redis.connect();
      publisher = {
        async publish(req) {
          const stream = `${req.topic}:${req.partition}`;
          await redis.xadd(stream, '*', 'payload', req.payload, 'key', req.key, 'eventId', req.eventId, 'partition', String(req.partition));
        },
        async ping() { await redis.ping(); },
        async close() { await redis.quit(); },
      };
      owned = true;
    },
    async deliver(items: DeliveryItem[]): Promise<DeliveryResult> {
      if (!publisher) throw new HubDeliveryError('mq publisher 未初始化', 'fatal');
      const results: DeliveryResult['results'] = [];
      for (const item of items) {
        try {
          const key = item.event.partitionKey;
          const partition = mqPartitionFor(key, partitions);
          await publisher.publish({
            topic,
            partition,
            key,
            payload: JSON.stringify(item.event),
            eventId: item.event.eventId,
          });
          results.push({ eventId: item.event.eventId, ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (items.length === 1) throw new HubDeliveryError(msg, 'retryable');
          results.push({ eventId: item.event.eventId, ok: false, error: msg, retryable: true });
        }
      }
      return { results };
    },
    async health() {
      try {
        await publisher?.ping?.();
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
    async close() {
      if (owned) await publisher?.close();
    },
  };
}
