import { assertMysqlIdent } from '../ingest/ident.js';
import { HubDeliveryError } from '../core/errors.js';
import type { HubSinkConfig } from '../config/schema.js';
import type { DeliveryItem, DeliveryResult, SinkAdapter } from './sink.js';

/** 报表仓镜像表（schema=icc）。state_trk / cdr 冲突键是 id；厚 payload 才允许 upsert。 */
export const ICC_MIRROR_TABLES = [
  't_icc_base_call_log',
  't_icc_ag_route_log',
  't_icc_acd_route_log',
  't_icc_ag_state_trk_record',
  't_icc_ag_login_log',
  't_icc_base_cdr',
  't_icc_ivr_route_log',
  't_icc_ivr_trace_log',
] as const;
export type IccMirrorTable = (typeof ICC_MIRROR_TABLES)[number];

export const ICC_MIRROR_CONFLICT: Record<IccMirrorTable, readonly string[]> = {
  t_icc_base_call_log: ['pid'],
  t_icc_ag_route_log: ['pid'],
  t_icc_acd_route_log: ['pid'],
  t_icc_ag_state_trk_record: ['id'],
  t_icc_ag_login_log: ['pid'],
  t_icc_base_cdr: ['id'],
  t_icc_ivr_route_log: ['pid'],
  t_icc_ivr_trace_log: ['pid'],
};

export const ICC_MIRROR_COLUMNS: Record<IccMirrorTable, readonly string[]> = {
  t_icc_base_call_log: [
    'pid', 'parentpid', 'vdnid', 'vdnname', 'mediaid', 'mediatype', 'logicno',
    'channelgroupid', 'channelgroupname', 'spanid', 'channelno', 'callingno', 'calledno',
    'begintime', 'answertime', 'endtime', 'calldirection', 'calltype', 'devicetypeid',
    'releasecause', 'answertimelong', 'talktimelong',
  ],
  t_icc_ag_route_log: [
    'pid', 'acdroutepid', 'basecallpid', 'parentcallpid', 'vdnid', 'vdnname', 'mediaid',
    'mediatype', 'callingno', 'calledno', 'agentgroupid', 'agentgroupname', 'skillid',
    'skillname', 'createcalltime', 'enterivrtime', 'enteracdtime', 'begintime', 'ringtime',
    'answertime', 'aftertime', 'endtime', 'agentid', 'workno', 'agentname', 'releasecause',
    'satisficing', 'recordfile', 'calldirection', 'calltype', 'ringtimelong', 'talktimelong',
    'aftertimelong', 'label', 'chmediatype',
  ],
  t_icc_acd_route_log: [
    'pid', 'basecallpid', 'vdnid', 'vdnname', 'mediaid', 'mediatype', 'callingno', 'calledno',
    'agentgroupid', 'agentgroupname', 'skillid', 'skillname', 'workno', 'queuelenenter',
    'queuelenleft', 'ewt', 'begintime', 'endtime', 'leftcauseid', 'leftcausecnname',
    'leftcauseenname', 'queuetimelong', 'requestno', 'processstatus', 'processcontent',
    'processagentid', 'processworkno', 'processagentname', 'processdate',
  ],
  t_icc_ag_state_trk_record: [
    'id', 'agentid', 'workno', 'consn', 'callsn', 'accessmediatype', 'status', 'statusname',
    'begintime', 'endtime', 'statetime', 'operatetype', 'operatename', 'operateworkno',
    'operatefailcause', 'logoutreasoncode', 'auxcode', 'vdnname', 'vdnid', 'agentname',
    'logintime', 'logintimelen', 'agroutelogpid', 'basecallpid', 'parentcallpid',
  ],
  t_icc_ag_login_log: [
    'pid', 'vdnname', 'vdnid', 'agentname', 'workno', 'agentid', 'logintime', 'logouttime', 'extension',
  ],
  t_icc_base_cdr: [
    'id', 'consn', 'callsn', 'span', 'channel', 'trunkgroup', 'caller', 'called',
    'initializetime', 'answertime', 'connecttime', 'releasetime',
    'initializetimems', 'answertimems', 'connecttimems', 'releasetimems',
    'talkduration', 'answerduration', 'cause', 'callflag', 'pid',
  ],
  t_icc_ivr_route_log: [
    'pid', 'basecallpid', 'vdnid', 'vdnname', 'ivrappid', 'flowid', 'flowname',
    'begintime', 'answertime', 'endtime', 'callingno', 'calledno', 'logicno',
    'answertimelong', 'talktimelong', 'flowtype',
    'leftcauseid', 'leftcausecnname', 'leftcauseenname',
  ],
  t_icc_ivr_trace_log: [
    'pid', 'ivrroutepid', 'begintime', 'endtime', 'flowid', 'nodeid', 'nodetype',
    'nodename', 'nodedeep', 'nodevalue', 'nodetimelong', 'noderesult',
  ],
};

const TIME_COLS = new Set([
  'begintime', 'answertime', 'endtime', 'createcalltime', 'enterivrtime', 'enteracdtime',
  'ringtime', 'aftertime', 'logintime', 'processdate', 'logouttime',
  'initializetime', 'connecttime', 'releasetime',
]);

/** CCS 把雪花 PID / consn 编成 JSON 字符串，避免 JS 精度丢失；PG 列是 bigint。 */
export function isBigintMirrorCol(col: string): boolean {
  return col === 'id' || col === 'consn' || col === 'callsn' || col.endsWith('pid');
}

function asBigintText(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = typeof v === 'bigint' ? v.toString() : String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;
  return s;
}

