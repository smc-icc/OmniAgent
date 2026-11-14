import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../release');
const secretDir = resolve(root, 'knowledge-secrets');
const stateFile = resolve(secretDir, 'bootstrap-state.json');
const args = process.argv.slice(2);
if (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0])) {
  console.error('Usage: node scripts/knowledge-bootstrap.mjs --dry-run|--apply');
  process.exit(2);
}
function mysql(sql) {
  try {
    return execFileSync('docker', ['exec', '-i', 'smc-icc-mysql', 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --skip-column-names'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).trim();
  } catch { throw new Error('mysql_bootstrap_failed'); }
}
try {
  const present = Number(mysql("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='omni_ragflow';"));
  const users = Number(mysql("SELECT COUNT(*) FROM mysql.user WHERE User='omni_ragflow';"));
  const dbSize = execFileSync('docker', ['exec', 'smc-icc-omni-redis', 'redis-cli', '-n', '1', 'DBSIZE'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
  if (!/^\d+$/.test(dbSize)) throw new Error('redis_db1_unverified');
  let state = null;
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state && (state.database !== 'omni_ragflow' || state.environment !== 'smc-icc-test')) throw new Error('bootstrap_state_mismatch');
  if (!state && (present || users || Number(dbSize))) throw new Error('existing_resources_need_reconciliation');
  console.log(JSON.stringify({ environment: 'smc-icc-test', databaseExists: !!present, userExists: !!users, redisDb: 1, redisKeys: Number(dbSize), mode: args[0] }));
  if (args[0] === '--dry-run') process.exit(0);
  await mkdir(secretDir, { recursive: true });
  for (const name of ['mysql-password', 'elastic-password', 'minio-password', 'admin-password']) {
    try { await writeFile(resolve(secretDir, name), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!/^[a-f0-9]{64}$/.test(await readFile(resolve(secretDir, name), 'utf8'))) throw new Error('unexpected_secret_format');
  }
  const password = await readFile(resolve(secretDir, 'mysql-password'), 'utf8');
  await writeFile(stateFile, JSON.stringify({ environment: 'smc-icc-test', database: 'omni_ragflow', phase: 'claimed' }, null, 2));
  mysql("CREATE DATABASE IF NOT EXISTS omni_ragflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n"
    + (users ? '' : `CREATE USER 'omni_ragflow'@'%' IDENTIFIED BY '${password}';\n`)
    + "GRANT ALL PRIVILEGES ON omni_ragflow.* TO 'omni_ragflow'@'%';\n");
  const grants = mysql("SHOW GRANTS FOR 'omni_ragflow'@'%';");
  if (grants.split('\n').some(line => !/^GRANT (USAGE ON \*\.\*|ALL PRIVILEGES ON `omni_ragflow`\.\*) TO /.test(line) || line.includes('GRANT OPTION'))) throw new Error('database_grants_unexpected');
  await writeFile(stateFile, JSON.stringify({ environment: 'smc-icc-test', database: 'omni_ragflow', phase: 'ready', observedAt: new Date().toISOString() }, null, 2));
  const deployDir = resolve(root, 'knowledge-deploy');
  await mkdir(deployDir, { recursive: true });
  try {
    await writeFile(resolve(deployDir, 'ragflow.env'), [
      'RAGFLOW_IMAGE=smc-icc/ragflow:183bed69d',
      'RAGFLOW_ES_IMAGE=elasticsearch@sha256:58a3a280935d830215802322e9a0373faaacdfd646477aa7e718939c2f29292a',
      'RAGFLOW_MINIO_IMAGE=minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e',
      `RAGFLOW_SECRET_DIR=${secretDir.replaceAll('\\', '/')}`, '',
    ].join('\n'), { flag: 'wx' });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  console.log(JSON.stringify({ status: 'ready', mysqlPrivileges: 'omni_ragflow_only', redis: 'existing_instance_db1', credentialsPrinted: false }));
} catch (error) {
  const codes = new Set(['mysql_bootstrap_failed', 'redis_db1_unverified', 'existing_resources_need_reconciliation', 'bootstrap_state_mismatch', 'unexpected_secret_format', 'database_grants_unexpected']);
  console.error(JSON.stringify({ status: 'failed', code: codes.has(error.message) ? error.message : 'bootstrap_failed' }));
  process.exitCode = 1;
}
