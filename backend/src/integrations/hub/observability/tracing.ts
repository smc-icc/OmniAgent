import { randomUUID } from 'node:crypto';
import type { BusinessEvent } from '../contract/event.js';

/** 保证事件带 traceId：已有则保留，否则用 eventId（再不行才新生成）。 */
export function ensureTraceId(event: BusinessEvent): string {
  const existing = event.trace?.traceId;
  if (existing) return existing;
  const traceId = event.eventId || randomUUID();
  event.trace = { ...event.trace, traceId };
  return traceId;
}
