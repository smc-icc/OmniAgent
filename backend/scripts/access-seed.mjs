import mysql from 'mysql2/promise';
import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolveCcsWorkNo } from '../dist/integrations/ccs/ccs-workno.js';
import { nextId } from '../dist/modules/access/access.db.js';
const pg = new PrismaClient();
const db = await mysql.createConnection({ host: process.env.ICC_MYSQL_HOST, port: Number(process.env.ICC_MYSQL_PORT || 3306), user: process.env.ICC_MYSQL_USER, password: process.env.ICC_MYSQL_PASSWORD, database: process.env.ICC_MYSQL_DB || 'icc' });
const vdn = Number(process.env.OMNI_AGENT_VDN_ID || 1), account = Number(process.env.OMNI_ACCESS_ACCOUNT_ID || 1);
const basic = ['conversation.read', 'conversation.create', 'conversation.reply', 'conversation.update', 'conversation.transfer', 'conversation.close', 'conversation.queue', 'conversation.conference', 'customer.read', 'customer.create', 'customer.update', 'company.read', 'opportunity.read', 'opportunity.create', 'opportunity.update', 'voicemail.read', 'voicemail.update', 'voicemail.claim', 'voicemail.recording', 'organization.read', 'channel.read', 'knowledge.read', 'efficiency.read', 'sms.read', 'sms.send', 'email.read', 'email.send'];
try {
  const catalog = JSON.parse(await readFile(new URL('../src/modules/access/access-catalog.json', import.meta.url), 'utf8'));
  const [[lock]] = await db.query("SELECT GET_LOCK('omniagent.access.write',10) AS acquired");
  if (lock.acquired !== 1) throw new Error('Another access writer is active');
  await db.beginTransaction();
  const [powers] = await db.query('SELECT ID AS id, Value AS value FROM t_user_power WHERE SubSystemType=90');
  let basicRole;
  for (const template of [
    { name: 'Omni全媒体坐席', codes: basic, scope: 'self' },
    { name: 'Omni全媒体班长', codes: [...basic, 'conversation.snatch', 'conversation.recording', 'conversation.export', 'monitor.read', 'monitor.intervene', 'report.read', 'report.export', 'inspection.read', 'inspection.review', 'schedule.read', 'schedule.approve'], scope: 'group' },
    { name: 'Omni全媒体管理员', codes: ['access.manage', ...catalog.map(p => p.code)], scope: 'account' },
  ]) {
    const [existing] = await db.query('SELECT ID FROM t_user_role WHERE Name=? AND VDNID=?', [template.name, vdn]);
    let id = existing[0]?.ID;
    // Do not overwrite an existing role's grants on reruns.
    if (!id) {
      id = await nextId(db, 't_user_role');
      await db.query('INSERT INTO t_user_role (ID,Name,IsSystem,VDNID) VALUES (?,?,0,?)', [id, template.name, vdn]);
      for (const code of template.codes) {
        const def = catalog.find(p => p.code === code);
        const power = powers.find(p => p.value === (code === 'access.manage' ? 1 : def?.value));
        if (!power) throw new Error(`Missing permission ${code}`);
        await db.query('INSERT INTO t_user_grantpower (OwnerType,OwnerId,PowerId,IsOwn,VDNID) VALUES (1,?,?,1,?)', [id, power.id, vdn]);
        if (def) await db.query('INSERT INTO t_omni_access_scope (VDNID,OwnerType,OwnerId,PowerId,ScopeType) VALUES (?,1,?,?,?)', [vdn, id, power.id, def.scopes.includes(template.scope) ? template.scope : 'account']);
      }
    }
    if (template.name === 'Omni全媒体坐席') basicRole = id;
  }
  // Run only for the initial rollout. Later provisioning is performed by the role UI.
  let assigned = 0, unmatched = 0;
  if (process.argv.includes('--assign-existing')) {
    const users = await pg.users.findMany({ where: { account_users: { some: { account_id: account, role: 1 } } } });
    for (const user of users) {
      const workNo = resolveCcsWorkNo(user, process.env.CCS_WORK_NO_FIELD || 'uid');
      const [agents] = await db.query('SELECT ID FROM t_user_users WHERE WorkNO=? AND VDNID=? AND IsValid=1', [workNo, vdn]);
      if (agents.length !== 1) { unmatched++; continue; }
      const [exists] = await db.query('SELECT 1 FROM t_user_usertorole WHERE RoleID=? AND UserID=? AND VDNID=?', [basicRole, agents[0].ID, vdn]);
      if (!exists.length) { await db.query('INSERT INTO t_user_usertorole (RoleID,UserID,VDNID) VALUES (?,?,?)', [basicRole, agents[0].ID, vdn]); assigned++; }
    }
  }
  await db.commit();
  console.log(JSON.stringify({ templates: 3, basicRole, assigned, unmatched, elevatedMembershipsCreated: 0 }));
} catch (e) { await db.rollback(); throw e; }
finally { await db.query("SELECT RELEASE_LOCK('omniagent.access.write')"); await db.end(); await pg.$disconnect(); }
