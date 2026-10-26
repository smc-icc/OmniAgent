// Run against the same ICC database as CCS/ACD. Does not grant permissions to existing users.
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
const db = await mysql.createConnection({
  host: process.env.ICC_MYSQL_HOST || '172.22.0.3', port: Number(process.env.ICC_MYSQL_PORT || 3306),
  user: process.env.ICC_MYSQL_USER || 'root', password: process.env.ICC_MYSQL_PASSWORD || 'ChangeMe123!',
  database: process.env.ICC_MYSQL_DB || 'icc', charset: 'utf8mb4',
});
try {
  const [existing] = await db.query('SELECT SUBSYSEMTYPE AS name FROM t_user_subsysemtype WHERE ID = 90');
  if (existing.length && existing[0].name !== 'OmniAgent全媒体') throw new Error('ICC subsystem 90 is already allocated; migration stopped');
  const ddl = await readFile(new URL('../sql/access-management.sql', import.meta.url), 'utf8');
  await db.query(ddl);
  await db.query(await readFile(new URL('../sql/access-scope.sql', import.meta.url), 'utf8'));
  await db.beginTransaction();
  await db.query("INSERT INTO t_user_subsysemtype (ID, SUBSYSEMTYPE, value) SELECT 90, 'OmniAgent全媒体', 90 WHERE NOT EXISTS (SELECT 1 FROM t_user_subsysemtype WHERE ID = 90)");
  const permissions = [[1, '用户角色权限管理'], [2, '全媒体会话处理'], [3, '全媒体抢接'], [4, '全媒体排队取回'], [5, '全媒体会议'], [6, '全媒体监控'], [7, '全媒体强制签入签出'], [8, '客户管理'], [9, '智能外呼'], [10, '智能质检']];
  const catalog = JSON.parse(await readFile(new URL('../src/modules/access/access-catalog.json', import.meta.url), 'utf8'));
  permissions.push(...catalog.map(p => [p.value, p.name]));
  for (const [value, name] of permissions) {
    const [found] = await db.query('SELECT ID, Name, GroupName FROM t_user_power WHERE SubSystemType = 90 AND Value = ?', [value]);
    if (found.length && (found.length !== 1 || found[0].GroupName !== 'OmniAgent')) throw new Error(`Permission value ${value} is already allocated`);
    if (!found.length) await db.query("INSERT INTO t_user_power (SubSystemType, Value, Name, IsSystem, GroupName) VALUES (90, ?, ?, 1, 'OmniAgent')", [value, name]);
  }
  await db.commit();
  console.log(`Access management schema and ${permissions.length} Omni permission entries are ready. Existing grants were preserved. New granular permissions were not auto-granted.`);
} catch (error) { await db.rollback(); throw error; }
finally { await db.end(); }
