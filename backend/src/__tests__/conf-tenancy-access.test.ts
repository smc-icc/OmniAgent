import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite';
import type { FastifyRequest } from 'fastify';
import Fastify from 'fastify';
const mocks = vi.hoisted(() => ({ pool: vi.fn(), binding: vi.fn(), mapping: vi.fn(), membership: vi.fn(), maps: vi.fn(), account: vi.fn(), conversation: vi.fn(), user: vi.fn(), scopedConversation: vi.fn() }));
vi.mock('../plugins/db.js', () => ({ prisma: {
  conf_user_bindings: { findUnique: mocks.binding }, conf_vdn_accounts: { findUnique: mocks.mapping, findMany: mocks.maps, findFirst: mocks.mapping },
  account_users: { findFirst: mocks.membership }, accounts: { findUnique: mocks.account }, conversations: { findUnique: mocks.conversation, findFirst: mocks.scopedConversation }, users: { findUnique: mocks.user, findMany: async () => [] },
} }));
vi.mock('../shared/services/icc-groups-dal.js', () => ({ getIccMysqlPool: mocks.pool }));
vi.mock('../config/env.js', () => ({ env: { OMNI_AGENT_VDN_ID: 999, CCS_WORK_NO_FIELD: 'uid' } }));
// These fixtures exercise tenant authority; SID and social revocation have separate integration tests.
vi.mock('../shared/services/login-session.js', () => ({ isCurrentSession: () => true,
  assertCurrentLogin: () => {}, getLoginSession: () => undefined, revokeLogin: () => false }));
