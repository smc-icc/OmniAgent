// Disposable recipients only. Never publish a test announcement to existing staff.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { accessScope } from '../dist/modules/access/access.scope.js';
import { withAccessScope } from '../dist/modules/access/access.prisma.js';
import { listAnnouncements } from '../dist/modules/announcements/announcements.service.js';
const pg = new PrismaClient(), auth = Fastify();
const db = await mysql.createConnection({ host: process.env.ICC_MYSQL_HOST, port: Number(process.env.ICC_MYSQL_PORT || 3306), user: process.env.ICC_MYSQL_USER, password: process.env.ICC_MYSQL_PASSWORD, database: process.env.ICC_MYSQL_DB || 'icc' });
const account = Number(process.env.OMNI_ACCESS_ACCOUNT_ID || 1), vdn = Number(process.env.OMNI_AGENT_VDN_ID || 1);
const file = '/tmp/omni-announcement-fixtures.json';
let state = { users: [], entities: [], groupIds: [], stamp: `announcement-test-${Date.now()}` }, keep = false, checks = 0;
async function cleanup() {
  await pg.agent_announcements.deleteMany({ where: { title: { startsWith: state.stamp } } });
  await pg.agent_announcement_groups.deleteMany({ where: { id: { in: state.groupIds }, account_id: account, vdn_id: vdn } });
  for (const user of state.users) {
    if (user.token) await fetch('http://127.0.0.1:3001/auth/sign_out', { method: 'DELETE', headers: { authorization: `Bearer ${user.token}` } }).catch(() => {});
    const [[found]] = await db.query('SELECT ID FROM t_user_users WHERE WorkNO=? AND VDNID=?', [user.work_no, vdn]);
    if (found) {
      for (const table of ['t_user_usertorole', 't_user_usertodepart', 't_user_usertogroup', 't_icc_skill_skilltouser', 't_user_attributes', 't_omni_access_sync']) await db.query(`DELETE FROM ${table} WHERE UserID=?`, [found.ID]);
      await db.query('DELETE FROM t_icc_ag_personalized WHERE AgentID=?', [found.ID]);
      for (const table of ['t_user_grantpower', 't_omni_access_scope']) await db.query(`DELETE FROM ${table} WHERE OwnerType=3 AND OwnerId=? AND VDNID=?`, [found.ID, vdn]);
      await db.query('DELETE FROM t_user_users WHERE ID=? AND WorkNO=? AND VDNID=?', [found.ID, user.work_no, vdn]);
    }
    const omni = await pg.users.findFirst({ where: { uid: user.work_no } });
    if (omni) { await pg.agent_announcement_reads.deleteMany({ where: { user_id: omni.id } }); await pg.account_users.deleteMany({ where: { user_id: omni.id } }); await pg.users.delete({ where: { id: omni.id } }); }
  }
  const tables = { groups: 't_user_group', skills: 't_icc_skill', departments: 't_user_department', roles: 't_user_role' };
  for (const e of state.entities) {
    if (e.kind === 'groups') await db.query('DELETE FROM t_icc_grouptovdn WHERE GroupID=? AND VDNID=?', [e.id, vdn]);
    await db.query(`DELETE FROM ${tables[e.kind]} WHERE ID=?`, [e.id]);
  }
  await unlink(file).catch(() => {});
}
try {
  if (process.argv.includes('--cleanup')) { state = JSON.parse(await readFile(file, 'utf8')); await cleanup(); console.log('Announcement validation fixtures removed'); }
  else {
    await auth.register(jwt, { secret: process.env.JWT_SECRET });
    const admin = await pg.account_users.findFirst({ where: { account_id: account, role: 0 } }); assert.ok(admin);
    const adminToken = auth.jwt.sign({ id: admin.user_id }, { expiresIn: '20m' });
    async function call(method, path, body, status = 200, token = adminToken) {
      const res = await fetch(`http://127.0.0.1:3001${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await res.json(); assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data).slice(0, 1000)}`); checks++; return data;
    }
    const boot = await call('GET', '/api/access/bootstrap');
    for (let i = 1; i <= 2; i++) {
      const work_no = `an${Date.now().toString(36)}${i}`;
      const user = { work_no, name: `公告验证${i}`, email: `${work_no}@test.invalid`, password: randomBytes(18).toString('hex') }; state.users.push(user);
      const result = await call('POST', '/api/access/users', user); assert.equal(result.sync_pending, false); user.id = Number(result.id);
      const omni = await pg.users.findFirstOrThrow({ where: { uid: work_no } }); user.omniId = omni.id;
      const signedIn = await call('POST', '/auth/sign_in', { email: user.email, password: user.password, device_id: `${state.stamp}-${i}` });
      user.token = signedIn.headers['access-token']; assert.ok(user.token);
    }
    const [first, second] = state.users;
    // UI fixture has explicit announcement powers, ordinary recipient has none.
    const codes = JSON.parse(await readFile('/app/src/modules/access/access-catalog.json', 'utf8'));
    for (const value of [1, ...codes.filter(p => p.code.startsWith('announcement.')).map(p => p.value)]) {
      const power = boot.permissions.find(p => p.subsystem === 90 && p.value === value); assert.ok(power);
      await call('PATCH', `/api/access/users/${first.id}/permissions`, { permission_id: power.id, granted: true });
    }
    const entityName = `公告验证${Date.now().toString(36)}`;
    for (const kind of ['groups', 'skills', 'departments', 'roles']) {
      const entity = await call('POST', `/api/access/entities/${kind}`, { name: entityName }); state.entities.push({ kind, id: entity.id });
      await call('PATCH', `/api/access/entities/${kind}/${entity.id}/members`, { action: 'add', user_ids: [first.id] });
    }
    const custom = await call('POST', '/api/announcements/groups', { name: `${state.stamp}-custom`, operator_ids: [first.id, first.id] }); state.groupIds.push(custom.id);
    await call('POST', '/api/announcements/groups', { name: custom.name, operator_ids: [first.id] }, 409);
    let catalog = await call('GET', '/api/announcements/recipients');
    assert.ok(catalog.operators.some(o => o.id === first.id));
    for (const e of state.entities) assert.ok(catalog.categories[e.kind].find(g => Number(g.id) === Number(e.id)).operator_ids.includes(first.id), `${e.kind} membership missing`);
    assert.deepEqual(catalog.categories.custom.find(g => g.id === custom.id).operator_ids, [first.id]);
    const base = { title: `${state.stamp}-selected`, body: '仅供临时验收账号查看 <img src=x onerror=alert(1)>', type: 'system', status: 'published', audience_mode: 'selected', recipient_ids: [first.id, first.id], starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: null };
    const selected = await call('POST', '/api/announcements/manage', base); assert.deepEqual(selected.recipient_ids, [first.id]); state.selectedId = selected.id;
    await call('POST', '/api/announcements/manage', { ...base, recipient_ids: [] }, 422);
    await call('POST', '/api/dashboard/announcements', { title: 'ambiguous' }, 422);
    await call('POST', '/api/announcements/manage', { ...base, account_id: account + 1 }, 403);
    await call('POST', '/api/announcements/manage', { ...base, recipient_ids: [2147483647] }, 422);
    await db.query('UPDATE t_user_users SET VDNID=? WHERE ID=? AND VDNID=?', [vdn + 100000, second.id, vdn]);
    try { await call('POST', '/api/announcements/manage', { ...base, recipient_ids: [second.id] }, 422); }
    finally { await db.query('UPDATE t_user_users SET VDNID=? WHERE ID=?', [vdn, second.id]); }
    await call('POST', '/api/announcements/manage', base, 403, second.token);
    await call('GET', '/api/announcements/manage', null, 403, second.token);
    await call('GET', '/api/announcements/recipients', null, 403, second.token);
    let inbox = await call('GET', '/api/dashboard/announcements', null, 200, first.token); assert.ok(inbox.items.some(a => a.id === selected.id)); assert.ok(inbox.items.every(a => !('recipient_ids' in a)));
    inbox = await call('GET', '/api/dashboard/announcements', null, 200, second.token); assert.ok(!inbox.items.some(a => a.id === selected.id));
    for (const tail of ['read', 'unread']) await call('POST', `/api/dashboard/announcements/${selected.id}/${tail}`, null, 403, second.token);
    await call('POST', '/api/dashboard/announcements/read', { ids: [selected.id] }, 403, second.token);
    await call('POST', `/api/dashboard/announcements/${selected.id}/read`, null, 200, first.token);
    inbox = await call('GET', '/api/dashboard/announcements?unread_only=1', null, 200, first.token); assert.ok(!inbox.items.some(a => a.id === selected.id));
    await call('POST', `/api/dashboard/announcements/${selected.id}/unread`, null, 200, first.token);
    await call('PUT', `/api/announcements/manage/${selected.id}`, { ...base, recipient_ids: [second.id] }, 409);
    await call('PUT', `/api/announcements/groups/${custom.id}`, { name: custom.name, operator_ids: [second.id] });
    for (const e of [...state.entities].reverse()) await call('PATCH', `/api/access/entities/${e.kind}/${e.id}/members`, { action: 'remove', user_ids: [first.id] });
    inbox = await call('GET', '/api/dashboard/announcements', null, 200, first.token); assert.ok(inbox.items.some(a => a.id === selected.id), 'Published snapshot must survive membership changes');
    const draft = await call('POST', '/api/announcements/manage', { ...base, title: `${state.stamp}-draft`, status: 'draft' });
    const scheduled = await call('POST', '/api/announcements/manage', { ...base, title: `${state.stamp}-future`, starts_at: new Date(Date.now() + 3600000).toISOString() });
    const expired = await call('POST', '/api/announcements/manage', { ...base, title: `${state.stamp}-expired`, starts_at: new Date(Date.now() - 7200000).toISOString(), ends_at: new Date(Date.now() - 3600000).toISOString() });
    for (const notice of [draft, scheduled, expired]) await call('POST', `/api/dashboard/announcements/${notice.id}/read`, null, 403, first.token);
    inbox = await call('GET', '/api/dashboard/announcements', null, 200, first.token); assert.ok([draft, scheduled, expired].every(n => !inbox.items.some(a => a.id === n.id)));
    await call('PUT', `/api/announcements/manage/${draft.id}`, { ...base, title: draft.title, recipient_ids: [first.id] });
    const concurrent = await call('POST', '/api/announcements/manage', { ...base, title: `${state.stamp}-race`, status: 'draft' });
    const publish = () => fetch(`http://127.0.0.1:3001/api/announcements/manage/${concurrent.id}`, { method: 'PUT', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...base, title: concurrent.title }) });
    const raced = await Promise.all([publish(), publish()]); assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]); checks++;
    // Foreign tenant/VDN fixtures are never visible to any real recipient.
    const foreign = await pg.agent_announcements.create({ data: { account_id: account + 100000, vdn_id: vdn + 100000, title: `${state.stamp}-foreign-all`, body: 'isolated all', audience_mode: 'all', starts_at: new Date(Date.now() - 60000) } });
    await call('PUT', `/api/announcements/manage/${foreign.id}`, base, 404);
    await call('DELETE', `/api/announcements/manage/${foreign.id}`, null, 404);
    await call('POST', `/api/dashboard/announcements/${foreign.id}/read`, null, 403, first.token);
    const ctx = { userId: first.omniId, agentId: first.id, accountId: account + 100000, vdnId: vdn + 100000, administrator: false, permission: 'session', all: false, scopes: ['self'], userIds: [first.omniId], agentIds: [first.id], workNos: [first.work_no] };
    const isolated = await accessScope.run(ctx, () => listAnnouncements(withAccessScope(pg), ctx.accountId, first.omniId)); assert.ok(isolated.items.some(a => Number(a.id) === foreign.id)); checks++;
    // Filtering unread must happen BEFORE the limit, including older notices.
    const old = await pg.agent_announcements.create({ data: { account_id: account, vdn_id: vdn, title: `${state.stamp}-old-unread`, audience_mode: 'selected', recipient_ids: [first.id], published_at: new Date('2020-01-01'), starts_at: new Date('2020-01-01') } });
    for (let i = 0; i < 101; i++) {
      const n = await pg.agent_announcements.create({ data: { account_id: account, vdn_id: vdn, title: `${state.stamp}-read-${i}`, audience_mode: 'selected', recipient_ids: [first.id] } });
      await pg.agent_announcement_reads.create({ data: { announcement_id: n.id, user_id: first.omniId } });
    }
    inbox = await call('GET', '/api/dashboard/announcements?unread_only=1', null, 200, first.token); assert.ok(inbox.items.some(a => Number(a.id) === old.id)); assert.ok(inbox.unread_count >= 1);
    const readPage1 = await call('GET', '/api/dashboard/announcements?read_only=1&limit=1&page=1', null, 200, first.token);
    const readPage2 = await call('GET', '/api/dashboard/announcements?read_only=1&limit=1&page=2', null, 200, first.token);
    assert.equal(readPage1.items.length, 1); assert.equal(readPage2.items.length, 1); assert.notEqual(readPage1.items[0].id, readPage2.items[0].id); assert.ok(readPage1.read_count >= 101);
    const search = await call('GET', `/api/dashboard/announcements?unread_only=1&query=${encodeURIComponent(old.title)}&limit=1`, null, 200, first.token);
    assert.equal(search.total, 1); assert.equal(Number(search.items[0].id), old.id);
    await call('GET', '/api/dashboard/announcements?limit=1000', null, 422, first.token);
    await pg.agent_announcements.deleteMany({ where: { title: { startsWith: `${state.stamp}-read-` } } });
    await call('DELETE', `/api/announcements/manage/${draft.id}`); await call('POST', `/api/dashboard/announcements/${draft.id}/read`, null, 403, first.token);
    // Restore useful six-category UI fixtures, without changing any real memberships.
    for (const e of state.entities) await call('PATCH', `/api/access/entities/${e.kind}/${e.id}/members`, { action: 'add', user_ids: [first.id] });
    await call('PUT', `/api/announcements/groups/${custom.id}`, { name: custom.name, operator_ids: [first.id] });
    keep = process.argv.includes('--prepare-browser');
    if (keep) await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    console.log(JSON.stringify({ passed: true, httpAndDatabaseChecks: checks, sixRecipientSources: true, snapshotAndTimeIsolation: true, unreadBeforeLimit: true, concurrentPublication: true, browserFixturesPrepared: keep }));
  }
} finally { if (!keep && !process.argv.includes('--cleanup')) await cleanup(); await db.end(); await pg.$disconnect(); await auth.close(); }
