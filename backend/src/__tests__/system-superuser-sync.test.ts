import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), lock: vi.fn(), account: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(),
  membership: vi.fn(), addMembership: vi.fn(), updateMembership: vi.fn(), hash: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(),
}));
vi.mock('../plugins/db.js', () => ({ prisma: { $transaction: mocks.transaction, users: { findUnique: mocks.findUnique, findFirst: mocks.findFirst } } }));
vi.mock('../shared/utils/password.js', () => ({ hashPassword: mocks.hash }));
import { syncSystemSuperuser, isSystemSuperuser, isReservedSystemIdentity, assertBusinessManagedUser, assertBusinessEmailAvailable,
  SYSTEM_SUPERUSER_UID as UID } from '../shared/services/system-superuser.js';
const input = { uid: 'admin' as const, email: 'root@example.test', password: 'synthetic-only-password', account_id: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findFirst.mockResolvedValue(null);
  mocks.hash.mockResolvedValue('bcrypt-test-hash'); mocks.account.mockResolvedValue({ id: 1 });
  mocks.find.mockResolvedValue([]); mocks.membership.mockResolvedValue(null);
  mocks.create.mockImplementation(async ({ data }) => ({ id: 7, ...data }));
  mocks.update.mockImplementation(async ({ data }) => ({ id: 7, ...data }));
  mocks.transaction.mockImplementation(async cb => cb({ $executeRaw: mocks.lock,
    accounts: { findUnique: mocks.account }, users: { findMany: mocks.find, create: mocks.create, update: mocks.update },
    account_users: { findFirst: mocks.membership, create: mocks.addMembership, update: mocks.updateMembership } }));
});
describe('ConfManager singleton system identity', () => {
  it('bootstraps one separate identity, bcrypts raw password, binds an existing account', async () => {
    expect(await syncSystemSuperuser(input)).toMatchObject({ user_id: 7, system_superuser: true });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.hash).toHaveBeenCalledWith(input.password);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ uid: UID, type: 'SuperAdmin', encrypted_password: 'bcrypt-test-hash' }) });
    expect(mocks.addMembership).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: 7, account_id: 1, role: 0 }) });
  });
  it('subsequent sync updates the SAME user and retains administrator membership', async () => {
    mocks.find.mockResolvedValue([{ id: 7, uid: UID, type: 'SuperAdmin', email: 'old@example.test' }]);
    mocks.membership.mockResolvedValue({ id: 4, role: 0 });
    await syncSystemSuperuser(input);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 7 }, data: expect.objectContaining({ encrypted_password: 'bcrypt-test-hash', reset_password_token: null }) });
    expect(mocks.updateMembership).toHaveBeenCalledWith({ where: { id: 4 }, data: { role: 0 } });
  });
  it.each([
    { candidates: [{ id: 2, uid: '1001', type: null, email: input.email }] },
    { candidates: [{ id: 2, uid: 'another', type: 'SuperAdmin' }] },
    { candidates: [{ id: 7, uid: UID, type: 'SuperAdmin' }, { id: 8, uid: '1001', email: input.email }] },
  ])('rejects conflicting identities instead of adopting an existing user: %j', async ({ candidates }) => {
    mocks.find.mockResolvedValue(candidates);
    await expect(syncSystemSuperuser(input)).rejects.toThrow('conflict');
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not implicitly create a tenant', async () => {
    mocks.account.mockResolvedValue(null);
    await expect(syncSystemSuperuser(input)).rejects.toThrow('does not exist');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('role=administrator alone is never a system superuser', () => {
    expect(isSystemSuperuser({ uid: '1001', type: null })).toBe(false);
    expect(isSystemSuperuser({ uid: UID, type: null })).toBe(false);
    expect(isSystemSuperuser({ uid: '1001', type: 'SuperAdmin' })).toBe(false);
    expect(isSystemSuperuser({ uid: UID, type: 'SuperAdmin' })).toBe(true);
    expect(isReservedSystemIdentity(UID)).toBe(true);
  });
  it('prevents business-user routes from editing/removing the system identity', async () => {
    mocks.findUnique.mockResolvedValue({ uid: UID, type: 'SuperAdmin' });
    await expect(assertBusinessManagedUser(7)).rejects.toThrow('ConfManager');
    mocks.findUnique.mockResolvedValue({ uid: '1001', type: null });
    await expect(assertBusinessManagedUser(8)).resolves.toBeUndefined();
  });
});

describe('protected login email and bcrypt boundary', () => {
  it('rejects business email collisions ignoring case', async () => {
    mocks.findFirst.mockResolvedValue({ id: 7 });
    await expect(assertBusinessEmailAvailable('ROOT@example.test')).rejects.toThrow('邮箱');
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      email: { equals: 'root@example.test', mode: 'insensitive' },
    }) }));
  });
  it('rejects passwords above the 72-byte bcrypt limit before writes', async () => {
    await expect(syncSystemSuperuser({ ...input, password: '中'.repeat(25) })).rejects.toThrow('Invalid');
    expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
