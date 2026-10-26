import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql, { type Pool } from 'mysql2/promise';
const mocks = vi.hoisted(() => ({
  pool: vi.fn(),
  membership: vi.fn(),
  findUser: vi.fn(),
  findUsers: vi.fn(),
  revoke: vi.fn(),
  remote: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('../shared/services/icc-groups-dal.js', () => ({ getIccMysqlPool: mocks.pool }));
vi.mock('../config/env.js', () => ({ env: { OMNI_AGENT_VDN_ID: 2, CCS_WORK_NO_FIELD: 'uid' } }));
vi.mock('../plugins/db.js', () => ({
  prisma: {
    account_users: { findFirst: mocks.membership },
    users: { findUnique: mocks.findUser, findMany: mocks.findUsers },
  },
}));
vi.mock('../integrations/ccs/ccs-client.js', () => ({ invokeDoAgent: mocks.invoke }));
vi.mock('../modules/extension-binding/sip-revocation.js', () => ({
  revokeSipCredentials: mocks.revoke,
}));
vi.mock('../modules/extension-binding/ccs-state.js', () => ({ remoteVoice: mocks.remote }));
import { AppError } from '../shared/errors/index.js';
import * as service from '../modules/extension-binding/service.js';
import * as repository from '../modules/extension-binding/repository.js';
import { getOrCreateSession, clearAllSessions } from '../integrations/ccs/session-manager.js';
import { occupyLogin, resetLoginSessions } from '../shared/services/login-session.js';
const run = promisify(execFile),
  container = 'omni-extension-test-' + randomUUID(),
  password = 'fixture-' + randomUUID();
let pool: Pool;
const ids: Record<number, string> = { 10: 'seat10', 11: 'seat11', 99: 'manager99' };
const request = (id: number = 10) =>
  ({
    currentUser: { id, uid: ids[id], name: 'Fixture', accounts: [] },
    headers: {},
    user: { sid: 'fixture-sid' },
    server: { emitToUser: vi.fn() },
  }) as never;
const change = (extension: string, version = 0, key = randomUUID()) => ({
  extension,
  expected_version: version,
  idempotency_key: key,
});
async function sql(query: string, params: unknown[] = []) {
  const [result] = await pool.query(query, params);
  return result as Array<Record<string, unknown>>;
}
beforeAll(async () => {
  await run('docker', [
    'run',
    '--detach',
    '--name',
    container,
    '--publish',
    '127.0.0.1::3306',
    '--env',
    'MYSQL_ROOT_PASSWORD=' + password,
    '--env',
    'MYSQL_DATABASE=icc_extension_test',
    'mysql:8.0',
  ]);
  const port = Number(
    (await run('docker', ['port', container, '3306/tcp'])).stdout.trim().split(':').at(-1),
  );
  pool = mysql.createPool({
    host: '127.0.0.1',
    port,
    user: 'root',
    password,
    database: 'icc_extension_test',
    multipleStatements: true,
    connectionLimit: 12,
  });
  let ready = false;
  for (let i = 0; i < 45; i++) {
    try {
      await pool.query('SELECT 1');
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!ready) throw Error('isolated MySQL failed to start');
  await pool.query(`CREATE TABLE t_user_users(ID INT PRIMARY KEY, WorkNO VARCHAR(50), VDNID INT, IsValid INT, IsSystem INT, ExtensionTel VARCHAR(50), PassWord VARCHAR(50)) ENGINE=InnoDB;
    CREATE TABLE t_icc_base_extension(Num VARCHAR(50) PRIMARY KEY,VDN INT,IsValid INT,Device INT,Description VARCHAR(100)) ENGINE=InnoDB;
    CREATE TABLE t_icc_sip_directory(username VARCHAR(50) PRIMARY KEY,vdn_id INT,password VARCHAR(100),domain VARCHAR(100),enabled INT) ENGINE=InnoDB;
    CREATE TABLE t_icc_telag_staticlogin(id INT PRIMARY KEY,VDNID INT,ExtNum VARCHAR(50),IfUse INT) ENGINE=InnoDB;
    CREATE TABLE t_user_power(ID INT PRIMARY KEY,Name VARCHAR(100),Value INT,SubSystemType INT) ENGINE=InnoDB;
    CREATE TABLE t_user_grantpower(OwnerType INT,OwnerId INT,PowerId INT,IsOwn INT,VDNID INT) ENGINE=InnoDB;
    CREATE TABLE t_omni_access_scope(VDNID INT,OwnerType INT,OwnerId INT,PowerId INT,ScopeType VARCHAR(30)) ENGINE=InnoDB;
    CREATE TABLE t_user_usertorole(RoleID INT,UserID INT,VDNID INT) ENGINE=InnoDB;
    CREATE TABLE t_user_usertodepart(departid INT,UserID INT,VDNID INT) ENGINE=InnoDB;`);
  await pool.query(
    await readFile(new URL('../../sql/extension-binding.sql', import.meta.url), 'utf8'),
  );
}, 90000);
afterAll(async () => {
  await pool?.end();
  await run('docker', ['rm', '--force', '--volumes', container]).catch(() => undefined);
}, 30000);
beforeEach(async () => {
  clearAllSessions();
  resetLoginSessions();
  vi.clearAllMocks();
  mocks.pool.mockResolvedValue(pool);
  mocks.membership.mockResolvedValue({ role: 1 });
  mocks.findUser.mockImplementation(async ({ where }: { where: { id: number } }) => ({
    id: where.id,
    uid: ids[where.id],
    name: 'Fixture',
  }));
  mocks.findUsers.mockImplementation(async ({ where }: { where: { uid: string } }) =>
    Object.entries(ids)
      .filter(([, uid]) => uid === where.uid)
      .map(([id, uid]) => ({ id: Number(id), uid })),
  );
  mocks.revoke.mockResolvedValue(undefined);
  mocks.remote.mockResolvedValue(null);
  mocks.invoke.mockResolvedValue({ ret: 0, rsp: { err: 0 } });
  await pool.query(`DELETE FROM t_omni_extension_audit;DELETE FROM t_omni_extension_operation;DELETE FROM t_omni_extension_request;DELETE FROM t_omni_extension_binding;DELETE FROM t_omni_extension_voice;DELETE FROM t_user_users;DELETE FROM t_icc_base_extension;DELETE FROM t_icc_sip_directory;DELETE FROM t_icc_telag_staticlogin;DELETE FROM t_user_power;DELETE FROM t_user_grantpower;
    INSERT INTO t_user_users VALUES(20,'seat10',2,1,0,'','private10'),(21,'seat11',2,1,0,'','private11'),(29,'manager99',2,1,0,'','private99'),(31,'otherVDN',3,1,0,'','private31');
    INSERT INTO t_icc_base_extension VALUES('1001',2,1,0,''),('1002',2,1,0,''),('1003',2,0,0,''),('3001',3,1,0,''),('1004',2,1,0,'');
    INSERT INTO t_icc_sip_directory VALUES('1001',2,'sip1','fixture.test',1),('1002',2,'sip2','fixture.test',1),('1003',2,'sip3','fixture.test',1),('3001',3,'sip4','fixture.test',1),('1004',2,'sip5','fixture.test',1);
    INSERT INTO t_icc_telag_staticlogin VALUES(1,2,'1004',1);
    INSERT INTO t_user_power VALUES(502,'assign',502,90),(503,'approve',503,90),(500,'self bind',500,90),(501,'self unbind',501,90);
    INSERT INTO t_user_grantpower VALUES(3,29,502,1,2),(3,29,503,1,2);`);
});
describe('real isolated MySQL binding transactions', () => {
  it('filters disabled, foreign VDN and phone-autologin numbers without reserving requests', async () => {
    expect((await repository.extensionOptions(pool, 2)).map((e) => e.num)).toEqual([
      '1001',
      '1002',
    ]);
    await service.submitRequest(request(), change('1001'));
    expect((await repository.extensionOptions(pool, 2)).map((e) => e.num)).toContain('1001');
  });
  it('returns the original request for a repeated key and allows only one pending request', async () => {
    const body = change('1001'),
      first = await service.submitRequest(request(), body),
      again = await service.submitRequest(request(), body);
    expect(first.id).toBe(again.id);
    await expect(service.submitRequest(request(), change('1002'))).rejects.toMatchObject({
      statusCode: 409,
    });
    await service.decideRequest(request(), first.id, 'cancel');
    expect((await service.submitRequest(request(), change('1002'))).target_extension).toBe('1002');
  });
  it('denies direct self changes by default', async () => {
    await expect(service.reserveChange(request(), 20, change('1001'), true)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it('commits binding and version once, and rejects reused keys with different payloads', async () => {
    const req = request(99),
      body = change('1001'),
      first = await service.reserveChange(req, 20, body, false),
      again = await service.reserveChange(req, 20, body, false);
    expect(first).toMatchObject({ status: 'completed' });
    expect(again).toMatchObject({ status: 'completed' });
    expect((await repository.readBinding(pool, 2, 20)).version).toBe(1);
    expect(mocks.revoke).toHaveBeenCalledOnce();
    await expect(
      service.reserveChange(req, 20, { ...body, extension: '1002' }, false),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('serializes concurrent allocations of the same extension', async () => {
    const results = await Promise.allSettled([
      service.reserveChange(request(99), 20, change('1001'), false),
      service.reserveChange(request(99), 21, change('1001'), false),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await sql("SELECT ID FROM t_user_users WHERE ExtensionTel='1001'")).toHaveLength(1);
  });
  it('marks an obsolete application stale instead of overwriting a newer allocation', async () => {
    const r = await service.submitRequest(request(), change('1001'));
    await service.reserveChange(request(99), 20, change('1002'), false);
    expect(await service.approveRequest(request(99), r.id)).toMatchObject({ status: 'stale' });
    expect((await repository.requestById(pool, 2, r.id)).status).toBe('stale');
    expect((await repository.readBinding(pool, 2, 20)).extension).toBe('1002');
  });
  it('keeps applications pending while the target has an active call', async () => {
    const r = await service.submitRequest(request(), change('1001'));
    const s = getOrCreateSession(10);
    s.status = 'ringing';
    s.currentCall = { CallID: 123 };
    expect(await service.approveRequest(request(99), r.id)).toMatchObject({ status: 'pending' });
    expect((await repository.requestById(pool, 2, r.id)).status).toBe('pending');
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it('preserves the old binding and reservation after CCS sign-out failure, then resumes the same operation', async () => {
    await sql("UPDATE t_user_users SET ExtensionTel='1001' WHERE ID=20");
    const login = occupyLogin({ userId: 10, deviceId: 'fixture-device' }).session;
    await sql(
      "INSERT INTO t_omni_extension_voice (OmniUserID,VDNID,UserID,LoginSID,BindingVersion,LoginContext,State,AgentID) VALUES (10,2,20,?,0,?,'signed_in',55)",
      [login.sessionId, JSON.stringify(login)],
    );
    const s = getOrCreateSession(10);
    Object.assign(s, {
      workNO: 'seat10',
      extension: '1001',
      loginSessionId: login.sessionId,
      bindingVersion: 0,
      loggedIn: true,
      agentId: 55,
      vdnId: 2,
      status: 'idle',
    });
    mocks.remote.mockResolvedValue({ agentId: 55, status: 32 });
    const handle = vi.fn(async (_user: number, _id: string, method: string) => ({
      Result: method === 'DoAgentLoggedOff' ? 7 : 0,
    }));
    const req = request(99) as unknown as { server: unknown };
    req.server = {
      ccsBridge: {
        handleInvoke: handle,
        logoutWithConfirmation: async () => {
          const result = await handle(10, 'fixture-logout', 'DoAgentLoggedOff');
          if (result.Result !== 0) throw new Error('CCS sign-out failed');
          s.loggedIn = false;
        },
      },
      emitToUser: vi.fn(),
    };
    const body = change('1002');
    expect(await service.reserveChange(req as never, 20, body, false)).toMatchObject({
      status: 'retryable',
    });
    expect((await repository.readBinding(pool, 2, 20)).extension).toBe('1001');
    expect((await repository.activeOperation(pool, 2, 20))?.phase).toBe('draining');
    expect(mocks.revoke).not.toHaveBeenCalled();
    handle.mockImplementation(async () => ({ Result: 0 }));
    expect(await service.reserveChange(req as never, 20, body, false)).toMatchObject({
      status: 'completed',
    });
    expect((await repository.readBinding(pool, 2, 20)).extension).toBe('1002');
  });
  it('returns a request to pending and frees the target when a call starts after reservation', async () => {
    await sql("UPDATE t_user_users SET ExtensionTel='1001' WHERE ID=20");
    const r = await service.submitRequest(request(), change('1002'));
    mocks.remote.mockRejectedValue(new AppError(409, 'active call', 'extension_call_active'));
    expect(await service.approveRequest(request(99), r.id)).toMatchObject({ status: 'pending' });
    expect((await repository.requestById(pool, 2, r.id)).status).toBe('pending');
    expect(await repository.activeOperation(pool, 2, 20)).toBeNull();
    expect((await repository.extensionOptions(pool, 2)).map((e) => e.num)).toContain('1002');
    await service.decideRequest(request(), r.id, 'cancel');
    expect((await repository.requestById(pool, 2, r.id)).status).toBe('cancelled');
  });
  it('keeps failed execution attempts in append-only audit after a later successful retry', async () => {
    mocks.revoke.mockRejectedValueOnce(new AppError(503, 'SIP temporarily unavailable'));
    const body = change('1001');
    expect(await service.reserveChange(request(99), 20, body, false)).toMatchObject({
      status: 'retryable',
    });
    expect(await service.reserveChange(request(99), 20, body, false)).toMatchObject({
      status: 'completed',
    });
    const events = await sql(
      'SELECT Result,Reason FROM t_omni_extension_audit WHERE UserID=20 ORDER BY ID',
    );
    expect(
      events.some((e) => e.Result === 'retryable' && e.Reason === 'SIP temporarily unavailable'),
    ).toBe(true);
    expect(events.at(-1)?.Result).toBe('success');
  });
  it('enforces old editor guards while the dedicated transaction can commit', async () => {
    const guards = (
      await readFile(new URL('../../sql/extension-binding-guards.sql', import.meta.url), 'utf8')
    )
      .split('-- statement')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      for (const guard of guards) await pool.query(guard);
      await expect(
        sql("UPDATE t_user_users SET ExtensionTel='1001' WHERE ID=20"),
      ).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' });
      await expect(
        sql("INSERT INTO t_user_users VALUES(70,'bypass',2,1,0,'1002','private')"),
      ).rejects.toMatchObject({ code: 'ER_SIGNAL_EXCEPTION' });
      expect(await service.reserveChange(request(99), 20, change('1001'), false)).toMatchObject({
        status: 'completed',
      });
      await expect(sql('DELETE FROM t_user_users WHERE ID=20')).rejects.toMatchObject({
        code: 'ER_SIGNAL_EXCEPTION',
      });
      expect((await repository.readBinding(pool, 2, 20)).version).toBe(1);
    } finally {
      for (const name of [
        'omni_extension_update_guard',
        'omni_extension_insert_guard',
        'omni_extension_delete_guard',
      ])
        await sql('DROP TRIGGER IF EXISTS ' + name);
    }
  });
  it('rejects cross-VDN targets and disabled source operators', async () => {
    await expect(
      service.reserveChange(request(99), 31, change('1001'), false),
    ).rejects.toMatchObject({ statusCode: 403 });
    await sql('UPDATE t_user_users SET IsValid=0 WHERE ID=20');
    await expect(service.submitRequest(request(), change('1001'))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
