/** Hub 内部标准业务事件。摄取源归一化后只流转此结构。 */

export type HubComponent = 'ivr' | 'ccs' | 'acd' | 'tas' | 'fucus' | 'hub';

export interface BusinessEvent<P = unknown> {
  /** 全局唯一，幂等键。生产方生成（UUIDv7 优先） */
  eventId: string;
  /** 语义化类型：icc.<domain>.<action> */
  eventType: string;
  /** payload 结构版本，只增不改 */
  eventVersion: number;
  /** 业务发生时间（ICC 侧），ISO8601 */
  occurredAt: string;
  source: {
    system: 'icc';
    component: HubComponent;
    nodeId?: string;
  };
  tenant: {
    vdnId: number;
    orgId?: string;
  };
  subject: { type: string; id: string };
  /** 保序键：同一 key 严格按序投递 */
  partitionKey: string;
  payload: P;
  trace?: {
    traceId?: string;
    correlationId?: string;
    causationId?: string;
  };
}

export function isBusinessEvent(value: unknown): value is BusinessEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.eventId === 'string' &&
    typeof v.eventType === 'string' &&
    typeof v.eventVersion === 'number' &&
    typeof v.occurredAt === 'string' &&
    typeof v.partitionKey === 'string' &&
    !!v.source &&
    typeof v.source === 'object' &&
    !!v.tenant &&
    typeof v.tenant === 'object' &&
    !!v.subject &&
    typeof v.subject === 'object'
  );
}
