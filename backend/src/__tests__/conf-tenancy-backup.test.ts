import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { backupTarget, verifyTenancyBackup } from '../shared/services/conf-tenancy-backup.js';
beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://synthetic:secret@127.0.0.1:5432/omni';
  Object.assign(process.env, { ICC_MYSQL_HOST: '127.0.0.1', ICC_MYSQL_PORT: '3306', ICC_MYSQL_DB: 'icc', ICC_MYSQL_USER: 'backup', ICC_MYSQL_PASSWORD: 'synthetic' });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conf-backup-test-'));
  const files = [];
  for (const [name, text] of [['omni.pgdump', 'PGDMP' + 'synthetic'.repeat(8)], ['conf.sql', '-- synthetic SQL backup'.repeat(8)]]) {
    await fs.writeFile(path.join(root, name), text); files.push({ name, size: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') });
  }
  const receipt = { version: 1, target: backupTarget(), files, postgres_toc_verified: true, restore_verified: false };
  const file = path.join(root, 'backup-receipt.json'); await fs.writeFile(file, JSON.stringify(receipt)); return { root, file, receipt };
}
describe('backup verification safety', () => {
  it('never exposes credentials in target fingerprint', () => { expect(JSON.stringify(backupTarget())).not.toMatch(/secret|synthetic|backup/); });
  it('requires explicit source connection instead of silently backing up legacy defaults', () => { delete process.env.ICC_MYSQL_HOST; expect(backupTarget).toThrow('Explicit'); });
  it('verifies both dump sizes and content digests for the current target', async () => { const f = await fixture(); expect((await verifyTenancyBackup(f.file)).digest).toMatch(/^[a-f0-9]{64}$/); });
  it('rejects changed files', async () => { const f = await fixture(); await fs.appendFile(path.join(f.root, 'conf.sql'), 'changed'); await expect(verifyTenancyBackup(f.file)).rejects.toThrow('mismatch'); });
  it('rejects backup from another database endpoint', async () => { const f = await fixture(); process.env.ICC_MYSQL_DB = 'other'; await expect(verifyTenancyBackup(f.file)).rejects.toThrow('target'); });
  it('rejects arbitrary path traversal in a receipt', async () => { const f = await fixture(); f.receipt.files[0].name = '../other'; await fs.writeFile(f.file, JSON.stringify(f.receipt)); await expect(verifyTenancyBackup(f.file)).rejects.toThrow('inventory'); });
});
