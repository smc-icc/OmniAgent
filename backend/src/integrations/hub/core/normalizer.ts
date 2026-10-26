import type { BusinessEvent, HubComponent } from '../contract/event.js';
import { ensureTraceId } from '../observability/tracing.js';

export interface RawRecord {
  eventId: string;
  eventType: string;
  eventVersion?: number;
  aggregateType: string;
  aggregateId: string;
  partitionKey?: string;
  vdnId?: number;
  sourceComponent?: string;
  sourceNodeId?: string;
  payload: unknown;
  occurredAt: string | Date;
  cursor?: Record<string, unknown>;
}

const COMPONENTS: HubComponent[] = ['ivr', 'ccs', 'acd', 'tas', 'fucus', 'hub'];

function asComponent(v: string | undefined): HubComponent {
  return COMPONENTS.includes(v as HubComponent) ? (v as HubComponent) : 'hub';
}

function asIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function normalizeRaw(raw: RawRecord): BusinessEvent {
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : { value: raw.payload };
  const event: BusinessEvent = {
    eventId: String(raw.eventId),
    eventType: String(raw.eventType),
    eventVersion: raw.eventVersion ?? 1,
    occurredAt: asIso(raw.occurredAt),
    source: {
      system: 'icc',
      component: asComponent(raw.sourceComponent),
      nodeId: raw.sourceNodeId,
    },
    tenant: { vdnId: Number(raw.vdnId ?? 0) },
    subject: { type: raw.aggregateType, id: String(raw.aggregateId) },
    partitionKey: raw.partitionKey || `${raw.aggregateType}:${raw.aggregateId}`,
    payload,
  };
  ensureTraceId(event);
  return event;
}
