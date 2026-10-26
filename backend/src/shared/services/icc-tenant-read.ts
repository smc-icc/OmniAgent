/** Restricted adapter for the static SELECT statements in the ICC legacy DALs.
 * Not a general SQL rewriter: unsupported syntax/tables fail closed. Each table
 * occurrence (including joins and scalar subqueries) becomes a scoped relation.
 */
import { getIccMysqlPool } from './icc-groups-dal.js';
import { confTenancyEnabled } from './conf-tenancy.js';
import { accessScope, type ScopeContext } from '../../modules/access/access.scope.js';

const tables = new Set(['t_icc_ag_call_record', 't_icc_ag_route_log', 't_icc_base_call_log', 't_icc_ivr_route_log']);
const keywords = new Set(['WHERE', 'ON', 'INNER', 'LEFT', 'RIGHT', 'JOIN', 'ORDER', 'GROUP', 'LIMIT', 'HAVING', 'UNION']);
const hex = (value: string) => `CONVERT(0x${Buffer.from(value, 'utf8').toString('hex')} USING utf8mb4)`;

export function scopedIccSelect(sql: string, scope: Pick<ScopeContext, 'vdnId' | 'all' | 'workNos'>): string {
  if (!Number.isSafeInteger(scope.vdnId) || scope.vdnId <= 0) throw new Error('ICC read requires a trusted VDN');
  // The DAL contains no comments, multiple statements, quoted identifiers or CTEs.
  if (!/^\s*SELECT\b/i.test(sql) || /;|--|\/\*|`/.test(sql)) throw new Error('Unsupported managed ICC statement');
  // Mask string literals so FROM/JOIN inside a literal cannot be interpreted as SQL.
  const masked = sql.replace(/'(?:''|\\.|[^'\\])*'/g, text => ' '.repeat(text.length));
  if (/\b(INTO|UPDATE|DELETE|INSERT|OUTFILE|DUMPFILE|UNION|WITH|FOR)\b/i.test(masked)) throw new Error('Unsupported managed ICC statement');
  const refs = [...masked.matchAll(/\b(FROM|JOIN)\s+([a-zA-Z_][\w]*)(?:\s+(?:AS\s+)?([a-zA-Z_][\w]*))?/gi)];
  const starts = [...masked.matchAll(/\b(FROM|JOIN)\b/gi)];
  if (!refs.length || refs.length !== starts.length) throw new Error('Unsupported ICC table syntax');
  let result = sql;
  const workNos = [...new Set(scope.workNos.filter(v => typeof v === 'string' && v.length > 0))];
  const workFilter = (alias: string) => workNos.length ? `${alias}.WorkNO IN (${workNos.map(hex).join(',')})` : '1 = 0';
  for (const ref of refs.reverse()) {
    const table = ref[2].toLowerCase();
    if (!tables.has(table)) throw new Error('ICC table has no verified VDN ownership');
    const tableStart = ref.index! + ref[0].indexOf(ref[2]);
    const tableEnd = tableStart + ref[2].length;
    // Reject schema-qualified references and comma-joined tables (not used by these DALs).
    if (masked[tableEnd] === '.' || /\bFROM\s+\w+\s*,/i.test(masked)) throw new Error('Unsupported ICC table syntax');
    const hasAlias = !!ref[3] && !keywords.has(ref[3].toUpperCase());
    let predicate = `icc_owned.VDNID = ${scope.vdnId}`;
    if (!scope.all) {
      if (table === 't_icc_ag_call_record' || table === 't_icc_ag_route_log') predicate += ` AND ${workFilter('icc_owned')}`;
      else {
        // Base/IVR rows have no WorkNO. Ownership requires an authorized agent leg
        // in the SAME VDN, never a phone-number/time-window-only correlation.
        const callKey = table === 't_icc_base_call_log' ? 'PID' : 'BaseCallPID';
        predicate += ` AND EXISTS (SELECT 1 FROM t_icc_ag_route_log icc_leg WHERE icc_leg.VDNID = ${scope.vdnId} AND ${workFilter('icc_leg')} AND icc_leg.BaseCallPID = icc_owned.${callKey})`;
      }
    }
    const relation = `(SELECT * FROM ${table} icc_owned WHERE ${predicate})${hasAlias ? '' : ` ${table}`}`;
    result = result.slice(0, tableStart) + relation + result.slice(tableEnd);
  }
  return result;
}

export async function getIccReadPool() {
  if (!confTenancyEnabled()) return getIccMysqlPool();
  const scope = accessScope.getStore();
  // Background work without a freshly authorized scope cannot use process defaults.
  if (!scope) return null;
  const trusted = { vdnId: scope.vdnId, all: scope.all, workNos: [...scope.workNos] };
  const pool = await getIccMysqlPool();
  if (!pool) return null;
  return { query: (sql: string, values?: any[]) => pool.query(scopedIccSelect(sql, trusted), values) };
}
