import { createRequire } from 'node:module';
const require = createRequire('/app/package.json');
const mysql = require('mysql2/promise');
const { PrismaClient } = require('@prisma/client');
const pg = new PrismaClient();
const db = await mysql.createConnection({ host: process.env.ICC_MYSQL_HOST, port: Number(process.env.ICC_MYSQL_PORT || 3306), user: process.env.ICC_MYSQL_USER, password: process.env.ICC_MYSQL_PASSWORD, database: process.env.ICC_MYSQL_DB || 'icc' });
try {
  const account = Number(process.env.OMNI_ACCESS_ACCOUNT_ID || 1), vdn = Number(process.env.OMNI_AGENT_VDN_ID || 1);
  const [tables] = await db.query("SELECT TABLE_NAME, ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('t_user_power','t_user_grantpower','t_user_subsysemtype','t_omni_access_scope','t_omni_access_sync')");
  const [grants] = await db.query('SELECT p.SubSystemType AS subsystem, COUNT(*) AS grants FROM t_user_grantpower g JOIN t_user_power p ON p.ID=g.PowerId WHERE g.IsOwn=1 AND g.VDNID=? GROUP BY p.SubSystemType', [vdn]);
  const [roles] = await db.query('SELECT r.ID AS id, r.Name AS name, COUNT(m.UserID) AS members FROM t_user_role r LEFT JOIN t_user_usertorole m ON m.RoleID=r.ID WHERE r.VDNID=? GROUP BY r.ID,r.Name', [vdn]);
  const memberships = await pg.account_users.groupBy({ by: ['role'], where: { account_id: account }, _count: { id: true } });
  const migrations = await pg.$queryRawUnsafe('SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations ORDER BY started_at DESC LIMIT 6');
  console.log(JSON.stringify({ account, vdn, tables, grants, roles, memberships, migrations }, null, 2));
} finally { await db.end(); await pg.$disconnect(); }
