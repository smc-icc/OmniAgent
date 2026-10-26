import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), create: vi.fn(), remove: vi.fn(),
  deleteMembership: vi.fn(), execute: vi.fn() }));
vi.mock('../plugins/db.js', () => ({ prisma: { users: { findFirst: mocks.find, update: mocks.update, create: mocks.create, delete: mocks.remove },
  account_users: { deleteMany: mocks.deleteMembership }, $executeRawUnsafe: mocks.execute } }));
vi.mock('../shared/utils/password.js', () => ({ hashPassword: vi.fn() }));
import { applyConfUserSync } from '../shared/services/conf-user-sync.js';
const root = { id: 7, uid: 'conf-system:admin', type: 'SuperAdmin', email: 'root@example.test' };
beforeEach(() => { vi.resetAllMocks(); mocks.find.mockResolvedValue(root); });
describe('ordinary Conf user sync cannot overwrite/remove/promote singleton', () => {
  it.each([
    { action: 'upsert' as const, work_no: root.uid },
    { action: 'delete' as const, work_no: root.uid },
    { action: 'upsert' as const, work_no: '1001', previous_work_no: root.uid },
    { action: 'delete' as const, work_no: '1001', previous_work_no: root.uid },
    { action: 'upsert' as const, work_no: '1001', email: root.email, password: 'synthetic' },
    { action: 'delete' as const, work_no: '1001', email: root.email },
  ])('fails before writing: %j', async payload => {
    await expect(applyConfUserSync(payload)).rejects.toThrow();
    for (const fn of [mocks.update, mocks.create, mocks.remove, mocks.deleteMembership, mocks.execute]) expect(fn).not.toHaveBeenCalled();
  });
});
