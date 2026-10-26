import type { HubSinkConfig } from '../config/schema.js';
import { HubDeliveryError } from '../core/errors.js';
import { assertMysqlIdent } from '../ingest/ident.js';
import type { DeliveryItem, DeliveryResult, SinkAdapter } from './sink.js';

export interface OracleExecutor {
  executeMany(sql: string, binds: Record<string, unknown>[]): Promise<number>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteOracleIdent(name: string): string {
  const n = name.trim();
  if (!IDENT.test(n)) throw new Error(`非法 Oracle 标识符: ${name}`);
  return `"${n.toUpperCase()}"`;
}

export function bindName(col: string): string {
  assertMysqlIdent(col, 'column');
  return col.toUpperCase();
}

function scalar(v: unknown): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** MERGE INTO t USING (SELECT :COL FROM DUAL) s ON (conflict) ... */
export function buildOracleMergeSql(opts: {
  table: string;
  columns: string[];
  conflictKey: string[];
}): string {
  const table = quoteOracleIdent(opts.table);
  const cols = opts.columns.map(bindName);
  const keys = opts.conflictKey.map(bindName);
  if (!cols.length) throw new Error('oracle MERGE 无列');
  if (!keys.length) throw new Error('oracle MERGE 需要 conflictKey');
  const missing = keys.filter((k) => !cols.includes(k));
  if (missing.length) throw new Error(`conflictKey 不在记录中: ${missing.join(',')}`);
  const selectList = cols.map((c) => `:${c} AS ${quoteOracleIdent(c)}`).join(', ');
  const on = keys.map((k) => `t.${quoteOracleIdent(k)} = s.${quoteOracleIdent(k)}`).join(' AND ');
  const nonKeys = cols.filter((c) => !keys.includes(c));
  const updates = nonKeys.length
    ? nonKeys.map((c) => `t.${quoteOracleIdent(c)} = s.${quoteOracleIdent(c)}`).join(', ')
    : `${quoteOracleIdent(keys[0]!)} = s.${quoteOracleIdent(keys[0]!)}`;
  const insertCols = cols.map((c) => quoteOracleIdent(c)).join(', ');
  const insertVals = cols.map((c) => `s.${quoteOracleIdent(c)}`).join(', ');
  return [
    `MERGE INTO ${table} t`,
    `USING (SELECT ${selectList} FROM DUAL) s`,
    `ON (${on})`,
    `WHEN MATCHED THEN UPDATE SET ${updates}`,
    `WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`,
  ].join(' ');
}

export function createOracleSink(opts: {
  spec: HubSinkConfig;
  name: string;
  executor?: OracleExecutor;
}): SinkAdapter {
  const spec = opts.spec;
  const table = spec.table?.trim() || 'ICC_HUB_EVENTS';
  const conflictKey = spec.conflictKey?.length ? spec.conflictKey : ['SOURCE_EVENT_SUBJECT'];
  const maxBatch = spec.batch?.maxSize ?? 200;
  let executor = opts.executor;
  let owned = false;

  return {
    name: opts.name,
    capabilities: { batch: true, maxBatchSize: maxBatch, transactional: true, ordered: true },
    async init() {
      if (executor) return;
      try {
        const dyn = new Function('m', 'return import(m)') as (m: string) => Promise<{
          default?: { createPool: (c: Record<string, unknown>) => Promise<{ getConnection: () => Promise<OraConn>; close: () => Promise<void> }> };
          createPool?: (c: Record<string, unknown>) => Promise<{ getConnection: () => Promise<OraConn>; close: () => Promise<void> }>;
        }>;
        const oracledb = await dyn('oracledb');
        const createPool = oracledb.default?.createPool ?? oracledb.createPool;
        if (!createPool) throw new Error('oracledb.createPool 不可用');
        if (!spec.connectString || !spec.user) {
          throw new Error(`oracle sink ${opts.name} 缺少 connectString/user`);
        }
        const pool = await createPool({
          user: spec.user,
          password: spec.password,
          connectString: spec.connectString,
        });
        executor = {
          async executeMany(sql, binds) {
            const conn = await pool.getConnection();
            try {
              await conn.executeMany(sql, binds, { autoCommit: true });
              return binds.length;
            } finally {
              await conn.close();
            }
          },
          async ping() {
            const conn = await pool.getConnection();
            try { await conn.execute('SELECT 1 FROM DUAL'); }
            finally { await conn.close(); }
          },
          async close() { await pool.close(); },
        };
        owned = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`oracle sink ${opts.name} 初始化失败（需注入 executor 或安装 oracledb）: ${msg}`);
      }
    },
    async deliver(items: DeliveryItem[]): Promise<DeliveryResult> {
      if (!executor) throw new HubDeliveryError('oracle executor 未初始化', 'fatal');
      if (!items.length) return { results: [] };
      const columns = Object.keys(items[0]!.record);
      if (!columns.length) {
        return {
          results: items.map((i) => ({ eventId: i.event.eventId, ok: false, error: 'empty record', retryable: false })),
        };
      }
      let sql: string;
      try {
        sql = buildOracleMergeSql({ table, columns, conflictKey });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new HubDeliveryError(msg, 'fatal');
      }
      const binds = items.map((item) => {
        const row: Record<string, unknown> = {};
        for (const col of columns) row[bindName(col)] = scalar(item.record[col]);
        return row;
      });
      try {
        await executor.executeMany(sql, binds);
        return { results: items.map((i) => ({ eventId: i.event.eventId, ok: true })) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new HubDeliveryError(msg, 'retryable');
      }
    },
    async health() {
      try {
        await executor?.ping();
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
    async close() {
      if (owned) await executor?.close();
    },
  };
}

interface OraConn {
  executeMany(sql: string, binds: unknown[], opts?: { autoCommit?: boolean }): Promise<unknown>;
  execute(sql: string): Promise<unknown>;
  close(): Promise<void>;
}
