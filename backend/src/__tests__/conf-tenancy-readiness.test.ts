import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: {} as any, rows: vi.fn(), verify: vi.fn(), source: [] as any[] }));
vi.mock('../plugins/db.js', () => ({ prisma: m.db }));
vi.mock('../modules/access/access.db.js', () => ({ database: async () => ({}), rows: m.rows }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ managedUid: (v: number, id: number, w: string) => `conf-vdn:${v}:${id}:${w}` }));
vi.mock('../shared/utils/password.js', () => ({ verifyPassword: m.verify }));
import { checkConfTenancyReady } from '../shared/services/conf-tenancy-readiness.js';
const conf = () => ({ TARS_ENABLE_LOGIN: 'true', CONF_TENANCY_ENABLED: '0', PLATFORM_SYNC_SECRET: 'synthetic-secret' });
beforeEach(() => {
  Object.assign(process.env, { CONF_TENANCY_ENABLED: '0', PLATFORM_SYNC_SECRET: 'synthetic-secret' });
  m.source = [{ id: 21, vdn_id: 2, work_no: '2001', email: 'agent@example.test', enabled: 1, password: 'synthetic-password' }];
  m.rows.mockReset().mockImplementation(async (_db: any, sql: string) => sql.includes('FROM t_icc_vdn') ? [{ id: 2 }] : m.source);
  m.verify.mockReset().mockResolvedValue(true);
  Object.assign(m.db, {
    conf_vdn_accounts: { findMany: vi.fn().mockResolvedValue([{ vdn_id: 2, account_id: 70, enabled: true }]) },
    conf_user_bindings: { findMany: vi.fn().mockResolvedValue([{ vdn_id: 2, source_user_id: 21, user_id: 9, work_no: '2001', enabled: true }]) },
    users: { findMany: vi.fn().mockResolvedValue([{ id: 1, uid: 'conf-system:admin', type: 'SuperAdmin' }, { id: 9, uid: 'conf-vdn:2:21:2001', email: 'agent@example.test', encrypted_password: 'synthetic-hash' }]) },
    account_users: { findMany: vi.fn().mockResolvedValue([{ user_id: 9, account_id: 70, role: 1 }]) },
  });
});
describe('read-only cutover readiness', () => {
  it('checks source credentials without signing in, changing switches or printing credentials', async () => {
    const result = await checkConfTenancyReady(conf()); expect(result.ready).toBe(true); expect(result.auto_enabled).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/synthetic-password|synthetic-hash|synthetic-secret/); expect(m.verify).toHaveBeenCalledWith('synthetic-password', 'synthetic-hash');
  });
  it('conflicts and missing projections are explicit blockers', async () => { m.source.push({ ...m.source[0], id: 22, vdn_id: 3 }); const r = await checkConfTenancyReady(conf()); expect(r.ready).toBe(false); expect(r.conflicts.find(c => c.source_user_id === 22)?.reason).toContain('login_email_conflict'); });
  it('same work number with different emails is not a conflict', async () => {
    m.source.push({ ...m.source[0], id: 22, vdn_id: 3, email: 'another@example.test' });
    const r = await checkConfTenancyReady(conf()); expect(r.conflicts[0].reason).not.toContain('login_email_conflict');
  });
  it('real auth, matching shared secret and the expected flags are mandatory', async () => { const r = await checkConfTenancyReady({ TARS_ENABLE_LOGIN: 'false', CONF_TENANCY_ENABLED: '1', PLATFORM_SYNC_SECRET: 'wrong' }); expect(r.checks.filter(c => !c.passed).map(c => c.check)).toEqual(expect.arrayContaining(['conf_real_auth_config', 'shared_sync_secret', 'activation_flags'])); });
  it('wrong source password blocks activation', async () => { m.verify.mockResolvedValue(false); expect((await checkConfTenancyReady(conf())).conflicts[0].reason).toContain('source_password_not_synchronized'); });
  it('cross-account membership blocks activation', async () => { m.db.account_users.findMany.mockResolvedValue([{ user_id: 9, account_id: 71, role: 0 }]); expect((await checkConfTenancyReady(conf())).conflicts[0].reason).toContain('membership_projection_mismatch'); });
  it('legacy unbound memberships must be explicitly reviewed', async () => { m.db.account_users.findMany.mockResolvedValue([{ user_id: 8, account_id: 70, role: 1 }]); expect((await checkConfTenancyReady(conf())).unbound_legacy_memberships).toEqual([{ user_id: 8, account_id: 70 }]); });
  it('post-enable requires both endpoints enabled and still performs all checks', async () => { process.env.CONF_TENANCY_ENABLED = '1'; const result = await checkConfTenancyReady({ ...conf(), CONF_TENANCY_ENABLED: '1' }, 'post-enable'); expect(result.ready).toBe(true); });
});
