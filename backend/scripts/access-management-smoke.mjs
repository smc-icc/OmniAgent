// Real HTTP/DB roundtrip using disposable, tagged records. Never contacts customers.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
const pg = new PrismaClient(), auth = Fastify();
const db = await mysql.createConnection({ host: process.env.ICC_MYSQL_HOST, port: Number(process.env.ICC_MYSQL_PORT || 3306), user: process.env.ICC_MYSQL_USER, password: process.env.ICC_MYSQL_PASSWORD, database: process.env.ICC_MYSQL_DB || 'icc' });
const account = Number(process.env.OMNI_ACCESS_ACCOUNT_ID || 1), vdn = Number(process.env.OMNI_AGENT_VDN_ID || 1);
const file = '/tmp/omni-access-browser.json';
let state = { users: [], entities: [], extension: '' }, keep = false;
async function cleanup() {
  for (const user of state.users) {
    const [rows] = await db.query('SELECT ID FROM t_user_users WHERE WorkNO=? AND VDNID=?', [user.work_no, vdn]);
    if (rows.length) {
      const id = rows[0].ID;
      for (const table of ['t_user_usertorole', 't_user_usertodepart', 't_user_usertogroup', 't_icc_skill_skilltouser', 't_user_attributes', 't_omni_access_sync']) await db.query(`DELETE FROM ${table} WHERE UserID=?`, [id]);
      await db.query('DELETE FROM t_icc_ag_personalized WHERE AgentID=?', [id]);
      await db.query('DELETE FROM t_omni_access_scope WHERE OwnerType=3 AND OwnerId=? AND VDNID=?', [id, vdn]);
      await db.query('DELETE FROM t_user_grantpower WHERE OwnerType=3 AND OwnerId=? AND VDNID=?', [id, vdn]);
      await db.query('DELETE FROM t_user_users WHERE ID=? AND WorkNO=? AND VDNID=?', [id, user.work_no, vdn]);
    }
    const existing = await pg.users.findFirst({ where: { uid: user.work_no } });
    if (existing) { await pg.account_users.deleteMany({ where: { user_id: existing.id } }); await pg.users.delete({ where: { id: existing.id } }); }
  }
  const tables = { roles: 't_user_role', departments: 't_user_department', groups: 't_user_group', skills: 't_icc_skill' };
  for (const entity of state.entities.reverse()) {
    const owner = entity.kind === 'roles' ? 1 : entity.kind === 'departments' ? 2 : 0;
    if (owner) {
      await db.query('DELETE FROM t_omni_access_scope WHERE OwnerType=? AND OwnerId=? AND VDNID=?', [owner, entity.id, vdn]);
      await db.query('DELETE FROM t_user_grantpower WHERE OwnerType=? AND OwnerId=? AND VDNID=?', [owner, entity.id, vdn]);
    }
    if (entity.kind === 'groups') await db.query('DELETE FROM t_icc_grouptovdn WHERE GroupID=? AND VDNID=?', [entity.id, vdn]);
    await db.query(`DELETE FROM ${tables[entity.kind]} WHERE ID=?`, [entity.id]);
  }
  if (state.extension) await db.query('DELETE FROM t_icc_base_extension WHERE Num=? AND VDN=?', [state.extension, vdn]);
  await unlink(file).catch(() => {});
}
try {
  if (process.argv.includes('--cleanup')) { state = JSON.parse(await readFile(file, 'utf8')); await cleanup(); console.log('Disposable access validation records removed'); }
  else {
    await auth.register(jwt, { secret: process.env.JWT_SECRET });
    const admin = await pg.account_users.findFirst({ where: { account_id: account, role: 0 } }); assert.ok(admin);
    const token = auth.jwt.sign({ id: admin.user_id }, { expiresIn: '5m' });
    async function call(method, path, body, status = 200) {
      const res = await fetch(`http://127.0.0.1:3001/api/access${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await res.json(); assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`); return data;
    }
    const boot = await call('GET', '/bootstrap');
    const power = (value) => boot.permissions.find(p => p.subsystem === 90 && p.value === value).id;
    const stamp = Date.now().toString(36);
    const scratch = await call('POST', '/entities/roles', { name: `RBAC删除${stamp}` });
    state.entities.push({ kind: 'roles', id: scratch.id });
    await call('PUT', `/entities/roles/${scratch.id}`, { name: `RBAC修改${stamp}` });
    await call('PATCH', `/entities/roles/${scratch.id}/permissions`, { permission_id: power(100), granted: true, data_scope: 'group' });
    await call('DELETE', `/entities/roles/${scratch.id}`);
    const [[orphan]] = await db.query('SELECT COUNT(*) AS n FROM t_omni_access_scope WHERE OwnerType=1 AND OwnerId=? AND VDNID=?', [scratch.id, vdn]);
    assert.equal(orphan.n, 0, 'Role deletion must remove its scopes');
    state.entities = state.entities.filter(e => e.id !== scratch.id || e.kind !== 'roles');
    for (const [n, permission] of [[1, 1], [2, 100]]) {
      const work_no = `rv${stamp}${n}`, password = randomBytes(18).toString('hex');
      const user = { work_no, password, email: `${work_no}@test.invalid`, name: `RBAC验证${n}` }; state.users.push(user);
      const saved = await call('POST', '/users', user); assert.equal(saved.sync_pending, false, 'New operator must synchronize to Omni'); user.id = saved.id;
      await call('PATCH', `/users/${user.id}/permissions`, { permission_id: power(permission), granted: true });
    }
    const uid = state.users[0].id;
    // A historical dangling membership must never attach to a newly created role.
    const [[highest]] = await db.query('SELECT MAX(ID)+1000 AS id FROM t_user_role');
    await db.query('INSERT INTO t_user_usertorole (RoleID,UserID,VDNID) VALUES (?,?,?)', [highest.id, uid, vdn]);
    for (const kind of ['roles', 'departments', 'groups', 'skills']) {
      const result = await call('POST', `/entities/${kind}`, { name: `RBAC${stamp}` }); state.entities.push({ kind, id: result.id });
      if (kind === 'roles') assert.ok(result.id > highest.id, 'New role must skip historically reserved IDs');
      await call('PATCH', `/entities/${kind}/${result.id}/members`, { action: 'add', user_ids: [uid] });
      const assigned = await call('GET', `/entities/${kind}/${result.id}/assignments`); assert.ok(assigned.member_ids.includes(uid));
      if (['roles', 'departments'].includes(kind)) {
        await call('PATCH', `/entities/${kind}/${result.id}/permissions`, { permission_id: power(100), granted: true, data_scope: kind === 'roles' ? 'group' : 'department' });
        const saved = await call('GET', `/entities/${kind}/${result.id}/assignments`); assert.equal(saved.scopes[power(100)], kind === 'roles' ? 'group' : 'department');
      }
    }
    state.extension = `99${Date.now()}`;
    const extension = { num: state.extension, device: 0, channel_group: boot.channel_groups[0]?.name, description: 'RBAC temporary validation' };
    assert.ok(extension.channel_group, 'A channel group is needed for extension CRUD');
    await call('POST', '/extensions', extension);
    await call('PUT', `/extensions/${state.extension}`, { ...extension, description: 'RBAC modified' });
    await call('DELETE', `/extensions/${state.extension}`); state.extension = '';
    const login = await fetch('http://127.0.0.1:3001/auth/sign_in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: state.users[1].email, password: state.users[1].password, device_id: `rbac-${stamp}` }) });
    assert.equal(login.status, 200); const ordinary = await login.json();
    const denied = await fetch('http://127.0.0.1:3001/api/access/bootstrap', { headers: { authorization: `Bearer ${ordinary.headers['access-token']}` } }); assert.equal(denied.status, 403);
    keep = process.argv.includes('--prepare-browser');
    if (keep) await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    console.log(JSON.stringify({ passed: true, checks: ['operator creation and Omni synchronization', 'role and department grants/data-scope persistence', 'group and same-name skill membership', 'extension create/update/delete', 'real password login', 'ordinary management API denied'], browserFixturesPrepared: keep }));
  }
} finally { if (!keep && !process.argv.includes('--cleanup')) await cleanup(); await db.end(); await pg.$disconnect(); await auth.close(); }
