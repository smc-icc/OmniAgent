import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite';
import type { FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import type { Db } from '../modules/access/access.db.js';

const mocks = vi.hoisted(() => ({ membership: vi.fn(), pool: vi.fn() }));
vi.mock('../plugins/db.js', () => ({ prisma: { account_users: { findFirst: mocks.membership }, users: { findMany: async () => [{ id: 10, uid: '2001' }] } } }));
vi.mock('../shared/services/icc-groups-dal.js', () => ({ getIccMysqlPool: mocks.pool }));
vi.mock('../config/env.js', () => ({ env: { OMNI_AGENT_VDN_ID: 2 } }));
import { effectivePermissions, getAccess, requirePermission, context } from '../modules/access/access.context.js';
import { assertAcyclicParent, permissionForRoute, omniPermissions } from '../modules/access/access.policy.js';
import { accessRoutes } from '../modules/access/access.routes.js';
import { installAccessGuard } from '../modules/access/access.guard.js';
import { AppError, registerErrorHandler } from '../shared/errors/index.js';

// Vite 5 predates node:sqlite; load the native module without Vite's module resolver.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
let sql: SqliteDatabase;
let db: Db;
const req = () => ({ currentUser: { id: 10, uid: '2001' }, headers: { 'x-account-id': '999' }, query: { vdn_id: 1 } }) as unknown as FastifyRequest;
beforeEach(() => {
  sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE t_user_users (ID INTEGER, WorkNO TEXT, VDNID INTEGER, IsValid INTEGER);
    CREATE TABLE t_user_power (ID INTEGER, Name TEXT, Value INTEGER, SubSystemType INTEGER);
    CREATE TABLE t_user_grantpower (OwnerType INTEGER, OwnerId INTEGER, PowerId INTEGER, IsOwn INTEGER, VDNID INTEGER);
    CREATE TABLE t_omni_access_scope (VDNID INTEGER, OwnerType INTEGER, OwnerId INTEGER, PowerId INTEGER, ScopeType TEXT);
    CREATE TABLE t_user_usertorole (RoleID INTEGER, UserID INTEGER, VDNID INTEGER);
    CREATE TABLE t_user_usertodepart (departid INTEGER, UserID INTEGER, VDNID INTEGER);
    INSERT INTO t_user_users VALUES (20, '2001', 2, 1);
    INSERT INTO t_user_power VALUES (100, 'monitor', 69, 1), (101, 'service', 2, 90), (102, 'admin', 1, 90), (103, 'snatch', 3, 90);
    INSERT INTO t_user_usertorole VALUES (30, 20, 2), (99, 20, 1), (70, 20, -1);
    INSERT INTO t_user_usertodepart VALUES (40, 20, 2), (98, 20, 1);
    INSERT INTO t_user_grantpower VALUES (1, 30, 100, 1, 2), (2, 40, 101, 1, 2), (3, 20, 103, 1, 2),
      (1, 30, 102, 0, 2), (1, 99, 102, 1, 1), (2, 98, 102, 1, 1), (3, 21, 102, 1, 2), (1, 70, 102, 1, -1);`);
  db = { query: async (query: string, params: unknown[]) => [sql.prepare(query).all(...params as (string | number)[]), []] } as unknown as Db;
  mocks.pool.mockResolvedValue(db);
  mocks.membership.mockResolvedValue({ role: 1, account_id: 1, user_id: 10 });
});
afterEach(() => { sql.close(); vi.clearAllMocks(); });

describe('effective ICC permissions execute against a relational fixture', () => {
  it('unions direct, role, department grants; excludes disabled grants and other VDNs/users', async () => {
    const grants = await effectivePermissions(db, 2, 20);
    expect(grants.map(g => g.id).sort()).toEqual([100, 101, 103]);
    expect(new Set(grants.map(g => g.source))).toEqual(new Set(['role', 'department', 'direct']));
  });
  it('removing a direct grant preserves a department grant to the same permission', async () => {
    sql.exec('INSERT INTO t_user_grantpower VALUES (3, 20, 101, 1, 2); DELETE FROM t_user_grantpower WHERE OwnerType=3 AND PowerId=101');
    expect((await effectivePermissions(db, 2, 20)).find(p => p.id === 101)?.source).toBe('department');
  });
  it('preserves legacy global roles only for VDN 1', async () => {
    expect((await effectivePermissions(db, 1, 20)).some(p => p.owner_id === 70)).toBe(true);
    expect((await effectivePermissions(db, 2, 20)).some(p => p.owner_id === 70)).toBe(false);
  });
  it('returns no grants for another operator', async () => {
    expect(await effectivePermissions(db, 2, 999)).toEqual([]);
  });
});
describe('trusted scope and management authorization', () => {
  it('ignores client VDN/account overrides', async () => {
    const ctx = await context(req());
    expect(ctx.vdnId).toBe(2); expect(ctx.accountId).toBe(1);
    expect(mocks.membership).toHaveBeenCalledWith({ where: { account_id: 1, user_id: 10 } });
  });
  it('denies a regular operator management but allows inherited service permission', async () => {
    await expect(requirePermission(req(), 'access.manage')).rejects.toMatchObject({ statusCode: 403 });
    await expect(requirePermission(req(), 'omni.service')).resolves.toMatchObject({ agentId: 20 });
  });
  it('recognizes a management grant through a role and reflects revocation immediately', async () => {
    sql.exec('UPDATE t_user_grantpower SET IsOwn=1 WHERE OwnerType=1 AND OwnerId=30 AND PowerId=102');
    await expect(requirePermission(req(), 'access.manage')).resolves.toMatchObject({ agentId: 20 });
    sql.exec('UPDATE t_user_grantpower SET IsOwn=0 WHERE OwnerType=1 AND OwnerId=30 AND PowerId=102');
    await expect(requirePermission(req(), 'access.manage')).rejects.toMatchObject({ statusCode: 403 });
  });
  it('grants account administrator access without promoting ordinary role members', async () => {
    mocks.membership.mockResolvedValue({ role: 0 });
    const access=await getAccess(req());
    expect(access.permissions).toHaveLength(omniPermissions.length-4);
    expect(access.permissions).not.toContain('extension.assign');
    expect(access.permissions).not.toContain('extension.bind_self');
  });
  it('rejects anonymous, non-members and disabled operators including administrators', async () => {
    await expect(context({ currentUser: null } as FastifyRequest)).rejects.toMatchObject({ statusCode: 401 });
    mocks.membership.mockResolvedValueOnce(null);
    await expect(context(req())).rejects.toMatchObject({ statusCode: 403 });
    sql.exec('UPDATE t_user_users SET IsValid=0');
    mocks.membership.mockResolvedValue({ role: 0 });
    await expect(context(req())).rejects.toMatchObject({ statusCode: 403 });
  });
});
describe('department hierarchy and guarded business operations', () => {
  const tree = [{ id: 1, parent_id: -1 }, { id: 2, parent_id: 1 }, { id: 3, parent_id: 2 }];
  it('rejects self-parenting, descendant-parenting and unknown parents', () => {
    expect(() => assertAcyclicParent(1, 1, tree)).toThrow();
    expect(() => assertAcyclicParent(1, 3, tree)).toThrow();
    expect(() => assertAcyclicParent(1, 55, tree)).toThrow();
    expect(() => assertAcyclicParent(3, 1, tree)).not.toThrow();
  });
  it.each([
    ['POST', '/api/v1/accounts/1/agents', 'access.manage'],
    ['PUT', '/api/v1/accounts/1/custom_roles/5', 'access.manage'],
    ['POST', '/api/omnichannel/workspace/snatch', 'conversation.snatch'],
    ['POST', '/api/omnichannel/workspace/ims-force', 'monitor.force'],
    ['GET', '/api/omnichannel/workspace/queue-sessions?page=1', 'conversation.queue'],
    ['POST', '/api/v1/accounts/1/conversations/4/messages', 'conversation.reply'],
    ['GET', '/api/v1/qc/results', 'inspection.read'],
    ['POST', '/api/v1/outbound/tasks/1/start', 'outbound.execute'],
    ['PATCH', '/api/customers/9', 'customer.update'],
  ])('protects %s %s', (method, path, permission) => expect(permissionForRoute(method, path)).toBe(permission));
  it('does not guard public webhook and login endpoints with agent permissions', () => {
    expect(permissionForRoute('POST', '/auth/sign_in')).toBeNull();
    expect(permissionForRoute('POST', '/api/internal/aiqc/task-updated')).toBeNull();
  });
});

describe('HTTP authorization cannot be bypassed by calling mutation endpoints directly', () => {
  it('rejects every management mutation before changing data', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.decorate('authenticate', async (request: FastifyRequest) => { if (!request.currentUser) throw new AppError(401, 'login required'); });
    app.addHook('onRequest', async request => { request.currentUser = req().currentUser; });
    await app.register(accessRoutes);
    try {
      const endpoints = [
        ['POST', '/api/access/users'], ['PUT', '/api/access/users/20'], ['POST', '/api/access/users/20/sync'],
        ['PATCH', '/api/access/users/20/permissions'], ['POST', '/api/access/entities/roles'],
        ['PUT', '/api/access/entities/roles/30'], ['DELETE', '/api/access/entities/roles/30'],
        ['PATCH', '/api/access/entities/departments/40/members'], ['PATCH', '/api/access/entities/roles/30/permissions'],
        ['POST', '/api/access/extensions'], ['PUT', '/api/access/extensions/110001'], ['DELETE', '/api/access/extensions/110001'],
      ] as const;
      for (const [method, url] of endpoints) {
        const response = await app.inject({ method, url });
        expect(response.statusCode, `${method} ${url}`).toBe(403);
      }
      expect(sql.prepare('SELECT COUNT(*) AS total FROM t_user_users').get()?.total).toBe(1);
    } finally { await app.close(); }
  });
  it('guards encoded legacy paths using the matched route and rejects another account', async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.decorate('authenticate', async () => undefined);
    app.addHook('onRequest', async request => { request.currentUser = req().currentUser; });
    installAccessGuard(app);
    app.post('/api/v1/accounts/:account_id/agents', async () => ({ ok: true }));
    try {
      expect((await app.inject({ method: 'POST', url: '/api/v1/accounts/%31/agents' })).statusCode).toBe(403);
      mocks.membership.mockResolvedValue({ role: 0 });
      expect((await app.inject({ method: 'POST', url: '/api/v1/accounts/999/agents' })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v1/accounts/1/agents' })).statusCode).toBe(200);
    } finally { await app.close(); }
  });
});
