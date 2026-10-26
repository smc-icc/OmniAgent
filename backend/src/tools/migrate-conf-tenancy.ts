import fs from 'node:fs/promises';
import { planLegacyAdoption, applyLegacyAdoption } from '../shared/services/conf-tenancy-migration.js';
import { createTenancyBackup, verifyTenancyBackup } from '../shared/services/conf-tenancy-backup.js';
import { prisma } from '../plugins/db.js';
const args = process.argv.slice(2);
const usage = 'conf:migrate --backup NEW_DIRECTORY | --plan INPUT.json [--out REVIEW.json] | --apply INPUT.json --review-sha256 DIGEST --backup-receipt RECEIPT.json --ownership-reviewed --restore-tested';
try {
  const [mode, file] = args;
  if (!file) throw new Error(usage);
  if (mode === '--backup') {
    if (args.length !== 2) throw new Error(usage);
    console.log(JSON.stringify(await createTenancyBackup(file), null, 2));
  } else {
    const opts = new Map<string, string>();
    let ownership = false, restored = false;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--ownership-reviewed') { ownership = true; continue; }
      if (args[i] === '--restore-tested') { restored = true; continue; }
      if (!['--out', '--review-sha256', '--backup-receipt'].includes(args[i]) || opts.has(args[i]) || !args[i + 1]) throw new Error(usage);
      opts.set(args[i], args[++i]);
    }
    const input = JSON.parse(await fs.readFile(file, 'utf8'));
    if (mode === '--plan') {
      if (opts.has('--review-sha256') || opts.has('--backup-receipt') || ownership || restored) throw new Error(usage);
      const plan = await planLegacyAdoption(input);
      if (opts.has('--out')) await fs.writeFile(opts.get('--out')!, JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify(plan, null, 2)); if (!plan.applicable) process.exitCode = 2;
    } else if (mode === '--apply') {
      if (!ownership || !restored || !opts.get('--review-sha256') || !opts.get('--backup-receipt') || opts.has('--out')) throw new Error(usage);
      const backup = await verifyTenancyBackup(opts.get('--backup-receipt')!);
      console.log(JSON.stringify(await applyLegacyAdoption(input, opts.get('--review-sha256')!, backup.digest), null, 2));
    } else throw new Error(usage);
  }
} catch {
  console.error(`Migration/backup stopped safely. Review syntax, maintenance, plan blockers/digest, backup target/files, and connection configuration. ${usage}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  const { getIccMysqlPool } = await import('../shared/services/icc-groups-dal.js');
  await (await getIccMysqlPool())?.end();
}
