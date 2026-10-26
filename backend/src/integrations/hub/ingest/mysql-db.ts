import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { OutboxDb, OutboxExec, OutboxRow } from './outbox.source.js';

type Queryable = Pick<Pool, 'query'> | Pick<PoolConnection, 'query'>;

export function createMysqlOutboxDb(pool: Pool): OutboxDb {
  const execFrom = (conn: Queryable): OutboxExec => ({
    async query<T = OutboxRow>(sql: string, params: unknown[]) {
      const [rows] = await conn.query(sql, params);
      return rows as T[];
    },
    async execute(sql: string, params: unknown[]) {
      const [res] = await conn.query(sql, params);
      return Number((res as ResultSetHeader).affectedRows ?? 0);
    },
  });

  const pooled = execFrom(pool);
  return {
    query: pooled.query,
    execute: pooled.execute,
    async version() {
      const rows = await pooled.query<RowDataPacket & { v: string }>('SELECT VERSION() AS v', []);
      return String(rows[0]?.v ?? '');
    },
    async withTransaction(fn) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await fn(execFrom(conn));
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => undefined);
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}
