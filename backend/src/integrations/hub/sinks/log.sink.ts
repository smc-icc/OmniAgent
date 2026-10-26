import type { DeliveryItem, DeliveryResult, HubLogger, SinkAdapter, SinkCapabilities } from './sink.js';

export function createLogSink(log: HubLogger, name = 'log'): SinkAdapter {
  return {
    name,
    capabilities: { batch: true, maxBatchSize: 1000, transactional: true, ordered: false } satisfies SinkCapabilities,
    async init() { /* no-op */ },
    async deliver(items: DeliveryItem[]): Promise<DeliveryResult> {
      for (const item of items) {
        log.info({
          eventId: item.event.eventId,
          eventType: item.event.eventType,
          sink: name,
          subject: item.event.subject,
        }, 'hub event (log sink)');
      }
      return { results: items.map((i) => ({ eventId: i.event.eventId, ok: true })) };
    },
    async health() { return { ok: true }; },
    async close() { /* no-op */ },
  };
}
