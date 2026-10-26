import fs from 'node:fs/promises';
import { parse } from 'dotenv';
import { checkConfTenancyReady } from '../shared/services/conf-tenancy-readiness.js';
import { prisma } from '../plugins/db.js';
try {
  const args = process.argv.slice(2);
  if (args[0] !== '--conf-env' || !args[1] || (args.length !== 2 && !(args.length === 3 && args[2] === '--post-enable'))) throw new Error('Usage: conf:ready --conf-env CONF_ENV_FILE [--post-enable]');
  const result = await checkConfTenancyReady(parse(await fs.readFile(args[1])), args[2] ? 'post-enable' : 'pre-enable');
  console.log(JSON.stringify(result, null, 2)); if (!result.ready) process.exitCode = 2;
} catch { console.error('Readiness check failed; verify input syntax, env files, DB connectivity and applied migrations. No credentials are logged.'); process.exitCode = 1; }
finally { await prisma.$disconnect(); const { getIccMysqlPool } = await import('../shared/services/icc-groups-dal.js'); await (await getIccMysqlPool())?.end(); }