import { secureSocket, socketAccess, socketMayRead, secureBroadcasts } from '../modules/access/access.socket.js';
import { installAccessGuard } from '../modules/access/access.guard.js';
import { registerErrorHandler } from '../shared/errors/index.js';
import { assertLiveBinding, managedContext, tenantSelectors, listManagedTenants, managedUid, managedIdentity, vdnForConversation } from '../shared/services/conf-tenancy.js';
import { getAccess, requirePermission } from '../modules/access/access.context.js';
import { modelScope, accessScope } from '../modules/access/access.scope.js';
import { authorizedJob } from '../modules/access/access.jobs.js';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
let sql: SqliteDatabase;
const maps = [{ vdn_id: 1, account_id: 71, enabled: true }, { vdn_id: 2, account_id: 82, enabled: true }];
const req = (extra: Record<string, unknown> = {}) => ({ currentUser: { id: 10, uid: managedUid(1, 20, '2001') }, headers: {}, ...extra }) as unknown as FastifyRequest;
const root = (extra: Record<string, unknown> = {}) => req({ currentUser: { id: 9, uid: 'conf-system:admin', type: 'SuperAdmin' }, ...extra });
beforeEach(() => {
  vi.stubEnv('CONF_TENANCY_ENABLED', '1'); vi.resetAllMocks();
  sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE t_icc_vdn (ID INTEGER, Name TEXT);
    CREATE TABLE t_user_users (ID INTEGER, WorkNO TEXT, Name TEXT, Email TEXT, VDNID INTEGER, IsValid INTEGER);
    CREATE TABLE t_user_power (ID INTEGER, Name TEXT, Value INTEGER, SubSystemType INTEGER);
    CREATE TABLE t_user_grantpower (OwnerType INTEGER, OwnerId INTEGER, PowerId INTEGER, IsOwn INTEGER, VDNID INTEGER);
    CREATE TABLE t_omni_access_scope (VDNID INTEGER, OwnerType INTEGER, OwnerId INTEGER, PowerId INTEGER, ScopeType TEXT);
    CREATE TABLE t_user_usertorole (RoleID INTEGER, UserID INTEGER, VDNID INTEGER);
    CREATE TABLE t_user_usertogroup (GroupID INTEGER, UserID INTEGER, VDNID INTEGER);
    CREATE TABLE t_user_usertodepart (departid INTEGER, UserID INTEGER, VDNID INTEGER);
    INSERT INTO t_icc_vdn VALUES (1, 'One'), (2, 'Two');
    INSERT INTO t_user_users VALUES (20, '2001', 'One user', '', 1, 1), (21, '2001', 'Two user', '', 2, 1);
    INSERT INTO t_user_power VALUES (101, 'service', 2, 90), (102, 'admin', 1, 90), (103, 'snatch', 3, 90);
    INSERT INTO t_user_usertorole VALUES (30, 20, 1), (99, 21, -1);
    INSERT INTO t_user_usertodepart VALUES (40, 20, 1);
    INSERT INTO t_user_grantpower VALUES (1, 30, 102, 1, 1), (2, 40, 101, 1, 1), (3, 20, 103, 1, 1), (1, 99, 102, 1, -1), (3, 21, 102, 1, 2);`);
  mocks.pool.mockResolvedValue({ query: async (query: string, params: (string | number)[]) => [sql.prepare(query).all(...params), []] });
  mocks.binding.mockResolvedValue({ vdn_id: 1, source_user_id: 20, user_id: 10, work_no: '2001', enabled: true });
  mocks.mapping.mockImplementation(async ({ where }: any) => where ? maps.find(m => where.account_id ? m.account_id === where.account_id : m.vdn_id === where.vdn_id) : maps[0]);
  mocks.maps.mockResolvedValue(maps);
  mocks.user.mockImplementation(async ({ where }: any) => where.id === 9 ? root().currentUser : req().currentUser);
  mocks.scopedConversation.mockResolvedValue({ id: 123 });
  mocks.membership.mockResolvedValue({ user_id: 10, account_id: 71, role: 0 }); // Role 0 must NOT grant a global bypass.
  mocks.account.mockImplementation(async ({ where }: any) => ({ id: where.id, name: 'Mapped account' }));
});
afterEach(() => { sql.close(); vi.unstubAllEnvs(); });
describe('managed tenant authority and selectors', () => {
  it('uses persisted mapping rather than environment defaults and trusts no client-selected grant', async () => {
    const r = req(); expect(await managedContext(r)).toMatchObject({ accountId: 71, vdnId: 1, agentId: 20, administrator: false });
    expect(r.currentAccount?.id).toBe(71);
    expect(mocks.membership).toHaveBeenCalledWith({ where: { account_id: 71, user_id: 10 } });
  });
  it.each([{ headers: { 'x-account-id': '82' } }, { query: { VDNID: 2 } }, { body: { accountId: 82 } }])('ordinary user cannot select another tenant %j', async extra => {
    await expect(managedContext(req(extra))).rejects.toMatchObject({ statusCode: 403 });
  });
  it('singleton can select any live mapped tenant without tenant membership', async () => {
    expect(await managedContext(root({ headers: { 'x-account-id': '82' }, query: { vdnId: 2 } }))).toMatchObject({ accountId: 82, vdnId: 2, administrator: true });
    expect(mocks.binding).not.toHaveBeenCalled(); expect(mocks.membership).not.toHaveBeenCalled();
  });
  it('a type-only or uid-only claim is not the singleton', async () => {
    mocks.binding.mockResolvedValue(null);
    for (const currentUser of [{ id: 10, uid: 'other', type: 'SuperAdmin' }, { id: 10, uid: 'conf-system:admin' }]) {
      await expect(managedContext(req({ currentUser }))).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it('rejects contradictory account/VDN selectors even for singleton', async () => {
    expect(() => tenantSelectors(root({ headers: { 'x-account-id': '71' }, body: { accountId: 82 } }))).toThrow();
    await expect(managedContext(root({ headers: { 'x-account-id': '71' }, query: { VDNID: 2 } }))).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(['0', '-1', '1e0', '1.0', ' 1', '9007199254740992', ['1'], {}])('rejects noncanonical IDs %j', id => {
    expect(() => tenantSelectors(req({ headers: { 'x-account-id': id } }))).toThrow();
  });
  it('lists only authorized tenants for business users, all live mappings for singleton', async () => {
    expect((await listManagedTenants(req())).tenants.map(t => t.account_id)).toEqual([71]);
    expect((await listManagedTenants(root())).tenants.map(t => t.account_id)).toEqual([71, 82]);
    sql.exec('DELETE FROM t_icc_vdn WHERE ID=2');
    expect((await listManagedTenants(root())).tenants.map(t => t.account_id)).toEqual([71]);
  });
  it('same WorkNO in different VDNs has a distinct durable namespace', () => {
    expect(managedUid(1, 20, '2001')).not.toBe(managedUid(2, 21, '2001'));
    expect(managedIdentity(managedUid(2, 21, 'a:b/中'))).toEqual({ vdnId: 2, sourceId: 21, workNo: 'a:b/中' });
    expect(managedIdentity('conf-vdn:2:21:%GG')).toBeNull();
  });
});
describe('live disable, deletion and grant revocation', () => {
  it.each(["UPDATE t_user_users SET IsValid=0 WHERE ID=20", "DELETE FROM t_user_users WHERE ID=20", "UPDATE t_user_users SET WorkNO='reused' WHERE ID=20", "DELETE FROM t_icc_vdn WHERE ID=1"])('denies immediately without waiting for projection %s', async mutation => {
    sql.exec(mutation); await expect(assertLiveBinding(10)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('denies missing/disabled durable binding, disabled map and removed membership', async () => {
    mocks.binding.mockResolvedValueOnce(null); await expect(assertLiveBinding(10)).rejects.toMatchObject({ statusCode: 403 });
    mocks.binding.mockResolvedValueOnce({ enabled: false }); await expect(assertLiveBinding(10)).rejects.toMatchObject({ statusCode: 403 });
    mocks.mapping.mockResolvedValueOnce({ ...maps[0], enabled: false }); await expect(assertLiveBinding(10)).rejects.toMatchObject({ statusCode: 403 });
    mocks.membership.mockResolvedValueOnce(null); await expect(assertLiveBinding(10)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('ICC unavailable fails closed', async () => { mocks.pool.mockResolvedValue(null); await expect(getAccess(req())).rejects.toMatchObject({ statusCode: 503 }); });
  it('role 0 has no bypass; role, department, direct and membership revocations affect the next call', async () => {
    expect((await getAccess(req())).permissions.sort()).toEqual(['access.manage', 'omni.service', 'omni.snatch']);
    sql.exec('DELETE FROM t_user_usertorole WHERE RoleID=30');
    await expect(requirePermission(req(), 'access.manage')).rejects.toMatchObject({ statusCode: 403 }); // Other source users cannot lend this identity their grants
    sql.exec('DELETE FROM t_user_usertodepart WHERE departid=40');
    await expect(requirePermission(req(), 'omni.service')).rejects.toMatchObject({ statusCode: 403 });
    sql.exec('UPDATE t_user_grantpower SET IsOwn=0 WHERE OwnerType=3 AND OwnerId=20');
    await expect(requirePermission(req(), 'omni.snatch')).rejects.toMatchObject({ statusCode: 403 });
    expect((await getAccess(req())).permissions).toEqual([]);
  });
  it('data scope is still tenant-qualified even when singleton has account-wide permission', () => {
    const scope = { userId: 9, accountId: 82, vdnId: 2, agentId: 0, administrator: true, all: true, userIds: [9], agentIds: [], workNos: [], scopes: ['account'], permission: 'conversation.read' } as any;
    expect(modelScope('conversations', scope, new Set(['account_id']))).toMatchObject({ account_id: 82 });
  });
  it('background conversation VDN is mapped, never the process default', async () => {
    mocks.conversation.mockResolvedValue({ account_id: 82 }); expect(await vdnForConversation(123, 999)).toBe(2);
    mocks.mapping.mockResolvedValueOnce(null); await expect(vdnForConversation(123, 999)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('tenant-scoped HTTP and existing socket sessions', () => {
  it('an ordinary access.manage grantee still cannot mutate global platform configuration', async () => {
    const app = Fastify(); registerErrorHandler(app);
    app.decorate('authenticate', async () => undefined);
    app.addHook('onRequest', async r => { r.currentUser = req().currentUser; });
    installAccessGuard(app);
    const mutated = vi.fn(() => ({ ok: true }));
    app.post('/platform/api/v1/users', mutated); app.post('/api/v1/accounts', mutated);
    try {
      for (const url of ['/platform/api/v1/users', '/api/v1/accounts']) expect((await app.inject({ method: 'POST', url })).statusCode).toBe(403);
      expect(mutated).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('tenant parameters on guarded routes cannot escape the persistent ordinary binding', async () => {
    const app = Fastify(); registerErrorHandler(app); app.decorate('authenticate', async () => undefined);
    app.addHook('onRequest', async r => { r.currentUser = req().currentUser; }); installAccessGuard(app);
    app.get('/api/access/me', r => ({ account: r.currentAccount?.id }));
    try {
      expect((await app.inject({ url: '/api/access/me', headers: { 'x-account-id': '82' } })).statusCode).toBe(403);
      expect((await app.inject({ url: '/api/access/me', headers: { 'x-account-id': '71' } })).json()).toEqual({ account: 71 });
    } finally { await app.close(); }
  });
  it('socket access uses selected mapping and revalidates source disable on every packet', async () => {
    expect(await socketAccess(9, 'synthetic', 82)).toMatchObject({ accountId: 82, vdnId: 2 });
    await expect(socketAccess(10, 'synthetic', 82)).rejects.toMatchObject({ statusCode: 403 });
    expect(await socketAccess(10, 'synthetic', 71)).toMatchObject({ accountId: 71, administrator: false });
    sql.exec('UPDATE t_user_users SET IsValid=0 WHERE ID=20');
    await expect(socketAccess(10, 'synthetic', 71)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('singleton switching rooms drops the old account and conversation subscriptions', async () => {
    let middleware: any; const socket = { data: { userId: 9, sid: 'synthetic', accountId: 71 }, rooms: new Set(['own-socket', 'user:9', 'account:71', 'conversation:100']),
      use: (fn: any) => { middleware = fn; }, leave: vi.fn(async (_room: string) => undefined), emit: vi.fn() };
    secureSocket(socket as any); const next = vi.fn(); await middleware(['subscribe', { account_id: 82 }], next);
    expect(next).toHaveBeenCalledWith(); expect(socket.leave.mock.calls.map(c => c[0])).toEqual(['account:71', 'conversation:100']); expect(socket.data.accountId).toBe(82);
  });
  it('ordinary cross-tenant subscription is rejected before it can join a room', async () => {
    let middleware: any; const socket = { data: { userId: 10, sid: 'synthetic', accountId: 71 }, rooms: new Set(['account:71']), use: (fn: any) => { middleware = fn; }, leave: vi.fn(), emit: vi.fn() };
    secureSocket(socket as any); const next = vi.fn(); await middleware(['subscribe', { account_id: 82 }], next);
    expect(next).toHaveBeenCalledWith(expect.any(Error)); expect(socket.leave).not.toHaveBeenCalled(); expect(socket.data.accountId).toBe(71);
  });
  it('a revoked business binding receives no further tenant broadcasts', async () => {
    const broadcast = vi.fn(), adapter = { broadcast };
    const io = { of: () => ({ adapter }), in: () => ({ except: () => ({ fetchSockets: async () => [{ id: 'business', data: { userId: 10, sid: 'synthetic', accountId: 71 } }] }) }) };
    secureBroadcasts(io as any);
    (adapter.broadcast as any)({ data: ['ccs.agent', { vdnId: 1 }] }, { rooms: new Set(['account:71']), except: new Set() });
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledTimes(1));
    sql.exec('UPDATE t_user_users SET IsValid=0 WHERE ID=20');
    (adapter.broadcast as any)({ data: ['ccs.agent', { vdnId: 1 }] }, { rooms: new Set(['account:71']), except: new Set() });
    await new Promise(r => setTimeout(r, 25)); expect(broadcast).toHaveBeenCalledTimes(1);
  });
});

describe('managed queued authorization', () => {
  it('revalidates the singleton against the selected queued tenant rather than the first VDN', async () => {
    const processor = vi.fn(async () => accessScope.getStore()?.accountId);
    const result = await authorizedJob(processor)({ data: { __omniAccess: { userId: 9, accountId: 82, permission: 'conversation.read' } } } as any);
    expect(result).toBe(82); expect(processor).toHaveBeenCalledTimes(1);
  });
  it('cannot broaden an ordinary queued job to another VDN', async () => {
    const processor = vi.fn();
    await expect(authorizedJob(processor)({ data: { __omniAccess: { userId: 10, accountId: 82, permission: 'conversation.read' } } } as any)).rejects.toThrow();
    expect(processor).not.toHaveBeenCalled();
  });
  it('rechecks grants when executing an already queued job', async () => {
    const processor = vi.fn();
    sql.exec('UPDATE t_user_grantpower SET IsOwn=0');
    await expect(authorizedJob(processor)({ data: { __omniAccess: { userId: 10, accountId: 71, permission: 'conversation.read' } } } as any)).rejects.toThrow('access_revoked');
    expect(processor).not.toHaveBeenCalled();
  });
});
