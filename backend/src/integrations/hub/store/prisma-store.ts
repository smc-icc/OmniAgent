import { Prisma, type PrismaClient } from '@prisma/client';
import type { DeliveryRow, DlqRow, HubStore } from './memory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPrismaHubStore(prisma: PrismaClient): HubStore {
  return {
    async getOffset(sourceKey) {
      const rows = await prisma.$queryRaw<Array<{ cursor: unknown }>>`
        SELECT cursor FROM hub.ingest_offset WHERE source_key = ${sourceKey}
      `;
      if (!rows.length) return null;
      return (rows[0].cursor ?? null) as Record<string, unknown> | null;
    },
    async setOffset(sourceKey, cursor) {
      const json = JSON.stringify(cursor);
      await prisma.$executeRaw`
        INSERT INTO hub.ingest_offset(source_key, cursor, updated_at)
        VALUES (${sourceKey}, ${json}::jsonb, now())
        ON CONFLICT (source_key) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()
      `;
    },
    async getDelivery(eventId, sink) {
      const rows = await prisma.$queryRaw<Array<{
        event_id: string;
        sink: string;
        status: DeliveryRow['status'];
        attempts: number;
        last_error: string | null;
      }>>`
        SELECT event_id, sink, status, attempts, last_error
        FROM hub.delivery
        WHERE event_id = ${eventId}::uuid AND sink = ${sink}
      `;
      if (!rows.length) return null;
      const r = rows[0];
      return {
        eventId: r.event_id,
        sink: r.sink,
        status: r.status,
        attempts: r.attempts,
        lastError: r.last_error,
      };
    },
    async listDeliveriesForEvents(eventIds) {
      const ids = [...new Set(eventIds)].filter((id) => UUID_RE.test(id));
      if (!ids.length) return [];
      const rows = await prisma.$queryRaw<Array<{
        event_id: string;
        sink: string;
        status: DeliveryRow['status'];
        attempts: number;
        last_error: string | null;
      }>>`
        SELECT event_id, sink, status, attempts, last_error
        FROM hub.delivery
        WHERE event_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      `;
      return rows.map((r) => ({
        eventId: r.event_id,
        sink: r.sink,
        status: r.status,
        attempts: r.attempts,
        lastError: r.last_error,
      }));
    },
    async upsertDelivery(row) {
      await prisma.$executeRaw`
        INSERT INTO hub.delivery(event_id, sink, status, attempts, last_error, first_seen, updated_at)
        VALUES (${row.eventId}::uuid, ${row.sink}, ${row.status}, ${row.attempts}, ${row.lastError ?? null}, now(), now())
        ON CONFLICT (event_id, sink) DO UPDATE SET
          status = EXCLUDED.status,
          attempts = EXCLUDED.attempts,
          last_error = EXCLUDED.last_error,
          updated_at = now()
      `;
    },
    async insertDlq(row) {
      await prisma.$executeRaw`
        INSERT INTO hub.dlq(event_id, sink, event, error)
        VALUES (${row.eventId}::uuid, ${row.sink}, ${JSON.stringify(row.event)}::jsonb, ${row.error})
      `;
    },
    async countDlq() {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM hub.dlq WHERE replayed_at IS NULL`;
      return Number(rows[0]?.n ?? 0);
    },
    async listDlq(opts) {
      const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
      const sink = opts?.sink;
      const rows = sink
        ? await prisma.$queryRaw<Array<{
          id: bigint; event_id: string; sink: string; event: unknown; error: string;
          created_at: Date; replayed_at: Date | null;
        }>>`
          SELECT id, event_id, sink, event, error, created_at, replayed_at
          FROM hub.dlq WHERE replayed_at IS NULL AND sink = ${sink}
          ORDER BY id DESC LIMIT ${limit}
        `
        : await prisma.$queryRaw<Array<{
          id: bigint; event_id: string; sink: string; event: unknown; error: string;
          created_at: Date; replayed_at: Date | null;
        }>>`
          SELECT id, event_id, sink, event, error, created_at, replayed_at
          FROM hub.dlq WHERE replayed_at IS NULL
          ORDER BY id DESC LIMIT ${limit}
        `;
      return rows.map((r) => ({
        id: Number(r.id),
        eventId: r.event_id,
        sink: r.sink,
        event: r.event,
        error: r.error,
        createdAt: r.created_at,
        replayedAt: r.replayed_at,
      }));
    },
    async getDlq(id) {
      const rows = await prisma.$queryRaw<Array<{
        id: bigint; event_id: string; sink: string; event: unknown; error: string;
        created_at: Date; replayed_at: Date | null;
      }>>`
        SELECT id, event_id, sink, event, error, created_at, replayed_at
        FROM hub.dlq WHERE id = ${id}
      `;
      if (!rows.length) return null;
      const r = rows[0];
      return {
        id: Number(r.id),
        eventId: r.event_id,
        sink: r.sink,
        event: r.event,
        error: r.error,
        createdAt: r.created_at,
        replayedAt: r.replayed_at,
      };
    },
    async markDlqReplayed(id) {
      await prisma.$executeRaw`UPDATE hub.dlq SET replayed_at = now() WHERE id = ${id}`;
    },
  };
}
