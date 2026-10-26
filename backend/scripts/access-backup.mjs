import mysql from 'mysql2/promise';
import { mkdir, writeFile } from 'node:fs/promises';
const db = await mysql.createConnection({ host: process.env.ICC_MYSQL_HOST, port: Number(process.env.ICC_MYSQL_PORT || 3306), user: process.env.ICC_MYSQL_USER, password: process.env.ICC_MYSQL_PASSWORD, database: process.env.ICC_MYSQL_DB || 'icc' });
try {
  const backup = {};
  for (const table of ['t_user_subsysemtype', 't_user_power', 't_user_grantpower', 't_user_role', 't_user_usertorole', 't_user_attributes', 't_icc_ag_personalized', 't_user_usertogroup', 't_user_usertodepart', 't_icc_skill_skilltouser', 't_omni_access_scope', 't_omni_access_sync']) {
    const [exists] = await db.query('SELECT 1 FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
    backup[table] = exists.length ? (await db.query(`SELECT * FROM ${table}`))[0] : null;
  }
  const dir = new URL('../backups/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const file = new URL(`access-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`, dir);
  await writeFile(file, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(`Permission backup saved: ${file.pathname}`);
  const [columns] = await db.query("SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_user_users' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT IS NULL");
  console.log(JSON.stringify({ requiredOperatorColumns: columns }));
} finally { await db.end(); }
