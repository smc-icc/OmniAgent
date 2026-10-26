import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: {} as any, source: vi.fn(), vdn: vi.fn(), rows: vi.fn(), hash: vi.fn() }));
vi.mock('../plugins/db.js', () => ({ prisma: m.db }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ sourceUser: m.source, sourceVdn: m.vdn, managedUid: (v: number, s: number, w: string) => `conf-vdn:${v}:${s}:${encodeURIComponent(w)}` }));
vi.mock('../modules/access/access.db.js', () => ({ database: async () => ({}), rows: m.rows }));
vi.mock('../shared/utils/password.js', () => ({ hashPassword: m.hash }));
import { planLegacyAdoption, applyLegacyAdoption, auditLegacyReferences } from '../shared/services/conf-tenancy-migration.js';
const input = { vdn_id: 2, account_id: 70, source_user_id: 21, work_no: '2001', legacy_user_id: 9, expected_uid: 'conf:2001', expected_email: 'old@example.test' };
const columns = [
  { table_name: 'account_users', column_name: 'user_id', data_type: 'integer', user_fk: true },
  { table_name: 'account_users', column_name: 'account_id', data_type: 'integer', user_fk: false },
  { table_name: 'conversations', column_name: 'assignee_id', data_type: 'integer', user_fk: true },
  { table_name: 'conversations', column_name: 'account_id', data_type: 'integer', user_fk: false },
];
beforeEach(() => {
  process.env.CONF_TENANCY_MAINTENANCE = '1';
  m.source.mockReset().mockResolvedValue({ id: 21, work_no: '2001', name: 'Agent', email: 'new@example.test', enabled: 1 });
  m.vdn.mockReset().mockResolvedValue({ id: 2, name: 'VDN2' });
  m.rows.mockReset().mockResolvedValue([{ password: 'synthetic-secret' }]); m.hash.mockReset().mockResolvedValue('synthetic-hash');
  for (const key of Object.keys(m.db)) delete m.db[key];
  Object.assign(m.db, {
    users: { findUnique: vi.fn().mockResolvedValue({ id: 9, uid: 'conf:2001', email: 'old@example.test', type: null, updated_at: new Date('2026-10-01') }), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    accounts: { findUnique: vi.fn().mockResolvedValue({ id: 70, name: 'Old account' }) },
    conf_vdn_accounts: { findUnique: vi.fn().mockResolvedValue({ vdn_id: 2, account_id: 70, enabled: true }) },
    conf_user_bindings: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    account_users: { upsert: vi.fn(), deleteMany: vi.fn() },
    $executeRaw: vi.fn(), $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string) => sql.includes('information_schema.columns') ? columns : [{ total: 4n, unowned: 0n, fingerprint: 'stable-row-fingerprint' }]),
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(m.db)),
  });
});
describe('explicit reviewed legacy adoption', () => {
  it('plans read-only and records history ownership without reading or logging passwords', async () => {
    const p = await planLegacyAdoption(input); expect(p.applicable).toBe(true); expect(p.references).toHaveLength(2); expect(p.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(m.rows).not.toHaveBeenCalled(); expect(m.db.users.update).not.toHaveBeenCalled(); expect(JSON.stringify(p)).not.toContain('synthetic-secret');
  });
  it('preserves user ID and history, uses current source password and role1 membership', async () => {
    const plan = await planLegacyAdoption(input); const result = await applyLegacyAdoption(input, plan.digest, 'a'.repeat(64));
    expect(result).toMatchObject({ preserved_user_id: 9, moved_history_rows: 0 });
    expect(m.db.users.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9 }, data: expect.objectContaining({ uid: 'conf-vdn:2:21:2001', encrypted_password: 'synthetic-hash', tokens: {} }) }));
    expect(m.db.account_users.upsert.mock.calls[0][0].update).toEqual({ role: 1 });
    expect(m.db.$executeRawUnsafe.mock.calls[0][0]).toContain('SHARE ROW EXCLUSIVE'); expect(m.hash).toHaveBeenCalledWith('synthetic-secret');
    expect(m.db.$transaction.mock.calls[0][1].isolationLevel).toBe('ReadCommitted');
    expect(m.db.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(m.db.users.update.mock.invocationCallOrder[0]);
  });
  it('history content changes with unchanged row counts invalidate reviewed plan', async () => {
    const plan = await planLegacyAdoption(input);
    m.db.$queryRawUnsafe.mockImplementation(async (sql: string) => sql.includes('information_schema.columns') ? columns : [{ total: 4n, unowned: 0n, fingerprint: 'changed-row-fingerprint' }]);
    await expect(applyLegacyAdoption(input, plan.digest, 'a'.repeat(64))).rejects.toThrow('changed');
    expect(m.db.users.update).not.toHaveBeenCalled();
  });
  it('stale review digest rolls back before mutation', async () => { const p = await planLegacyAdoption(input); m.source.mockResolvedValue({ id: 21, work_no: '2001', email: 'changed@example.test', enabled: 1 }); await expect(applyLegacyAdoption(input, p.digest, 'a'.repeat(64))).rejects.toThrow('changed'); expect(m.db.users.update).not.toHaveBeenCalled(); });
  it.each(['uid', 'email', 'system', 'binding', 'map', 'conflict', 'source'])('blocks unsafe %s adoption', async type => {
    if (type === 'uid') input.expected_uid = 'wrong';
    if (type === 'email') input.expected_email = 'wrong';
    if (type === 'system') m.db.users.findUnique.mockResolvedValue({ id: 9, uid: 'conf:2001', email: 'old@example.test', type: 'SuperAdmin' });
    if (type === 'binding') m.db.conf_user_bindings.findUnique.mockResolvedValue({ id: 10 });
    if (type === 'map') m.db.conf_vdn_accounts.findUnique.mockResolvedValue({ account_id: 1, enabled: true });
    if (type === 'conflict') m.db.users.findFirst.mockResolvedValue({ id: 8 });
    if (type === 'source') m.source.mockResolvedValue(null);
    expect((await planLegacyAdoption(input)).applicable).toBe(false);
    input.expected_uid = 'conf:2001'; input.expected_email = 'old@example.test';
  });
  it('foreign historical rows are blockers even with matching email', async () => {
    m.db.$queryRawUnsafe.mockImplementation(async (sql: string) => sql.includes('information_schema.columns') ? columns : [{ total: 4n, unowned: 1n }]);
    expect((await planLegacyAdoption(input)).blockers.join(' ')).toContain('foreign or unproven');
  });
  it('unknown reference ownership is not silently attributed to account1', async () => {
    const cols = [{ table_name: 'custom_history', column_name: 'user_id', data_type: 'integer', user_fk: true }];
    await auditLegacyReferences(m.db, cols, 9, 70); expect(m.db.$queryRawUnsafe.mock.calls[0][0]).toContain('(FALSE)');
  });
  it('conversation-linked references check persisted conversation account', async () => {
    await auditLegacyReferences(m.db, [...columns, { table_name: 'participants', column_name: 'user_id', data_type: 'integer', user_fk: true }, { table_name: 'participants', column_name: 'conversation_id', data_type: 'integer', user_fk: false }], 9, 70);
    expect(m.db.$queryRawUnsafe.mock.calls.at(-1)[0]).toContain('LEFT JOIN public."conversations" own_conversation_id');
  });
  it('disabled source removes membership but preserves identity/history', async () => { m.source.mockResolvedValue({ id: 21, work_no: '2001', name: 'Agent', enabled: 0 }); const p = await planLegacyAdoption(input); await applyLegacyAdoption(input, p.digest, 'a'.repeat(64)); expect(m.db.account_users.deleteMany).toHaveBeenCalled(); expect(m.db.account_users.upsert).not.toHaveBeenCalled(); });
  it('requires offline maintenance and receipts before opening a transaction', async () => { delete process.env.CONF_TENANCY_MAINTENANCE; await expect(applyLegacyAdoption(input, 'a'.repeat(64), 'b'.repeat(64))).rejects.toThrow('MAINTENANCE'); expect(m.db.$transaction).not.toHaveBeenCalled(); });
});
