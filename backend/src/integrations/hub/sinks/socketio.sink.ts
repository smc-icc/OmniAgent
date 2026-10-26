import type { DeliveryItem, DeliveryResult, SinkAdapter } from './sink.js';
import type { BusinessEvent } from '../contract/event.js';

export function voicemailSocketPayload(event: BusinessEvent): Record<string, unknown> {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    leavewordId: event.subject.id,
    callerNumber: p.callerNumber ?? null,
    duration: p.duration ?? 0,
    vdnId: event.tenant.vdnId,
    occurredAt: event.occurredAt,
  };
}

/** 由 plugins/hub.ts 注入 emit；core 不引用 Fastify / modules。 */
export function createSocketIoSink(opts: {
  name?: string;
  emit: (eventName: string, payload: unknown) => void;
}): SinkAdapter {
  const name = opts.name ?? 'agent_ws';
  return {
    name,
    capabilities: { batch: true, maxBatchSize: 50, transactional: false, ordered: false },
    async init() { /* io owned by app */ },
    async deliver(items: DeliveryItem[]): Promise<DeliveryResult> {
      const results: DeliveryResult['results'] = [];
      for (const item of items) {
        try {
          opts.emit('voicemail.created', voicemailSocketPayload(item.event));
          results.push({ eventId: item.event.eventId, ok: true });
        } catch (err) {
          results.push({
            eventId: item.event.eventId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            retryable: true,
          });
        }
      }
      return { results };
    },
    async health() { return { ok: true }; },
    async close() { /* io owned by app */ },
  };
}