export interface PgExecutor {
  execute(sql: string, params: unknown[]): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function quotePgIdent(name: string, label = 'identifier'): string {
  return `"${assertMysqlIdent(name, label)}"`;
}

export function isIccMirrorTable(name: string): name is IccMirrorTable {
  return (ICC_MIRROR_TABLES as readonly string[]).includes(name);
}

function asPgValue(col: string, v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null) return null;
  if (isBigintMirrorCol(col)) return asBigintText(v);
  if (TIME_COLS.has(col)) {
    if (v instanceof Date) return v;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      const ms = v > 1e12 ? v : v * 1000;
      return new Date(ms);
    }
    const s = String(v).trim();
    if (!s || s === '0') return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function pickMirrorRow(
  table: string,
  record: Record<string, unknown>,
): { table: IccMirrorTable; row: Record<string, unknown> } {
  const t = table.trim().toLowerCase();
  if (!isIccMirrorTable(t)) {
    throw new HubDeliveryError(`pg upsert 表不在白名单: ${table}`, 'fatal');
  }
  const allowed = new Set(ICC_MIRROR_COLUMNS[t]);
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k.startsWith('__')) continue;
    const col = k.toLowerCase();
    if (!allowed.has(col)) continue;
    row[col] = asPgValue(col, v);
  }
  const keys = ICC_MIRROR_CONFLICT[t];
  for (const k of keys) {
    if (row[k] == null || row[k] === '') {
      throw new HubDeliveryError(`${t} 缺少 ${k}`, 'fatal');
    }
  }
  return { table: t, row };
}

export function buildPgUpsertSql(opts: {
  schema: string;
  table: string;
  columns: string[];
  conflictKey: string[];
}): { sql: string; placeholders: string[] } {
  const schema = quotePgIdent(opts.schema, 'schema');
  const table = quotePgIdent(opts.table, 'table');
  if (!opts.columns.length) throw new Error('pg upsert 无列');
  const keys = opts.conflictKey.map((c) => c.toLowerCase());
  const cols = opts.columns.map((c) => c.toLowerCase());
  const missing = keys.filter((k) => !cols.includes(k));
  if (missing.length) throw new Error(`conflictKey 不在记录中: ${missing.join(',')}`);
  const colSql = cols.map((c) => quotePgIdent(c, 'column')).join(', ');
  const placeholders = cols.map((c, i) => (
    isBigintMirrorCol(c) ? `$${i + 1}::bigint` : `$${i + 1}`
  ));
  const nonKeys = cols.filter((c) => !keys.includes(c));
  const updates = nonKeys.length
    ? nonKeys.map((c) => `${quotePgIdent(c, 'column')} = EXCLUDED.${quotePgIdent(c, 'column')}`).join(', ')
    : `${quotePgIdent(keys[0]!, 'column')} = EXCLUDED.${quotePgIdent(keys[0]!, 'column')}`;
  const sql = [
    `INSERT INTO ${schema}.${table} (${colSql})`,
    `VALUES (${placeholders.join(', ')})`,
    `ON CONFLICT (${keys.map((k) => quotePgIdent(k, 'column')).join(', ')})`,
    `DO UPDATE SET ${updates}`,
  ].join(' ');
  return { sql, placeholders };
}

export function createPgUpsertSink(opts: {
  spec: HubSinkConfig;
  name: string;
  executor?: PgExecutor;
}): SinkAdapter {
  const schema = (opts.spec.schema ?? 'icc').trim() || 'icc';
  if (schema !== 'icc') {
    throw new Error(`pg upsert 仅允许 schema=icc，收到 ${schema}`);
  }
  const defaultTable = opts.spec.table?.trim().toLowerCase() ?? '';
  const conflictKey = (opts.spec.conflictKey?.length ? opts.spec.conflictKey : ['pid']).map((c) => c.toLowerCase());
  let executor = opts.executor;

  return {
    name: opts.name,
    capabilities: { batch: true, maxBatchSize: opts.spec.batch?.maxSize ?? 200, transactional: true, ordered: true },
    async init() {
      if (!executor) throw new HubDeliveryError(`pg upsert sink ${opts.name} 无 executor`, 'fatal');
    },
    async deliver(items: DeliveryItem[]): Promise<DeliveryResult> {
      if (!executor) throw new HubDeliveryError('pg executor 未初始化', 'fatal');
      const results: DeliveryResult['results'] = [];
      for (const item of items) {
        try {
          const tableName = String(item.record.__hub_table ?? defaultTable).toLowerCase();
          const { table, row } = pickMirrorRow(tableName, item.record);
          const columns = Object.keys(row);
          const tableConflict = [...ICC_MIRROR_CONFLICT[table]];
          const { sql } = buildPgUpsertSql({
            schema,
            table,
            columns,
            conflictKey: tableConflict.length ? tableConflict : conflictKey,
          });
          const params = columns.map((c) => row[c] ?? null);
          await executor.execute(sql, params);
          results.push({ eventId: item.event.eventId, ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const fatal = err instanceof HubDeliveryError && err.classification === 'fatal';
          results.push({ eventId: item.event.eventId, ok: false, error: msg, retryable: !fatal });
        }
      }
      const failed = results.find((r) => !r.ok);
      if (failed && items.length === 1) {
        throw new HubDeliveryError(failed.error || 'pg upsert failed', failed.retryable === false ? 'fatal' : 'retryable');
      }
      return { results };
    },
    async health() {
      try {
        if (!executor) return { ok: false, detail: 'no executor' };
        await executor.ping();
        return { ok: true };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
    async close() {
      if (opts.executor) return;
      await executor?.close();
    },
  };
}

export function prismaPgExecutor(prisma: { $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown> }): PgExecutor {
  return {
    async execute(sql, params) {
      await prisma.$executeRawUnsafe(sql, ...params);
    },
    async ping() {
      await prisma.$executeRawUnsafe('SELECT 1');
    },
    async close() { /* prisma owned by app */ },
  };
}
