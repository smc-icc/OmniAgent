/**
 * 真 MySQL ROW binlog：独立连接 + COM_BINLOG_DUMP。
 * 不引入 @vlasky/mysql-binlog-connector。失败时由 runtime 回退水位。
 */
import mysql from 'mysql2/promise';
import type { HubCdcConfig } from '../config/schema.js';
import type { CdcCursor } from './cdc-map.js';
import type { CdcReader } from './cdc.source.js';
import {
  buildBinlogDumpPacket,
  EventType,
  parseDumpPayload,
  rowsEventToChanges,
  type TableMap,
} from './cdc-binlog-parse.js';

export interface BinlogReaderLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

type MysqlConn = mysql.Connection & {
  connection?: { stream: NodeJS.ReadWriteStream; _command: unknown };
};

function stealStream(conn: mysql.Connection): NodeJS.ReadWriteStream {
  const inner = (conn as MysqlConn).connection;
  if (!inner?.stream) throw new Error('mysql2 connection.stream 不可用，无法 COM_BINLOG_DUMP');
  const stream = inner.stream;
  stream.pause();
  stream.removeAllListeners('data');
  inner._command = null;
  return stream;
}

async function loadColumnNames(
  conn: mysql.Connection,
  database: string,
  tables: string[],
): Promise<Record<string, string[]>> {
  if (!tables.length) return {};
  const placeholders = tables.map(() => '?').join(',');
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, ORDINAL_POSITION AS p
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database, ...tables],
  );
  const out: Record<string, string[]> = {};
  for (const r of rows as Array<{ t: string; c: string }>) {
    (out[r.t] ??= []).push(r.c);
  }
  return out;
}

export async function createMysqlBinlogCdcReader(opts: {
  config: HubCdcConfig;
  log?: BinlogReaderLog;
}): Promise<CdcReader> {
  const host = opts.config.host || process.env.ICC_MYSQL_HOST || '127.0.0.1';
  const port = opts.config.port ?? Number(process.env.ICC_MYSQL_PORT || 3306);
  const user = opts.config.user || process.env.ICC_MYSQL_REPL_USER || process.env.ICC_MYSQL_USER || 'root';
  const password = opts.config.password ?? process.env.ICC_MYSQL_REPL_PASSWORD ?? process.env.ICC_MYSQL_PASSWORD ?? '';
  const database = opts.config.database || process.env.ICC_MYSQL_DB || 'icc';
  const serverId = opts.config.serverId ?? 65535;
  const wanted = new Set(Object.keys(opts.config.tables ?? {}));

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    connectTimeout: 10_000,
  });

  await conn.query('SET @master_binlog_checksum = @@global.binlog_checksum');
  const [checksumRows] = await conn.query('SELECT @@GLOBAL.binlog_checksum AS c');
  const checksum = String((checksumRows as Array<{ c: string }>)[0]?.c ?? 'NONE').toUpperCase();
  const checksumBytes = checksum === 'CRC32' ? 4 : 0;

  const [fmtRows] = await conn.query("SHOW VARIABLES LIKE 'binlog_format'");
  const fmt = String((fmtRows as Array<{ Value?: string; value?: string }>)[0]?.Value
    ?? (fmtRows as Array<{ Value?: string; value?: string }>)[0]?.value
    ?? '').toUpperCase();
  if (fmt && fmt !== 'ROW') {
    await conn.end().catch(() => undefined);
    throw new Error(`binlog_format=${fmt || 'unknown'}，native CDC 需要 ROW`);
  }

  const columnNames = await loadColumnNames(conn, database, [...wanted]);
  const [statusRows] = await conn.query('SHOW MASTER STATUS');
  const status = (statusRows as Array<{ File: string; Position: number; Executed_Gtid_Set?: string }>)[0];
  if (!status?.File) {
    await conn.end().catch(() => undefined);
    throw new Error('SHOW MASTER STATUS 无 File，复制未开启');
  }

  let currentFile = status.File;
  let currentPos = Number(status.Position);
  let currentGtid = status.Executed_Gtid_Set;

  const state = { checksumBytes, tableMaps: new Map<string, TableMap>() };
  const queue: ReturnType<typeof rowsEventToChanges> = [];
  let waiters: Array<() => void> = [];
  let fatal: Error | undefined;
  let stopped = false;
  let buf = Buffer.alloc(0);

  function notify() {
    const w = waiters;
    waiters = [];
    for (const fn of w) fn();
  }

  function onChunk(chunk: Buffer) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf[0]! | (buf[1]! << 8) | (buf[2]! << 16);
      if (buf.length < 4 + len) break;
      const payload = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      const parsed = parseDumpPayload(payload, state);
      if (!parsed) continue;
      if ('error' in parsed) {
        fatal = new Error(parsed.error);
        notify();
        return;
      }
      if (parsed.rotate) {
        currentFile = parsed.rotate.file;
        currentPos = parsed.rotate.pos;
      }
      if (parsed.gtid) currentGtid = parsed.gtid;
      if (parsed.header.nextPos) currentPos = parsed.header.nextPos;
      if (parsed.rows) {
        const cursor: CdcCursor = {
          file: currentFile,
          pos: currentPos,
          gtid: currentGtid,
        };
        const changes = rowsEventToChanges(parsed, state.tableMaps, cursor, columnNames)
          .filter((c) => wanted.has(c.table));
        if (changes.length) {
          queue.push(...changes);
          notify();
        }
      } else if (parsed.type === EventType.HEARTBEAT) {
        notify();
      }
    }
  }

  const stream = stealStream(conn);
  stream.on('data', (c: Buffer) => onChunk(c));
  stream.on('error', (err: Error) => {
    fatal = err;
    notify();
  });
  stream.on('end', () => {
    if (!stopped) fatal = new Error('binlog dump 连接结束');
    notify();
  });
  stream.resume();

  return {
    async start(from) {
      const file = from?.file || currentFile;
      const pos = from?.pos && from.pos > 0 ? from.pos : 4;
      currentFile = file;
      currentPos = pos;
      if (from?.gtid) currentGtid = String(from.gtid);
      const packet = buildBinlogDumpPacket({ file, pos, serverId });
      stream.write(packet);
      opts.log?.info({ file, pos, serverId, checksum }, 'cdc native: COM_BINLOG_DUMP');
    },
    async next(batchSize) {
      for (;;) {
        if (fatal) throw fatal;
        if (stopped) return [];
        if (queue.length) return queue.splice(0, batchSize);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 50);
          waiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
        if (queue.length || fatal || stopped) continue;
        return [];
      }
    },
    async stop() {
      stopped = true;
      notify();
      try { stream.end(); } catch { /* */ }
      await conn.end().catch(() => undefined);
    },
  };
}
