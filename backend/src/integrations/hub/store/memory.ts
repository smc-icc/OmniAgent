export type DeliveryStatus = 'pending' | 'succeeded' | 'failed' | 'dlq';

export interface DeliveryRow {
  eventId: string;
  sink: string;
  status: DeliveryStatus;
  attempts: number;
  lastError?: string | null;
}

export interface DlqRow {
  id?: number;
  eventId: string;
  sink: string;
  event: unknown;
  error: string;
  createdAt?: Date;
  replayedAt?: Date | null;
}

export interface HubStore {
  getOffset(sourceKey: string): Promise<Record<string, unknown> | null>;
  setOffset(sourceKey: string, cursor: Record<string, unknown>): Promise<void>;
  getDelivery(eventId: string, sink: string): Promise<DeliveryRow | null>;
  listDeliveriesForEvents(eventIds: string[]): Promise<DeliveryRow[]>;
  upsertDelivery(row: DeliveryRow): Promise<void>;
  insertDlq(row: DlqRow): Promise<void>;
  countDlq(): Promise<number>;
  listDlq(opts?: { sink?: string; limit?: number }): Promise<DlqRow[]>;
  getDlq(id: number): Promise<DlqRow | null>;
  markDlqReplayed(id: number): Promise<void>;
}

export function createMemoryHubStore(): HubStore {
  const offsets = new Map<string, Record<string, unknown>>();
  const deliveries = new Map<string, DeliveryRow>();
  const dlq: DlqRow[] = [];
  let nextDlqId = 1;
  const key = (eventId: string, sink: string) => `${eventId}::${sink}`;
  return {
    async getOffset(sourceKey) { return offsets.get(sourceKey) ?? null; },
    async setOffset(sourceKey, cursor) { offsets.set(sourceKey, cursor); },
    async getDelivery(eventId, sink) { return deliveries.get(key(eventId, sink)) ?? null; },
    async listDeliveriesForEvents(eventIds) {
      const want = new Set(eventIds);
      return [...deliveries.values()].filter((d) => want.has(d.eventId));
    },
    async upsertDelivery(row) { deliveries.set(key(row.eventId, row.sink), { ...row }); },
    async insertDlq(row) { dlq.push({ ...row, id: nextDlqId++, createdAt: new Date(), replayedAt: null }); },
    async countDlq() { return dlq.filter((r) => !r.replayedAt).length; },
    async listDlq(opts) {
      const limit = opts?.limit ?? 100;
      return dlq
        .filter((r) => !r.replayedAt && (!opts?.sink || r.sink === opts.sink))
        .slice(-limit)
        .reverse();
    },
    async getDlq(id) { return dlq.find((r) => r.id === id) ?? null; },
    async markDlqReplayed(id) {
      const row = dlq.find((r) => r.id === id);
      if (row) row.replayedAt = new Date();
    },
  };
}
