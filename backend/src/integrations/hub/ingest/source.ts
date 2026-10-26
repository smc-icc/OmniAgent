export interface Cursor {
  id?: string | number;
  [k: string]: unknown;
}

export interface RawIngestRecord {
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
  cursor: Cursor;
}

export interface SourceHealth {
  ok: boolean;
  detail?: string;
  backlog?: number;
  oldestSeconds?: number;
}

export interface IngestSource {
  readonly kind: 'outbox' | 'cdc' | 'mq' | 'legacy_sync';
  start(emit: (raw: RawIngestRecord[]) => Promise<void>): Promise<void>;
  commit(cursor: Cursor): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<SourceHealth>;
}
