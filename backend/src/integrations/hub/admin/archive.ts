import type { DeliveryRow, HubStore } from '../store/memory.js';
import type { OutboxDb, OutboxRow } from '../ingest/outbox.source.js';

export interface ArchiveReport {
  scanned: number;
  archived: number;
  skippedNotSucceeded: number;
  skippedNoDelivery: number;
  archivePurged: number;
  errors: string[];
}

const OUTBOX_COLS = `ID, EventId, EventType, EventVersion, AggregateType, AggregateId, PartitionKey,
                VdnId, SourceComponent, SourceNodeId, Payload, OccurredAt, CreateTime`;

const INSERT_ARCHIVE = `INSERT IGNORE INTO t_icc_outbox_event_archive
  (${OUTBOX_COLS})
  SELECT ${OUTBOX_COLS}
  FROM t_icc_outbox_event WHERE ID = ?`;

export function localYmd(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 本地时区指定时刻起 `windowMinutes` 分钟内，每天只跑一次。 */
export function shouldRunDailyAt(
  now: Date,
  hour: number,
  minute: number,
  lastRunYmd: string | null,
  windowMinutes = 10,
): boolean {
  if (now.getHours() !== hour) return false;
  const m = now.getMinutes();
  if (m < minute || m >= minute + windowMinutes) return false;
  return localYmd(now) !== lastRunYmd;
}

/** 本地时区 `archiveHour` 点的前 10 分钟窗口，每天只跑一次。 */
export function shouldRunDailyArchive(now: Date, hour: number, lastRunYmd: string | null): boolean {
  return shouldRunDailyAt(now, hour, 0, lastRunYmd, 10);
}

export function previousYmd(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return localYmd(d);
}

/** 仅当该事件在 Hub 的每一条 delivery 都是 succeeded 时才允许归档。无记录 / DLQ / pending 一律拒绝。 */
export function deliveriesReadyToArchive(rows: DeliveryRow[]): boolean {
  if (!rows.length) return false;
  return rows.every((r) => r.status === 'succeeded');
}

export async function archiveOutbox(opts: {
  db: OutboxDb;
  store: HubStore;
  retentionDays: number;
  batchSize?: number;
  log?: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void };
}): Promise<ArchiveReport> {
  const batchSize = Math.max(1, opts.batchSize ?? 500);
  const report: ArchiveReport = {
    scanned: 0,
    archived: 0,
    skippedNotSucceeded: 0,
    skippedNoDelivery: 0,
    archivePurged: 0,
    errors: [],
  };

  let more = true;
  while (more) {
    let rows: OutboxRow[];
    try {
      rows = await opts.db.query<OutboxRow>(
        `SELECT ${OUTBOX_COLS}
         FROM t_icc_outbox_event
         WHERE ConsumedAt IS NOT NULL
           AND CreateTime < DATE_SUB(NOW(3), INTERVAL ? DAY)
         ORDER BY ID
         LIMIT ?`,
        [opts.retentionDays, batchSize],
      );
    } catch (err) {
      report.errors.push(err instanceof Error ? err.message : String(err));
      break;
    }
    if (!rows.length) {
      more = false;
      break;
    }
    report.scanned += rows.length;
    const ids = rows.map((r) => String(r.EventId));
    const deliveries = await opts.store.listDeliveriesForEvents(ids);
    const byEvent = new Map<string, DeliveryRow[]>();
    for (const d of deliveries) {
      const list = byEvent.get(d.eventId) ?? [];
      list.push(d);
      byEvent.set(d.eventId, list);
    }

    let moved = 0;
    for (const row of rows) {
      const eventId = String(row.EventId);
      const drows = byEvent.get(eventId) ?? [];
      if (!drows.length) {
        report.skippedNoDelivery += 1;
        continue;
      }
      if (!deliveriesReadyToArchive(drows)) {
        report.skippedNotSucceeded += 1;
        continue;
      }
      try {
        await opts.db.withTransaction(async (exec) => {
          await exec.execute(INSERT_ARCHIVE, [row.ID]);
          await exec.execute('DELETE FROM t_icc_outbox_event WHERE ID = ?', [row.ID]);
        });
        moved += 1;
        report.archived += 1;
      } catch (err) {
        report.errors.push(`${eventId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (moved === 0) more = false;
  }

  try {
    report.archivePurged = await opts.db.execute(
      `DELETE FROM t_icc_outbox_event_archive
       WHERE ArchivedAt < DATE_SUB(NOW(3), INTERVAL ? DAY)
       LIMIT ?`,
      [opts.retentionDays, batchSize],
    );
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err));
  }

  opts.log?.info(report, 'hub outbox archive');
  return report;
}
