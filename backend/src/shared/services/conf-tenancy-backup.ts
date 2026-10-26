import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function backupTarget() {
  const pg = new URL(process.env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(pg.protocol) || !pg.hostname || !pg.pathname.slice(1)) throw new Error('Explicit PostgreSQL target required');
  const host = process.env.ICC_MYSQL_HOST, db = process.env.ICC_MYSQL_DB, user = process.env.ICC_MYSQL_USER;
  if (!host || !db || !user || process.env.ICC_MYSQL_PASSWORD === undefined || !/^[a-zA-Z0-9_]+$/.test(db)) throw new Error('Explicit ICC_MYSQL connection variables required; legacy defaults are prohibited');
  return { postgres: { host: pg.hostname, port: pg.port || '5432', database: decodeURIComponent(pg.pathname.slice(1)) },
    mysql: { host, port: process.env.ICC_MYSQL_PORT || '3306', database: db } };
}
export const receiptDigest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function digestFile(file: string) {
  const handle = await fs.open(file, 'r');
  try { const hash = crypto.createHash('sha256'); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); return hash.digest('hex'); }
  finally { await handle.close(); }
}
function run(command: string, args: string[], env: NodeJS.ProcessEnv, stdout?: number) {
  return new Promise<void>((resolve, reject) => {
    // No shell, credentials only in child environment, and no raw DB stderr in logs.
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', stdout ?? 'ignore', 'ignore'] });
    child.once('error', () => reject(new Error(`${command} unavailable; backup incomplete`)));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed; backup incomplete`)));
  });
}
/** User-invoked only. The directory must not exist; no old backup is overwritten. */
export async function createTenancyBackup(directory: string) {
  if (process.env.CONF_TENANCY_MAINTENANCE !== '1') throw new Error('Offline maintenance is required for a cross-database backup');
  const target = backupTarget();
  const pg = new URL(process.env.DATABASE_URL!);
  const root = path.resolve(directory);
  await fs.mkdir(root, { mode: 0o700 });
  const pgFile = path.join(root, 'omni.pgdump'), mysqlFile = path.join(root, 'conf.sql');
  const pgEnv = { ...process.env, PGHOST: pg.hostname, PGPORT: pg.port || '5432', PGDATABASE: decodeURIComponent(pg.pathname.slice(1)),
    PGUSER: decodeURIComponent(pg.username), PGPASSWORD: decodeURIComponent(pg.password),
    ...(pg.searchParams.has('sslmode') ? { PGSSLMODE: pg.searchParams.get('sslmode')! } : {}) };
  await run('pg_dump', ['--no-password', '--format=custom', '--file', pgFile], pgEnv);
  // This checks TOC/readability, not a full restore. A separate restore drill is mandatory.
  await run('pg_restore', ['--list', pgFile], pgEnv);
  const dump = await fs.open(mysqlFile, 'wx', 0o600);
  try {
    await run('mysqldump', ['--host', target.mysql.host, '--port', target.mysql.port, '--user', process.env.ICC_MYSQL_USER!,
      '--lock-all-tables', '--routines', '--events', '--triggers', '--hex-blob', '--databases', target.mysql.database],
      { ...process.env, MYSQL_PWD: process.env.ICC_MYSQL_PASSWORD }, dump.fd);
  } finally { await dump.close(); }
  const files = [];
  for (const name of ['omni.pgdump', 'conf.sql']) {
    const file = path.join(root, name), size = (await fs.stat(file)).size;
    if (size < 32) throw new Error('Empty/incomplete backup');
    files.push({ name, size, sha256: await digestFile(file) });
  }
  const receipt = { version: 1, created_at: new Date().toISOString(), target, files, postgres_toc_verified: true, restore_verified: false };
  await fs.writeFile(path.join(root, 'backup-receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
  return { directory: root, receipt, digest: receiptDigest(receipt) };
}
export async function verifyTenancyBackup(receiptFile: string) {
  const root = path.dirname(path.resolve(receiptFile));
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  if (receipt.version !== 1 || JSON.stringify(receipt.target) !== JSON.stringify(backupTarget()) || !receipt.postgres_toc_verified) throw new Error('Backup target or version does not match this environment');
  if (!Array.isArray(receipt.files) || receipt.files.length !== 2 || receipt.files[0].name !== 'omni.pgdump' || receipt.files[1].name !== 'conf.sql') throw new Error('Invalid backup file inventory');
  for (const item of receipt.files) {
    const file = path.join(root, item.name);
    if ((await fs.stat(file)).size !== item.size || await digestFile(file) !== item.sha256) throw new Error('Backup size/digest mismatch');
  }
  const handle = await fs.open(path.join(root, 'omni.pgdump'), 'r');
  try { const magic = Buffer.alloc(5); await handle.read(magic, 0, 5, 0); if (magic.toString() !== 'PGDMP') throw new Error('Not a PostgreSQL custom dump'); }
  finally { await handle.close(); }
  return { receipt, digest: receiptDigest(receipt) };
}
