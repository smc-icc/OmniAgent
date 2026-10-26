// Target-database integration test. Creates only tagged fixtures and removes them in finally.
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { installAccessGuard } from '../dist/modules/access/access.guard.js';
import { conversationsRoutes } from '../dist/modules/conversations/conversations.routes.js';
import { registerErrorHandler } from '../dist/shared/errors/index.js';
import { prisma as scopedPg } from '../dist/plugins/db.js';
import { getIccMysqlPool } from '../dist/shared/services/icc-groups-dal.js';
import { nextId } from '../dist/modules/access/access.db.js';
const pg = new PrismaClient();
const db = await mysql.createConnection({ host: process.env.ICC_MYSQL_HOST, port: Number(process.env.ICC_MYSQL_PORT || 3306), user: process.env.ICC_MYSQL_USER, password: process.env.ICC_MYSQL_PASSWORD, database: process.env.ICC_MYSQL_DB || 'icc' });
const account = Number(process.env.OMNI_ACCESS_ACCOUNT_ID || 1), vdn = Number(process.env.OMNI_AGENT_VDN_ID || 1);
const stamp = Date.now().toString(36), users = [], agentIds = [], convIds = [];
let groupId, contactId;
const app = Fastify(); registerErrorHandler(app);
const check = (response, status) => assert.equal(response.statusCode, status, response.body);
try {
  const inbox = await pg.inboxes.findFirst({ where: { account_id: account } }); assert.ok(inbox, 'An inbox is required');
  const [[lock]] = await db.query("SELECT GET_LOCK('omniagent.access.write',10) AS acquired"); assert.equal(lock.acquired, 1);
  for (const n of [1, 2]) {
    const uid = `ra${stamp}${n}`;
    const user = await pg.users.create({ data: { uid, email: `${uid}@test.invalid`, name: `RBAC fixture ${stamp} ${n}`, account_users: { create: { account_id: account, role: 1 } } } }); users.push(user);
    const id = await nextId(db, 't_user_users'); agentIds.push(id);
    await db.query('INSERT INTO t_user_users (ID,WorkNO,Name,VDNID,IsValid) VALUES (?,?,?,?,1)', [id, uid, `RBAC ${stamp}`, vdn]);
  }
  groupId = await nextId(db, 't_user_group');
  await db.query('INSERT INTO t_user_group (ID,Name) VALUES (?,?)', [groupId, `RBAC ${stamp}`]);
  for (const id of agentIds) await db.query('INSERT INTO t_user_usertogroup (GroupID,UserID,VDNID) VALUES (?,?,?)', [groupId, id, vdn]);
  const [powers] = await db.query('SELECT ID AS id,Value AS value FROM t_user_power WHERE SubSystemType=90');
  for (const value of [100, 103]) {
    const power = powers.find(p => p.value === value); assert.ok(power);
    await db.query('INSERT INTO t_user_grantpower (OwnerType,OwnerId,PowerId,IsOwn,VDNID) VALUES (3,?,?,1,?)', [agentIds[0], power.id, vdn]);
    await db.query('INSERT INTO t_omni_access_scope (VDNID,OwnerType,OwnerId,PowerId,ScopeType) VALUES (?,3,?,?,?)', [vdn, agentIds[0], power.id, 'self']);
  }
  await db.query("SELECT RELEASE_LOCK('omniagent.access.write')");
  const contact = await pg.contacts.create({ data: { name: `RBAC ${stamp}`, account_id: account } }); contactId = contact.id;
  const last = await pg.conversations.aggregate({ where: { account_id: account }, _max: { display_id: true } });
  for (const [i, user] of users.entries()) {
    const conv = await pg.conversations.create({ data: { account_id: account, inbox_id: inbox.id, assignee_id: user.id, contact_id: contact.id, display_id: (last._max.display_id ?? 0) + 1 + i } }); convIds.push(conv.id);
  }
  app.decorate('authenticate', async req => { if (!req.currentUser) throw new Error('authentication missing'); });
  app.addHook('onRequest', async req => { req.currentUser = users[0]; });
  installAccessGuard(app);
  await app.register(conversationsRoutes);
  app.post('/api/unclassified-test', async () => ({ shouldNotRun: true }));
  const base = `/api/v1/accounts/${account}/conversations`;
  let result = await app.inject({ method: 'GET', url: base }); check(result, 200);
  assert.deepEqual(result.json().payload.map(c => c.id), [convIds[0]]); assert.equal(result.json().meta.total_count, 1);
  check(await app.inject({ method: 'GET', url: `${base}/${convIds[1]}` }), 403);
  check(await app.inject({ method: 'POST', url: `${base}/${convIds[0]}/messages`, payload: { content: 'must never send' } }), 403);
  check(await app.inject({ method: 'DELETE', url: `${base}/${convIds[0]}` }), 403);
  check(await app.inject({ method: 'GET', url: `${base}/${convIds[0]}/transcript` }), 403);
  check(await app.inject({ method: 'POST', url: '/api/unclassified-test' }), 403);
  check(await app.inject({ method: 'GET', url: '/api/v1/accounts/999999/conversations' }), 403);
  const readPower = powers.find(p => p.value === 100).id;
  await db.query("UPDATE t_omni_access_scope SET ScopeType='group' WHERE VDNID=? AND OwnerType=3 AND OwnerId=? AND PowerId=?", [vdn, agentIds[0], readPower]);
  result = await app.inject({ method: 'GET', url: base }); check(result, 200); assert.equal(result.json().meta.total_count, 2);
  // Wider read scope must not enlarge the separately granted update scope.
  check(await app.inject({ method: 'PUT', url: `${base}/${convIds[1]}`, payload: { priority: 'high' } }), 403);
  check(await app.inject({ method: 'PUT', url: `${base}/${convIds[0]}`, payload: { priority: 'high' } }), 200);
  assert.equal((await pg.conversations.findUnique({ where: { id: convIds[0] } })).priority, 2);
  assert.equal((await pg.conversations.findUnique({ where: { id: convIds[1] } })).priority, null);
  await db.query('DELETE FROM t_user_grantpower WHERE VDNID=? AND OwnerType=3 AND OwnerId=? AND PowerId=?', [vdn, agentIds[0], readPower]);
  check(await app.inject({ method: 'GET', url: base }), 403);
  console.log(JSON.stringify({ passed: true, checks: ['self list and count', 'group membership', 'foreign detail', 'reply/delete/export denied', 'unknown route denied', 'tenant isolation', 'read/update scope separation', 'allowed update persisted', 'revocation immediate'] }));
} finally {
  await app.close();
  if (convIds.length) await pg.conversations.deleteMany({ where: { id: { in: convIds } } });
  if (contactId) await pg.contacts.delete({ where: { id: contactId } });
  for (const id of agentIds) {
    await db.query('DELETE FROM t_omni_access_scope WHERE OwnerType=3 AND OwnerId=? AND VDNID=?', [id, vdn]);
    await db.query('DELETE FROM t_user_grantpower WHERE OwnerType=3 AND OwnerId=? AND VDNID=?', [id, vdn]);
    await db.query('DELETE FROM t_user_usertogroup WHERE UserID=? AND VDNID=?', [id, vdn]);
    await db.query('DELETE FROM t_user_users WHERE ID=? AND VDNID=?', [id, vdn]);
  }
  if (groupId) await db.query('DELETE FROM t_user_group WHERE ID=?', [groupId]);
  for (const user of users) { await pg.account_users.deleteMany({ where: { user_id: user.id } }); await pg.users.delete({ where: { id: user.id } }); }
  await db.query("SELECT RELEASE_LOCK('omniagent.access.write')");
  await db.end(); await pg.$disconnect(); await scopedPg.$disconnect(); await (await getIccMysqlPool())?.end();
}
