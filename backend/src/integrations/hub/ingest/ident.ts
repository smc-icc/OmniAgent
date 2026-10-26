const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 禁止把 `t_icc_ccs_log_sync_max_pid` 当遗留 sync 中间表读。 */
export const FORBIDDEN_SYNC_TABLES = new Set([
  't_icc_ccs_log_sync_max_pid',
]);

export function assertMysqlIdent(name: string, label = 'identifier'): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`非法 MySQL ${label}: ${name}`);
  }
  return name;
}

export function quoteIdent(name: string, label = 'identifier'): string {
  return `\`${assertMysqlIdent(name, label)}\``;
}

/** lookup SQL 只允许单条 SELECT，PID 用 `?` 绑定。 */
export function assertLookupSql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) throw new Error('legacy_sync lookup SQL 为空');
  if (/;|\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REPLACE)\b/i.test(trimmed)) {
    throw new Error('legacy_sync lookup 只允许单条 SELECT');
  }
  if (!/^\s*SELECT\b/i.test(trimmed)) {
    throw new Error('legacy_sync lookup 必须以 SELECT 开头');
  }
  if (!trimmed.includes('?')) {
    throw new Error('legacy_sync lookup 必须包含 ? 以绑定 PID');
  }
  if ((trimmed.match(/\?/g) ?? []).length !== 1) {
    throw new Error('legacy_sync lookup 只能有一个 ? 占位符');
  }
  return trimmed;
}

export function rowField(row: Record<string, unknown>, name: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

export function asPlainRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== 'object') return {};
  return { ...(row as Record<string, unknown>) };
}
