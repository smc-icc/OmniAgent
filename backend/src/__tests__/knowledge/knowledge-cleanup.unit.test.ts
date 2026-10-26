import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const m = vi.hoisted(() => ({ stat: vi.fn(), dirs: vi.fn(), read: vi.fn(), rename: vi.fn(), unlink: vi.fn(), refs: vi.fn(), count: vi.fn(),
  audit: vi.fn(), job: vi.fn(), claim: vi.fn(), version: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock('node:fs/promises', () => ({ lstat: m.stat, readdir: m.dirs, readFile: m.read, rename: m.rename, unlink: m.unlink }));
vi.mock('../../plugins/db.js', () => ({ prisma: { knowledge_document_versions: { findMany: m.refs, findFirst: m.version, update: m.update },
  knowledge_sync_jobs: { count: m.count, findFirst: m.job, updateMany: m.claim }, knowledge_audit_events: { create: m.audit }, $transaction: m.transaction } }));
vi.mock('../../modules/access/access.scope.js', () => ({ accessScope: { exit: (f: any) => f() } }));
import { cleanupKnowledgeOriginals, recoverStagedUpload } from '../../modules/knowledge/knowledge.cleanup.js';
import { prisma } from '../../plugins/db.js';
const id = '8f215e12-4dd9-4c70-82ec-a27066f89243', key = `1/2/${id}`;
const fileStat = () => ({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false,
  ino: 1, dev: 1, size: 4, mtimeMs: 0, ctimeMs: 0 });
const entry = (name: string, directory: boolean) => ({ name, isDirectory: () => directory, isFile: () => !directory });
describe('original recovery and garbage collection', () => {
  beforeEach(() => {
    vi.resetAllMocks(); process.env.KNOWLEDGE_STORAGE_DIR = '/private-kb';
    m.stat.mockImplementation(async (p: string) => !p.includes(id) ? { ...fileStat(), isDirectory: () => true } : fileStat());
    m.dirs.mockResolvedValueOnce([entry('1', true)]).mockResolvedValueOnce([entry('2', true)]).mockResolvedValue([entry(id, false)]);
    m.refs.mockResolvedValue([]); m.count.mockResolvedValue(0); m.transaction.mockImplementation((f: any) => f(prisma));
    m.claim.mockResolvedValue({ count: 1 }); m.read.mockResolvedValue(Buffer.from('data'));
  });
  it('defaults to dry-run and never unlinks files', async () => {
    const r = await cleanupKnowledgeOriginals(); expect(r.results[0]).toMatchObject({ key, action: 'would_remove' });
    expect(m.unlink).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it('audits before and after removing an aged unreferenced file', async () => {
    await cleanupKnowledgeOriginals({ apply: true }); expect(m.unlink).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls.map(c => c[0].data.outcome)).toEqual(['started', 'removed']);
    expect(m.audit.mock.invocationCallOrder[0]).toBeLessThan(m.unlink.mock.invocationCallOrder[0]);
  });
  it('retains referenced failed originals', async () => {
    m.refs.mockResolvedValue([{ content_sha256: 'hash' }]); expect((await cleanupKnowledgeOriginals({ apply: true })).results).toEqual([]);
    expect(m.unlink).not.toHaveBeenCalled();
  });
  it('retains originals referenced by in-flight jobs even without a version record', async () => {
    m.count.mockResolvedValue(1); await cleanupKnowledgeOriginals({ apply: true }); expect(m.unlink).not.toHaveBeenCalled();
  });
  it('rechecks database references immediately before deletion', async () => {
    m.refs.mockResolvedValueOnce([]).mockResolvedValue([{ content_sha256: 'hash' }]);
    await cleanupKnowledgeOriginals({ apply: true }); expect(m.unlink).not.toHaveBeenCalled();
  });
  it('keeps new files during the 24-hour grace period', async () => {
    m.stat.mockImplementation(async (p: string) => !p.includes(id) ? { ...fileStat(), isDirectory: () => true } : { ...fileStat(), ctimeMs: Date.now() });
    await cleanupKnowledgeOriginals({ apply: true }); expect(m.unlink).not.toHaveBeenCalled();
  });
  it('does not delete a file replaced since inventory', async () => {
    let reads = 0;
    m.stat.mockImplementation(async (p: string) => !p.includes(id) ? { ...fileStat(), isDirectory: () => true }
      : { ...fileStat(), ino: ++reads });
    await cleanupKnowledgeOriginals({ apply: true }); expect(m.unlink).not.toHaveBeenCalled();
  });
  it('fails closed when audit storage is unavailable', async () => {
    m.audit.mockRejectedValue(new Error('db offline')); await expect(cleanupKnowledgeOriginals({ apply: true })).rejects.toThrow('db offline');
    expect(m.unlink).not.toHaveBeenCalled();
  });
  it('recovers a crash after atomic original placement', async () => {
    m.job.mockResolvedValue({ id: 'j', operation: 'upload', state: 'staging', version_id: id, document_id: 'doc', account_id: 1, vdn_id: 2, locked_until: new Date(0) });
    m.version.mockResolvedValue({ id, object_key: key, content_sha256: createHash('sha256').update('data').digest('hex') });
    await recoverStagedUpload(); expect(m.claim.mock.calls[1][0].data.state).toBe('queued'); expect(m.unlink).not.toHaveBeenCalled();
  });
  it('recovers a fully flushed part before rename', async () => {
    m.job.mockResolvedValue({ id: 'j', state: 'staging', version_id: id, document_id: 'doc', account_id: 1, vdn_id: 2, locked_until: new Date(0) });
    m.version.mockResolvedValue({ id, object_key: key, content_sha256: createHash('sha256').update('data').digest('hex') });
    m.stat.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' })).mockResolvedValue(fileStat());
    await recoverStagedUpload(); expect(m.rename).toHaveBeenCalledTimes(1); expect(m.claim.mock.calls[1][0].data.state).toBe('queued');
  });
  it('marks a truncated staged file failed without losing its reservation', async () => {
    m.job.mockResolvedValue({ id: 'j', state: 'staging', version_id: id, document_id: 'doc', account_id: 1, vdn_id: 2, locked_until: new Date(0) });
    m.version.mockResolvedValue({ id, object_key: key, content_sha256: 'different' });
    await recoverStagedUpload(); expect(m.claim.mock.calls[1][0].data).toMatchObject({ state: 'failed', last_error: 'upload_incomplete' });
    expect(m.unlink).not.toHaveBeenCalled();
  });
  it('continues past the first page of retained files', async () => {
    const next = '9f215e12-4dd9-4c70-82ec-a27066f89243';
    m.dirs.mockReset().mockImplementation(async (p: string) => p.endsWith('private-kb') ? [entry('1', true)]
      : /[\\/]1$/.test(p) ? [entry('2', true)] : [entry(id, false), entry(next, false)]);
    m.stat.mockImplementation(async (p: string) => /[a-f0-9-]{36}$/.test(p) ? fileStat() : { ...fileStat(), isDirectory: () => true });
    m.refs.mockResolvedValueOnce([{ content_sha256: 'keep' }]).mockResolvedValue([]);
    const first = await cleanupKnowledgeOriginals({ limit: 1 });
    expect(first.nextCursor).toBe(key);
    const second = await cleanupKnowledgeOriginals({ limit: 1, cursor: first.nextCursor });
    expect(second.results[0].key).toBe(`1/2/${next}`); expect(second.nextCursor).toBeUndefined();
  });
  it('ignores symbolic-link tenant directories', async () => {
    m.stat.mockResolvedValueOnce({ ...fileStat(), isDirectory: () => true }).mockResolvedValue({ ...fileStat(), isDirectory: () => true, isSymbolicLink: () => true });
    expect((await cleanupKnowledgeOriginals({ apply: true })).scanned).toBe(0); expect(m.unlink).not.toHaveBeenCalled();
  });
  it('retains a fully recoverable partial and removes only invalid aged partials', async () => {
    m.dirs.mockReset().mockResolvedValueOnce([entry('1', true)]).mockResolvedValueOnce([entry('2', true)]).mockResolvedValue([entry(`${id}.part`, false)]);
    m.refs.mockResolvedValue([{ content_sha256: createHash('sha256').update('data').digest('hex') }]);
    await cleanupKnowledgeOriginals({ apply: true }); expect(m.unlink).not.toHaveBeenCalled();
  });
});
