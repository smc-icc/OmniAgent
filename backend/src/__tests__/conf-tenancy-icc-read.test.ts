import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ query: vi.fn(), scope: undefined as any, enabled: true }));
vi.mock('../shared/services/icc-groups-dal.js', () => ({ getIccMysqlPool: async () => ({ query: m.query }) }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => m.enabled }));
vi.mock('../modules/access/access.scope.js', () => ({ accessScope: { getStore: () => m.scope } }));
import { getIccReadPool, scopedIccSelect } from '../shared/services/icc-tenant-read.js';
import { lookupRecordPath, lookupRecordFilesByNumber, lookupCallCdrsByNumber } from '../shared/services/icc-call-dal.js';
import { countIccCalls, trySyncIccPassword } from '../shared/services/icc-metrics-dal.js';
const scope = (vdnId = 2, all = false) => ({ vdnId, all, workNos: ['2001', "x' OR 1=1 --"] });
beforeEach(() => { m.enabled = true; m.scope = scope(); m.query.mockReset().mockResolvedValue([[]]); });
describe('managed ICC read isolation', () => {
  it('scopes joins and scalar subqueries before an outer OR', () => {
    const sql = scopedIccSelect(`SELECT A.PID, (SELECT B.CallType FROM t_icc_base_call_log B WHERE B.PID=A.BaseCallPID) FROM t_icc_ag_route_log A LEFT JOIN t_icc_ag_route_log P ON P.PID=A.ParentCallPID WHERE A.CallingNO=? OR A.CalledNO=?`, scope());
    expect(sql.match(/icc_owned.VDNID = 2/g)).toHaveLength(3);
    expect(sql).toContain('icc_leg.VDNID = 2'); expect(sql).toContain('icc_leg.BaseCallPID = icc_owned.PID');
    expect(sql.match(/icc_owned.WorkNO IN/g)).toHaveLength(2);
    expect(sql).not.toContain("x' OR"); expect(sql).toContain('CONVERT(0x');
    expect(sql.endsWith('WHERE A.CallingNO=? OR A.CalledNO=?')).toBe(true);
  });
  it('separates same phones and WorkNO across VDNs without changing parameter order', async () => {
    for (const id of [2, 3]) { m.scope = scope(id); await lookupRecordFilesByNumber('555'); }
    expect(m.query).toHaveBeenCalledTimes(4);
    expect(m.query.mock.calls[0][0]).toContain('VDNID = 2'); expect(m.query.mock.calls[2][0]).toContain('VDNID = 3');
    expect(m.query.mock.calls.every(c => JSON.stringify(c[1]) === '["555","555"]')).toBe(true);
  });
  it('account scope cannot remove VDN restriction', () => {
    const sql = scopedIccSelect('SELECT * FROM t_icc_base_call_log WHERE LogicNO=?', scope(3, true));
    expect(sql).toContain('VDNID = 3'); expect(sql).not.toContain('WorkNO');
  });
  it('empty agent scope never broadens to tenant scope', () => {
    expect(scopedIccSelect('SELECT * FROM t_icc_ag_route_log', { ...scope(), workNos: [] })).toContain('AND 1 = 0');
  });
  it.each(['UPDATE t_user_users SET PassWord=?', 'SELECT * FROM t_record_index', 'SELECT * FROM other_table', 'SELECT * FROM t_icc_ag_route_log; SELECT 1', 'SELECT * FROM db.t_icc_ag_route_log', 'SELECT * FROM t_icc_ag_route_log UNION SELECT * FROM t_icc_ag_route_log', 'SELECT * FROM (SELECT * FROM t_icc_ag_route_log) A'])('fails closed for %s', sql => {
    expect(() => scopedIccSelect(sql, scope())).toThrow();
  });
  it('no trusted scope means no read; managed password writes stay blocked', async () => {
    m.scope = undefined; expect(await getIccReadPool()).toBeNull(); expect(await lookupRecordPath(12)).toBeNull();
    await trySyncIccPassword('2001', 'synthetic'); expect(m.query).not.toHaveBeenCalled();
  });
  it('skips unqualified recording index and scopes all CDR/statistic fallbacks', async () => {
    await lookupRecordPath(12); await lookupCallCdrsByNumber('555'); await countIccCalls('2001', new Date(), new Date());
    expect(m.query).toHaveBeenCalled();
    for (const [sql] of m.query.mock.calls) { expect(sql).not.toContain('t_record_index'); expect(sql).toContain('icc_owned.VDNID = 2'); }
  });
  it('missing live VDN column never causes an unfiltered retry', async () => {
    m.query.mockRejectedValue(Object.assign(new Error('Unknown column VDNID'), { code: 'ER_BAD_FIELD_ERROR' }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await lookupRecordFilesByNumber('555')).toEqual([]); expect(m.query.mock.calls.every(c => c[0].includes('icc_owned.VDNID = 2'))).toBe(true); spy.mockRestore();
  });
  it('legacy mode retains underlying pool', async () => { m.enabled = false; m.scope = undefined; const pool = await getIccReadPool(); await pool!.query('SELECT 1', []); expect(m.query).toHaveBeenCalledWith('SELECT 1', []); });
});
