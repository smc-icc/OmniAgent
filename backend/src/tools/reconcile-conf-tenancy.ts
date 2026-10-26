import { reconcileConfTenancy } from '../shared/services/conf-tenancy-reconcile.js';
import { prisma } from '../plugins/db.js';
const args = process.argv.slice(2);
const bindings: Record<number, number> = {};
let apply = false, allowCreate = false, vdnsOnly = false;
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') apply = true;
    else if (arg === '--allow-create') allowCreate = true;
    else if (arg === '--vdns-only') vdnsOnly = true;
    else if (arg === '--bind') {
      const match = /^([1-9]\d*):([1-9]\d*)$/.exec(args[++i] ?? '');
      if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2])) || bindings[Number(match[1])]) throw new Error('Usage: --bind VDN:ACCOUNT (once per VDN)');
      bindings[Number(match[1])] = Number(match[2]);
    } else throw new Error('Usage: npm run conf:reconcile -- [--bind VDN:ACCOUNT] [--allow-create] [--vdns-only] [--apply]. Default is read-only.');
  }
  const result = await reconcileConfTenancy({ apply, allowCreate, vdnsOnly, bindings });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 2;
} catch {
  console.error('Reconciliation failed. Check CLI syntax, source/backend configuration and migrations. No credential or SQL error is printed.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  // The shared MySQL pool is normally kept alive by the server, but this is a one-shot CLI.
  const { getIccMysqlPool } = await import('../shared/services/icc-groups-dal.js');
  await (await getIccMysqlPool())?.end();
}
