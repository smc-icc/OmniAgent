import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  users: vi.fn(), binding: vi.fn(), live: vi.fn(), operator: vi.fn(), permission: vi.fn(),
}));
vi.mock('../../plugins/db.js', () => ({ prisma: { users: { findUnique: deps.users }, conf_user_bindings: { findUnique: deps.binding } } }));
vi.mock('../../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => true, assertLiveBinding: deps.live }));
vi.mock('../../modules/access/access.db.js', () => ({ database: async () => ({}) }));
vi.mock('../../modules/access/access.users.js', () => ({ requireUser: deps.operator }));
vi.mock('../../modules/access/access.context.js', () => ({ requirePermission: deps.permission }));
import { loginCodeRepository } from '../../modules/auth/login-code.repository.js';

const manager = { userId: 1, accountId: 10, vdnId: 7, agentId: 30, systemSuperuser: false };
const record = { id: 'test', tokenHash: '', issuerId: 1, userId: 2, accountId: 10, vdnId: 7, operatorId: 20, issuedAt: 1, expiresAt: 100 };
beforeEach(() => {
  vi.clearAllMocks();
  deps.users.mockImplementation(async ({ where }: { where: { id: number } }) => ({ id: where.id, name: 'Seat', uid: 'conf-vdn:7:20:seat', type: 'User', email: 'seat@example.test' }));
  deps.binding.mockResolvedValue({ user_id: 2, enabled: true });
  deps.live.mockResolvedValue({ map: { account_id: 10 }, binding: { vdn_id: 7, source_user_id: 20 } });
  deps.operator.mockResolvedValue({ enabled: 1 });
  deps.permission.mockResolvedValue(manager);
});
describe('code recipient live VDN binding', () => {
  it('resolves only the explicit VDN/operator mapping', async () => {
    expect(await loginCodeRepository.target(manager, 20)).toEqual({ userId: 2, accountId: 10, vdnId: 7, operatorId: 20 });
    expect(deps.binding).toHaveBeenCalledWith({ where: { vdn_id_source_user_id: { vdn_id: 7, source_user_id: 20 } } });
  });
  it('rejects a seat mapped to a different account', async () => {
    deps.live.mockResolvedValue({ map: { account_id: 11 }, binding: { vdn_id: 7, source_user_id: 20 } });
    await expect(loginCodeRepository.target(manager, 20)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('rejects disabled or unsynchronized seats', async () => {
    deps.operator.mockResolvedValue({ enabled: 0 });
    await expect(loginCodeRepository.target(manager, 20)).rejects.toMatchObject({ statusCode: 403 });
    deps.operator.mockResolvedValue({ enabled: 1 }); deps.binding.mockResolvedValue(null);
    await expect(loginCodeRepository.target(manager, 20)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('revalidates the issuer permission and stored VDN', async () => {
    expect((await loginCodeRepository.validate(record)).id).toBe(2);
    deps.permission.mockResolvedValue({ ...manager, vdnId: 8 });
    await expect(loginCodeRepository.validate(record)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('does not inherit the global superuser or unbound-administrator exception', async () => {
    deps.permission.mockResolvedValue({ ...manager, systemSuperuser: true, agentId: 0 });
    await expect(loginCodeRepository.validate(record)).rejects.toMatchObject({ statusCode: 403 });
    deps.permission.mockResolvedValue({ ...manager, systemSuperuser: false, agentId: 0 });
    await expect(loginCodeRepository.validate(record)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('rejects recipient rebinding and reserved system identities', async () => {
    deps.binding.mockResolvedValue({ user_id: 3, enabled: true });
    await expect(loginCodeRepository.validate(record)).rejects.toMatchObject({ statusCode: 403 });
    deps.binding.mockResolvedValue({ user_id: 2, enabled: true });
    deps.users.mockImplementation(async ({ where }: { where: { id: number } }) => where.id === 1 ? { id: 1 } : { id: 2, uid: 'conf-system:admin', type: 'SuperAdmin' });
    await expect(loginCodeRepository.validate(record)).rejects.toMatchObject({ statusCode: 403 });
  });
});
