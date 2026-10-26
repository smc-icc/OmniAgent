import { createHash, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../plugins/db.js';
import { accessScope } from '../access/access.scope.js';
import { originalsRoot, originalPath } from './knowledge.storage.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const activeStates = ['queued', 'running', 'staging', 'recovering'];
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

/** Recover a reserved upload after its writer lease expires, without re-uploading. */
export async function recoverStagedUpload() {
  const now = new Date();
  const job = await prisma.knowledge_sync_jobs.findFirst({ where: { operation: 'upload', state: { in: ['staging', 'recovering'] },
    locked_until: { lte: now } }, orderBy: { created_at: 'asc' } });
  if (!job?.version_id) return;
  const lease = new Date(Date.now() + 10 * 60_000);
  const claimed = await prisma.knowledge_sync_jobs.updateMany({ where: { id: job.id, state: job.state, locked_until: job.locked_until },
    data: { state: 'recovering', locked_until: lease } });
  if (!claimed.count) return;
  const version = await prisma.knowledge_document_versions.findFirst({ where: { id: job.version_id,
    document: { id: job.document_id!, account_id: job.account_id, vdn_id: job.vdn_id } } });
  let valid = false;
  try {
    if (version?.object_key) {
      const target = originalPath(version.object_key);
      let bytes: Buffer;
      const readOriginal = async (file: string) => {
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe_original');
        return readFile(file);
      };
      try { bytes = await readOriginal(target); }
      catch (e) {
        if (!missing(e)) throw e;
        bytes = await readOriginal(`${target}.part`);
        if (digest(bytes) === version.content_sha256) await rename(`${target}.part`, target);
      }
      valid = digest(bytes) === version.content_sha256;
    }
  } catch (e) { if (!missing(e)) throw e; }
  await prisma.$transaction(async tx => {
    const updated = await tx.knowledge_sync_jobs.updateMany({ where: { id: job.id, state: 'recovering', locked_until: lease },
      data: { state: valid ? 'queued' : 'failed', locked_until: null, next_run_at: new Date(), last_error: valid ? null : 'upload_incomplete' } });
    if (updated.count && !valid && version) await tx.knowledge_document_versions.update({ where: { id: version.id }, data: { index_state: 'failed', error_code: 'upload_incomplete' } });
  });
}

async function mayRemove(key: string, partial: boolean, filename: string) {
  const versionId = key.split('/')[2];
  if (await prisma.knowledge_sync_jobs.count({ where: { state: { in: activeStates },
    OR: [{ version_id: versionId }, { result_object_key: key }] } })) return false;
  const references = await prisma.knowledge_document_versions.findMany({ where: { object_key: key }, select: { content_sha256: true } });
  if (!references.length) return true;
  if (!partial) return false;
  // Fully written parts are recoverable originals, even if a prior job failed.
  const actual = digest(await readFile(filename));
  return references.every(v => v.content_sha256 !== actual);
}

/** Private storage only. Default is dry-run; referenced failed originals survive. */
export async function cleanupKnowledgeOriginals(options: { apply?: boolean; now?: number; limit?: number; cursor?: string } = {}) {
  return accessScope.exit(async () => {
    const now = options.now ?? Date.now(), grace = 24 * 60 * 60_000;
    const limit = Math.min(1000, Math.max(1, options.limit ?? 1000));
    const root = originalsRoot(), results: { key: string; partial: boolean; bytes: number; action: string }[] = [];
    try { const stat = await lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_originals_root'); }
    catch (e) { if (missing(e)) return { dryRun: !options.apply, scanned: 0, nextCursor: undefined, results }; throw e; }
    let scanned = 0;
    let last: string | undefined;
    const entries = async (directory: string) => (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const safeDirectory = async (directory: string) => { const stat = await lstat(directory); return stat.isDirectory() && !stat.isSymbolicLink(); };
    for (const account of await entries(root)) {
      if (!account.isDirectory() || !/^[1-9]\d*$/.test(account.name)) continue;
      const accountDir = path.join(root, account.name);
      if (!await safeDirectory(accountDir)) continue;
      for (const vdn of await entries(accountDir)) {
        if (!vdn.isDirectory() || !/^[1-9]\d*$/.test(vdn.name)) continue;
        const directory = path.join(accountDir, vdn.name);
        if (!await safeDirectory(directory)) continue;
        for (const entry of await entries(directory)) {
          if (!entry.isFile() || !/^[a-f0-9-]{36}(\.part)?$/.test(entry.name)) continue;
          const cursor = `${account.name}/${vdn.name}/${entry.name}`;
          if (options.cursor && cursor <= options.cursor) continue;
          if (scanned >= limit) return { dryRun: !options.apply, scanned, truncated: true, nextCursor: last, results };
          scanned++;
          last = cursor;
          const partial = entry.name.endsWith('.part'), version = partial ? entry.name.slice(0, -5) : entry.name;
          const key = `${account.name}/${vdn.name}/${version}`, file = path.join(directory, entry.name);
          const before = await lstat(file);
          if (!before.isFile() || now - Math.max(before.mtimeMs, before.ctimeMs) < grace || !await mayRemove(key, partial, file)) continue;
          if (!options.apply) { results.push({ key, partial, bytes: before.size, action: 'would_remove' }); continue; }
          const after = await lstat(file);
          if (!await safeDirectory(accountDir) || !await safeDirectory(directory) || !after.isFile() || after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size
            || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || !await mayRemove(key, partial, file)) continue;
          const record = { account_id: Number(account.name), vdn_id: Number(vdn.name), actor_kind: 'system', action: 'original.cleanup',
            resource_id: key + (partial ? '.part' : ''), request_id: `cleanup:${randomUUID()}` };
          await prisma.knowledge_audit_events.create({ data: { ...record, outcome: 'started' } });
          try { await unlink(file); }
          catch (e) { if (!missing(e)) throw e; }
          await prisma.knowledge_audit_events.create({ data: { ...record, outcome: 'removed' } });
          results.push({ key, partial, bytes: before.size, action: 'removed' });
        }
      }
    }
    return { dryRun: !options.apply, scanned, nextCursor: undefined, results };
  });
}
