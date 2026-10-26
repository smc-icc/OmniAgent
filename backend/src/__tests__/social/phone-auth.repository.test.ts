import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ map: vi.fn(), maps: vi.fn(), binding: vi.fn(), user: vi.fn(), rows: vi.fn(), live: vi.fn() }));
vi.mock('../../plugins/db.js', () => ({ prisma: { conf_vdn_accounts: { findUnique: deps.map, findMany: deps.maps }, conf_user_bindings: { findUnique: deps.binding }, users: { findUnique: deps.user } } }));
vi.mock('../../modules/access/access.db.js', () => ({ database: async () => ({}), rows: deps.rows }));
vi.mock('../../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => true, assertLiveBinding: deps.live }));
import { phoneAuthRepository } from '../../modules/auth/phone-auth.repository.js';
import { normalizeLoginPhone, phoneVdn } from '../../modules/auth/phone-policy.js';
const target = { userId: 2, accountId: 10, vdnId: 7, operatorId: 20 };
beforeEach(() => {
  vi.clearAllMocks();
  deps.map.mockResolvedValue({ enabled: true, account_id: 10 });
  deps.maps.mockResolvedValue([{ vdn_id: 7, enabled: true, account_id: 10 }]);
  deps.binding.mockResolvedValue({ enabled: true, user_id: 2 });
  deps.user.mockResolvedValue({ id: 2, uid: 'conf-vdn:7:20:seat2', type: 'User' });
  deps.live.mockResolvedValue({ map: { account_id: 10 }, binding: { vdn_id: 7, source_user_id: 20 } });
  deps.rows.mockImplementation(async (_db, sql: string) => sql.includes('t_icc_vdn') ? [{ id: 7, name: '公司 A' }] : [{ id: 20, vdn_id: 7, mobile: '13800000000' }]);
});
describe('authoritative staff phone bindings', () => {
  it('normalizes domestic and explicit international phone numbers', () => {
    expect(normalizeLoginPhone('138 0000 0000')).toBe('+8613800000000');
    expect(normalizeLoginPhone('0086-13800000000')).toBe('+8613800000000');
    expect(normalizeLoginPhone('+1 (202) 555-0123')).toBe('+12025550123');
    expect(() => normalizeLoginPhone('8003')).toThrow();
    expect(() => phoneVdn('company@example.test')).toThrow();
  });
  it('resolves only an existing explicit VDN/operator/account binding', async () => {
    expect(await phoneAuthRepository.list('+8613800000000')).toEqual([{ ...target, name: '公司 A' }]);
    expect(deps.binding).toHaveBeenCalledWith({ where: { vdn_id_source_user_id: { vdn_id: 7, source_user_id: 20 } } });
    expect(deps.rows.mock.calls[0]![2]).toEqual([7]);
    expect(deps.rows.mock.calls[0]![1]).toContain('VDNID IN (?)');
    expect(deps.rows.mock.calls[0]![1]).not.toMatch(/LIMIT|MobileTel.*LIKE/i);
  });
  it('rejects shared phone numbers and unmapped or disabled VDNs', async () => {
    deps.rows.mockResolvedValue([{ id: 20, vdn_id: 7, mobile: '13800000000' }, { id: 21, vdn_id: 7, mobile: '+8613800000000' }]);
    expect(await phoneAuthRepository.list('+8613800000000')).toEqual([]);
    deps.maps.mockResolvedValue([]);
    expect(await phoneAuthRepository.list('+8613800000000')).toEqual([]);
  });
  it('revalidates the phone and tenant after an OTP has been requested', async () => {
    expect((await phoneAuthRepository.validate(target, '+8613800000000')).id).toBe(2);
    deps.rows.mockResolvedValue([{ id: 20, vdn_id: 7, mobile: '13900000000' }]);
    await expect(phoneAuthRepository.validate(target, '+8613800000000')).rejects.toMatchObject({ statusCode: 403 });
    deps.rows.mockResolvedValue([{ id: 20, vdn_id: 7, mobile: '13800000000' }]);
    deps.live.mockResolvedValue({ map: { account_id: 11 }, binding: { vdn_id: 7, source_user_id: 20 } });
    await expect(phoneAuthRepository.validate(target, '+8613800000000')).rejects.toMatchObject({ statusCode: 403 });
  });
  it('rejects a duplicate canonical phone that appeared after issuance', async () => {
    deps.rows.mockImplementation(async (_db, sql: string) => sql.includes('ID AS id') ? [{ id: 20, vdn_id: 7, mobile: '13800000000' }, { id: 21, vdn_id: 7, mobile: '+8613800000000' }] : [{ mobile: '13800000000' }]);
    await expect(phoneAuthRepository.validate(target, '+8613800000000')).rejects.toMatchObject({ statusCode: 403 });
  });
  it('checks a complete source read even when many noncanonical candidates precede a duplicate', async () => {
    deps.rows.mockResolvedValue([
      ...Array.from({ length: 500 }, (_, index) => ({ id: index + 1, vdn_id: 7, mobile: index === 0 ? '13800000000' : '8613800000000' })),
      { id: 501, vdn_id: 7, mobile: '+86\t13800000000' },
    ]);
    expect(await phoneAuthRepository.list('+8613800000000')).toEqual([]);
    expect(deps.binding).not.toHaveBeenCalled();
  });
  it('does not allow reserved global administrator identities to use staff phone login', async () => {
    deps.user.mockResolvedValue({ id: 2, uid: 'conf-system:admin', type: 'SuperAdmin' });
    expect(await phoneAuthRepository.list('+8613800000000')).toEqual([]);
  });
});

it('allows one phone in multiple VDNs but excludes ambiguous seats only within their own VDN', async () => {
  deps.maps.mockResolvedValue([{ vdn_id: 7, account_id: 10 }, { vdn_id: 8, account_id: 11 }]);
  deps.rows.mockImplementation(async (_db, sql: string, params: number[]) => sql.includes('t_icc_vdn') ? [{ id: 7, name: 'A' }, { id: 8, name: 'B' }] :
    sql.includes('VDNID IN') ? [{ id: 20, vdn_id: 7, mobile: '13800000000' }, { id: 21, vdn_id: 8, mobile: '+86 13800000000' }] :
    [{ id: params[0] === 7 ? 20 : 21, mobile: '13800000000' }]);
  deps.binding.mockImplementation(async ({ where }) => ({ enabled: true, user_id: where.vdn_id_source_user_id.vdn_id === 7 ? 2 : 3 }));
  deps.live.mockImplementation(async id => ({ map: { account_id: id === 2 ? 10 : 11 }, binding: { vdn_id: id === 2 ? 7 : 8, source_user_id: id === 2 ? 20 : 21 } }));
  deps.user.mockImplementation(async ({ where }) => ({ id: where.id, uid: 'conf-vdn:' + (where.id === 2 ? '7:20:seat2' : '8:21:seat3'), type: 'User' }));
  expect((await phoneAuthRepository.list('+8613800000000')).map(t => t.vdnId)).toEqual([7, 8]);
  deps.rows.mockImplementation(async (_db, sql: string, params: number[]) => sql.includes('t_icc_vdn') ? [{ id: 7, name: 'A' }, { id: 8, name: 'B' }] :
    sql.includes('VDNID IN') ? [{ id: 20, vdn_id: 7, mobile: '13800000000' }, { id: 22, vdn_id: 7, mobile: '+8613800000000' }, { id: 21, vdn_id: 8, mobile: '13800000000' }] : [{ id: 21, mobile: '13800000000' }]);
  expect((await phoneAuthRepository.list('+8613800000000')).map(t => t.vdnId)).toEqual([8]);
});
