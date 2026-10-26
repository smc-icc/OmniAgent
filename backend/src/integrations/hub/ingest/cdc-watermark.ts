import type { HubCdcConfig } from '../config/schema.js';
import type { OutboxExec } from './outbox.source.js';
import { quoteIdent, rowField, asPlainRow } from './ident.js';
import type { CdcChange, CdcCursor, CdcReader } from './cdc.source.js';

/**
 * native 驱动在未注入 binlog reader 时的退化实现：按 subjectId 水位扫 INSERT。
 * 看不到原地 UPDATE/DELETE；真 binlog 请注入 CdcReader。
 */
export function createWatermarkCdcReader(opts: {
  db: OutboxExec;
  config: HubCdcConfig;
  getOffset: () => Promise<Record<string, unknown> | null>;
}): CdcReader {
  const tables = Object.entries(opts.config.tables);

  function tablesFrom(raw: Record<string, unknown> | null): Record<string, string> {
    const t = raw?.tables;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return {};
    return Object.fromEntries(Object.entries(t as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }

  return {
    async start() { /* 每轮从 store 读水位 */ },
    async next(batchSize) {
      const offset = tablesFrom(await opts.getOffset());
      const out: CdcChange[] = [];
      for (const [table, spec] of tables) {
        if (!spec.insert) continue;
        if (out.length >= batchSize) break;
        const ident = quoteIdent(table, 'table');
        const col = quoteIdent(spec.subjectId, 'column');
        const last = offset[table] ?? '0';
        const rows = await opts.db.query<Record<string, unknown>>(
          `SELECT * FROM ${ident} WHERE ${col} > ? ORDER BY ${col} ASC LIMIT ?`,
          [last, batchSize - out.length],
        );
        for (const row of rows) {
          const plain = asPlainRow(row);
          const subject = rowField(plain, spec.subjectId);
          if (subject == null) continue;
          const nextTables = { ...offset, [table]: String(subject) };
          offset[table] = String(subject);
          out.push({
            table,
            op: 'insert',
            after: plain,
            cursor: { tables: nextTables } satisfies CdcCursor,
          });
        }
      }
      return out;
    },
    async stop() { /* no-op */ },
  };
}
