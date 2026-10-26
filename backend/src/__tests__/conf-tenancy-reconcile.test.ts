import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rows: vi.fn(), maps: vi.fn(), bindings: vi.fn(), vdn: vi.fn(), user: vi.fn() }));
vi.mock('../plugins/db.js', () => ({ prisma: { conf_vdn_accounts: { findMany: m.maps }, conf_user_bindings: { findMany: m.bindings } } }));
vi.mock('../modules/access/access.db.js', () => ({ database: async () => ({}), rows: m.rows }));
vi.mock('../shared/services/conf-tenancy-sync.js', () => ({ syncVdn: m.vdn, syncManagedUser: m.user }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => process.env.CONF_TENANCY_ENABLED === '1' }));
import { reconcileConfTenancy } from '../shared/services/conf-tenancy-reconcile.js';
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('CONF_TENANCY_ENABLED', '1'); vi.stubEnv('CONF_TENANCY_MAINTENANCE', '0');
  m.rows.mockImplementation(async (_db: any, sql: string) => sql.includes('t_icc_vdn') ? [{ id: 1 }, { id: 2 }] : [{ vdn_id: 1, source_user_id: 20, work_no: '2001' }]);
  m.maps.mockResolvedValue([{ vdn_id: 1, account_id: 71, enabled: true }, { vdn_id: 3, account_id: 93, enabled: true }]);
  m.bindings.mockResolvedValue([{ vdn_id: 1, source_user_id: 22, work_no: 'deleted' }]);
  m.vdn.mockResolvedValue({}); m.user.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());
describe('explicit source reconciliation, read-only by default', () => {
  it('plans retries and stale projection cleanup without writes or passwords', async () => {
    const result = await reconcileConfTenancy(); expect(result.mode).toBe('dry-run'); expect(result.blocked).toHaveLength(1);
    expect(result.jobs).toContainEqual({ kind: 'user', action: 'delete', vdn_id: 1, source_user_id: 22, work_no: 'deleted' });
    expect(result.jobs).toContainEqual({ kind: 'vdn', action: 'delete', vdn_id: 3 });
    expect(m.vdn).not.toHaveBeenCalled(); expect(m.user).not.toHaveBeenCalled();
    expect(m.rows.mock.calls.every(c => !c[1].includes('PassWord'))).toBe(true);
  });
  it('existing account binding is explicit, new empty account creation requires opt-in', async () => {
    const hinted = await reconcileConfTenancy({ bindings: { 2: 82 } }); expect(hinted.blocked).toEqual([]); expect(hinted.jobs).toContainEqual({ kind: 'vdn', action: 'upsert', vdn_id: 2, account_id: 82 });
    expect((await reconcileConfTenancy({ allowCreate: true })).blocked).toEqual([]);
  });
  it('apply rereads via sync functions and reports safe retryable failures', async () => {
    m.user.mockRejectedValueOnce(new Error('password=do-not-log')); const result = await reconcileConfTenancy({ apply: true, bindings: { 2: 82 } });
    expect(m.vdn).toHaveBeenCalledWith({ action: 'upsert', vdn_id: 2, account_id: 82 });
    expect(result.success).toBe(false); expect(result.results.some(r => r.status === 'pending')).toBe(true); expect(JSON.stringify(result)).not.toContain('do-not-log');
  });
  it('mapping failure prevents child identity sync and leaves retryable work', async () => {
    m.vdn.mockRejectedValueOnce(new Error('synthetic')); const result = await reconcileConfTenancy({ apply: true, bindings: { 2: 82 } });
    expect(m.user).not.toHaveBeenCalled(); expect(result.results.filter(r => r.status === 'pending')).toHaveLength(3);
  });
  it('does not resurrect tombstones, remap existing data, or bind nonexistent source VDN', async () => {
    m.maps.mockResolvedValue([{ vdn_id: 1, account_id: 71, enabled: false }]); expect((await reconcileConfTenancy({ allowCreate: true })).blocked).toHaveLength(1);
    m.maps.mockResolvedValue([{ vdn_id: 1, account_id: 71, enabled: true }]); expect((await reconcileConfTenancy({ bindings: { 1: 82 }, allowCreate: true })).blocked).toHaveLength(1);
    await expect(reconcileConfTenancy({ bindings: { 999: 82 } })).rejects.toThrow();
  });
  it('offline preparation maps VDNs before either running service is enabled', async () => { vi.stubEnv('CONF_TENANCY_ENABLED', '0'); vi.stubEnv('CONF_TENANCY_MAINTENANCE', '1'); const result = await reconcileConfTenancy({ apply: true, bindings: { 2: 82 }, vdnsOnly: true }); expect(result.jobs.every(j => j.kind === 'vdn')).toBe(true); expect(m.user).not.toHaveBeenCalled(); expect(m.vdn).toHaveBeenCalled(); });
  it('apply cannot run while feature is disabled', async () => { vi.stubEnv('CONF_TENANCY_ENABLED', '0'); await expect(reconcileConfTenancy({ apply: true })).rejects.toThrow(); expect(m.rows).not.toHaveBeenCalled(); });
});
