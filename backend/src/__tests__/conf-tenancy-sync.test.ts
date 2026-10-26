import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ prisma: {} as any, sourceVdn: vi.fn(), sourceUser: vi.fn(), rows: vi.fn(), hash: vi.fn(), email: vi.fn() }));
vi.mock('../plugins/db.js', () => ({ prisma: m.prisma }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ sourceVdn: m.sourceVdn, sourceUser: m.sourceUser, managedUid: (v: number, s: number, w: string) => `conf-vdn:${v}:${s}:${encodeURIComponent(w)}` }));
vi.mock('../modules/access/access.db.js', () => ({ database: async () => ({}), rows: m.rows }));
vi.mock('../shared/utils/password.js', () => ({ hashPassword: m.hash }));
vi.mock('../shared/services/system-superuser.js', () => ({ assertBusinessEmailAvailable: m.email,
  isReservedSystemIdentity: (w: string, u: any) => w === 'conf-system:admin' || u?.type === 'SuperAdmin' || u?.uid === 'conf-system:admin' }));
import { syncVdn, syncManagedUser } from '../shared/services/conf-tenancy-sync.js';
let maps: any[], bindings: any[], users: any[], members: any[], accounts: any[], tx: any;
const findMap = (w: any) => maps.find(x => w.vdn_id ? x.vdn_id === w.vdn_id : x.account_id === w.account_id);
const findBinding = (w: any) => bindings.find(x => w.id ? x.id === w.id : w.user_id ? x.user_id === w.user_id : x.vdn_id === w.vdn_id_source_user_id.vdn_id && x.source_user_id === w.vdn_id_source_user_id.source_user_id);
beforeEach(() => {
  vi.resetAllMocks(); maps = []; bindings = []; users = []; members = []; accounts = [{ id: 71, name: 'Existing data' }];
  tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    conf_vdn_accounts: {
      findUnique: async ({ where }: any) => findMap(where),
      create: async ({ data }: any) => { const x = { ...data, enabled: true }; maps.push(x); return x; },
      update: async ({ where, data }: any) => Object.assign(findMap(where), data),
    },
    conf_user_bindings: {
      findUnique: async ({ where }: any) => findBinding(where),
      updateMany: async ({ where, data }: any) => { bindings.filter(b => b.vdn_id === where.vdn_id).forEach(b => Object.assign(b, data)); },
      update: async ({ where, data }: any) => Object.assign(findBinding(where), data),
      upsert: async ({ where, create, update }: any) => { const b = findBinding(where); if (b) return Object.assign(b, update); const x = { ...create, id: bindings.length + 1 }; bindings.push(x); return x; },
    },
    accounts: {
      findUnique: async ({ where }: any) => accounts.find(a => a.id === where.id),
      create: async ({ data }: any) => { const a = { ...data, id: 100 + accounts.length }; accounts.push(a); return a; },
      update: async ({ where, data }: any) => Object.assign(accounts.find(a => a.id === where.id), data),
    },
    users: {
      findFirst: async ({ where }: any) => users.find(u => u.email.toLowerCase() === where.email.equals.toLowerCase() && u.id !== where.id?.not),
      findUnique: async ({ where }: any) => users.find(u => u.id === where.id),
      create: async ({ data }: any) => { const u = { ...data, id: 10 + users.length }; users.push(u); return u; },
      update: async ({ where, data }: any) => Object.assign(users.find(u => u.id === where.id), data),
    },
    account_users: {
      upsert: async ({ where, create, update }: any) => { const w = where.account_id_user_id; const x = members.find(a => a.account_id === w.account_id && a.user_id === w.user_id); if (x) Object.assign(x, update); else members.push({ ...create }); },
      deleteMany: async ({ where }: any) => { members = members.filter(a => a.account_id !== where.account_id || a.user_id !== where.user_id); },
    },
  };
  m.prisma.$transaction = vi.fn(async (fn: any) => fn(tx));
  m.sourceVdn.mockImplementation(async (v: number) => ({ id: v, name: `VDN ${v}` }));
  m.sourceUser.mockImplementation(async (v: number, s: number) => ({ id: s, work_no: '2001', name: `User ${v}`, email: '', enabled: 1 }));
  m.rows.mockResolvedValue([{ password: 'synthetic-current-password' }]);
  m.hash.mockImplementation(async (p: string) => `synthetic-hash:${p}`); m.email.mockResolvedValue(undefined);
});
afterEach(() => { vi.clearAllMocks(); });
const payload = (v = 1, s = 20) => ({ action: 'upsert' as const, vdn_id: v, source_user_id: s, work_no: '2001' });
async function mapped(v = 1) { return syncVdn({ action: 'upsert', vdn_id: v }); }
describe('durable VDN mapping', () => {
  it('creates idempotently, and updates names without overwriting existing data', async () => {
    const first = await mapped(); await mapped(); expect(maps).toHaveLength(1); expect(accounts).toHaveLength(2);
    expect(maps[0].account_id).toBe(first.account_id); expect(accounts[0].name).toBe('Existing data');
    m.sourceVdn.mockResolvedValue({ id: 1, name: 'Renamed' }); await mapped(); expect(accounts[1].name).toBe('Renamed');
  });
  it('binds existing accounts only explicitly; rejects remaps and a second VDN on one account', async () => {
    await syncVdn({ action: 'upsert', vdn_id: 1, account_id: 71 });
    await expect(syncVdn({ action: 'upsert', vdn_id: 1, account_id: 72 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(syncVdn({ action: 'upsert', vdn_id: 2, account_id: 71 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(syncVdn({ action: 'upsert', vdn_id: 3, account_id: 999 })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('deletion verifies source deletion, disables bindings, preserves data and prevents silent resurrection', async () => {
    await mapped(); await syncManagedUser(payload());
    await expect(syncVdn({ action: 'delete', vdn_id: 1 })).rejects.toMatchObject({ statusCode: 409 });
    m.sourceVdn.mockResolvedValue(undefined); await syncVdn({ action: 'delete', vdn_id: 1 });
    expect(maps[0].enabled).toBe(false); expect(bindings[0].enabled).toBe(false); expect(users).toHaveLength(1); expect(accounts).toHaveLength(2);
    m.sourceVdn.mockResolvedValue({ id: 1, name: 'Reused ID' }); await expect(mapped()).rejects.toMatchObject({ statusCode: 409 });
  });
  it('rejects a missing authoritative VDN', async () => { m.sourceVdn.mockResolvedValue(null); await expect(mapped()).rejects.toMatchObject({ statusCode: 409 }); expect(maps).toHaveLength(0); });
});
describe('VDN-scoped business projection', () => {
  it('same WorkNO in two VDNs is two identities/memberships, never an overwrite', async () => {
    await mapped(1); await mapped(2); await syncManagedUser(payload(1, 20)); await syncManagedUser(payload(2, 21));
    expect(users.map(u => u.uid)).toEqual(['conf-vdn:1:20:2001', 'conf-vdn:2:21:2001']);
    expect(users.map(u => u.email)).toEqual([null, null]);
    expect(bindings).toHaveLength(2); expect(members.map(m => m.role)).toEqual([1, 1]);
    expect(members[0].account_id).not.toBe(members[1].account_id);
  });
  it('updates an existing bound source, hashes current credentials, and demotes old role0 membership', async () => {
    await mapped(); await syncManagedUser(payload()); members[0].role = 0;
    m.sourceUser.mockResolvedValue({ id: 20, work_no: '2001', name: 'Changed', email: 'NEW@example.test', enabled: 1 });
    m.rows.mockResolvedValue([{ password: 'synthetic-new-password' }]); await syncManagedUser(payload());
    expect(users).toHaveLength(1); expect(users[0]).toMatchObject({ name: 'Changed', email: 'new@example.test', encrypted_password: 'synthetic-hash:synthetic-new-password' }); expect(members[0].role).toBe(1);
  });
  it('disabled source removes membership; reenable restores only role1; deletion preserves user/data', async () => {
    await mapped(); await syncManagedUser(payload());
    m.sourceUser.mockResolvedValue({ id: 20, work_no: '2001', name: 'One', email: '', enabled: 0 }); await syncManagedUser(payload());
    expect(bindings[0].enabled).toBe(false); expect(members).toHaveLength(0);
    m.sourceUser.mockResolvedValue({ id: 20, work_no: '2001', name: 'One', email: '', enabled: 1 }); await syncManagedUser(payload()); expect(members[0].role).toBe(1);
    await expect(syncManagedUser({ ...payload(), action: 'delete' })).rejects.toMatchObject({ statusCode: 409 });
    m.sourceUser.mockResolvedValue(null); await syncManagedUser({ ...payload(), action: 'delete' }); expect(members).toHaveLength(0); expect(users).toHaveLength(1); expect(bindings[0].enabled).toBe(false);
  });
  it('will not adopt or overwrite a legacy identity with a conflicting email', async () => {
    await mapped(); users.push({ id: 99, uid: 'legacy', email: 'shared@example.test' });
    m.sourceUser.mockResolvedValue({ id: 20, work_no: '2001', name: 'One', email: 'shared@example.test', enabled: 1 });
    await expect(syncManagedUser(payload())).rejects.toMatchObject({ statusCode: 409 }); expect(users[0].uid).toBe('legacy'); expect(bindings).toHaveLength(0);
  });
  it('rejects source mismatch, missing mapping, reserved identity and missing/oversized current password', async () => {
    await expect(syncManagedUser(payload())).rejects.toMatchObject({ statusCode: 409 }); await mapped();
    m.sourceUser.mockResolvedValueOnce(null); await expect(syncManagedUser(payload())).rejects.toMatchObject({ statusCode: 409 });
    m.sourceUser.mockResolvedValueOnce({ work_no: 'different' }); await expect(syncManagedUser(payload())).rejects.toMatchObject({ statusCode: 409 });
    await expect(syncManagedUser({ ...payload(), work_no: 'conf-system:admin' })).rejects.toMatchObject({ statusCode: 409 });
    for (const password of ['', '中'.repeat(25)]) { m.rows.mockResolvedValueOnce([{ password }]); await expect(syncManagedUser(payload())).rejects.toMatchObject({ statusCode: 422 }); }
    expect(users).toHaveLength(0);
  });
  it('locks before source/credential reads and uses a bounded transaction timeout', async () => {
    await mapped(); await syncManagedUser(payload());
    expect(tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(m.sourceUser.mock.invocationCallOrder[0]);
    expect(m.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { maxWait: 10000, timeout: 30000 });
  });
});
