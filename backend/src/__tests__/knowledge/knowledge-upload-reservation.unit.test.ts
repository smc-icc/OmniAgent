import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ base: vi.fn(), document: vi.fn(), version: vi.fn(), job: vi.fn(), queue: vi.fn(), audit: vi.fn(), write: vi.fn(), transaction: vi.fn() }));
vi.mock('../../plugins/db.js', () => ({ prisma: { knowledge_bases: { findFirst: m.base }, knowledge_sync_jobs: { updateMany: m.queue } } }));
vi.mock('../../modules/knowledge/knowledge.runtime-policy.js', () => ({ knowledgePrincipal: async () => ({ accountId: 1, vdnId: 2, userId: 3 }), libraryPolicy: (x: any) => x }));
vi.mock('../../modules/access/knowledge.authorization.js', () => ({ canCreateKnowledge: () => true }));
vi.mock('../../modules/knowledge/knowledge.repository.js', () => ({ tenantWhere: (p: any) => ({ account_id: p.accountId, vdn_id: p.vdnId }),
  knowledgeTransaction: m.transaction, audit: m.audit }));
vi.mock('../../modules/knowledge/knowledge.storage.js', () => ({ writeOriginal: m.write }));
import { uploadKnowledge } from '../../modules/knowledge/knowledge.service.js';
describe('crash-safe upload reservation', () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.base.mockResolvedValue({ id: 'base', active_generation: 1, bindings: [{ id: 'binding', generation: 1,
      config_hash: 'hash', connection: { account_id: 1, vdn_id: 2, state: 'active' } }] });
    m.transaction.mockImplementation(async (_: any, work: any) => work({ knowledge_documents: { create: m.document },
      knowledge_document_versions: { create: m.version }, knowledge_sync_jobs: { create: m.job } }));
    m.queue.mockResolvedValue({ count: 1 });
  });
  it('commits a staging job and immutable SHA256 reference before writing an original', async () => {
    await uploadKnowledge({ id: 'r' } as any, 'base', 'document.txt', Buffer.from('data'));
    expect(m.job.mock.calls[0][0].data).toMatchObject({ state: 'staging', account_id: 1, vdn_id: 2 });
    expect(m.version.mock.calls[0][0].data.content_sha256).toBe('3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7');
    expect(m.job.mock.invocationCallOrder[0]).toBeLessThan(m.write.mock.invocationCallOrder[0]);
    expect(m.write.mock.invocationCallOrder[0]).toBeLessThan(m.queue.mock.invocationCallOrder[0]);
    expect(m.queue.mock.calls[0][0].where).toMatchObject({ account_id: 1, vdn_id: 2, state: 'staging' });
  });
  it('never writes an original when reservation rollback is confirmed', async () => {
    m.transaction.mockRejectedValue(new Error('rollback'));
    await expect(uploadKnowledge({} as any, 'base', 'file.txt', Buffer.from('data'))).rejects.toThrow('rollback');
    expect(m.write).not.toHaveBeenCalled();
  });
  it('leaves a recoverable reservation after disk write failure', async () => {
    m.write.mockRejectedValue(new Error('ENOSPC'));
    await expect(uploadKnowledge({} as any, 'base', 'file.txt', Buffer.from('data'))).rejects.toMatchObject({ statusCode: 503 });
    expect(m.job).toHaveBeenCalled(); expect(m.queue).not.toHaveBeenCalled();
  });
  it('does not report success when the staging CAS lease was taken by recovery', async () => {
    m.queue.mockResolvedValue({ count: 0 });
    await expect(uploadKnowledge({} as any, 'base', 'file.txt', Buffer.from('data'))).rejects.toMatchObject({ statusCode: 503 });
  });
});
