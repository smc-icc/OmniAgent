import type { BusinessEvent } from '../contract/event.js';

export interface SinkCapabilities {
  batch: boolean;
  maxBatchSize: number;
  transactional: boolean;
  ordered: boolean;
}

export interface DeliveryItem {
  event: BusinessEvent;
  record: Record<string, unknown>;
  sinkName: string;
}

export interface ItemDeliveryResult {
  eventId: string;
  ok: boolean;
  error?: string;
  retryable?: boolean;
}

export interface DeliveryResult {
  results: ItemDeliveryResult[];
}

export interface SinkAdapter {
  readonly name: string;
  readonly capabilities: SinkCapabilities;
  init(): Promise<void>;
  deliver(items: DeliveryItem[]): Promise<DeliveryResult>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
}

export interface HubLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
  debug?(obj: object, msg: string): void;
}
