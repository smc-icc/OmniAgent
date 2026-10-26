import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ job: vi.fn(), claim: vi.fn(), intent: vi.fn(), count: vi.fn(), base: vi.fn(), documents: vi.fn(), connection: vi.fn(), dataset: vi.fn(), remote: vi.fn(), post: vi.fn(), upload: vi.fn(), remove: vi.fn(), version: vi.fn(), versionMany: vi.fn(), unlink: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), unlink: mock.unlink }));
vi.mock('../../plugins/db.js', () => ({ prisma: {
  knowledge_sync_jobs: { findFirst: mock.job, updateMany: mock.claim, update: mock.intent, count: mock.count },
  knowledge_bases: { findFirst: mock.base },
  knowledge_document_versions: { update: mock.version, updateMany: mock.versionMany },
} }));
vi.mock('../../modules/knowledge/knowledge.connection.js', () => ({ knowledgeConnection: mock.connection }));
vi.mock('../../modules/knowledge/knowledge.repository.js', () => ({ loadDocuments: mock.documents, tenantWhere: (p: any) => ({ account_id: p.accountId, vdn_id: p.vdnId }) }));
vi.mock('../../modules/knowledge/knowledge.service.js', () => ({ originalPath: (key: string) => key }));
vi.mock('../../modules/knowledge/knowledge.cleanup.js', () => ({ recoverStagedUpload: vi.fn(), cleanupKnowledgeOriginals: vi.fn() }));
vi.mock('../../modules/knowledge/knowledge.provider.js', () => ({ parserProfile: {}, providerId: (id: string) => id, uncertain: (v: any) => v?.state === 'uncertain', findDataset: mock.dataset, findProviderDocument: mock.remote }));
import { runKnowledgeJob } from '../../modules/knowledge/knowledge.worker.js';

function job() { return { id: 'job', account_id: 1, vdn_id: 1, operation: 'upload', document_id: 'doc', version_id: 'ver', binding_id: 'binding', attempts: 80, payload: { extension: '.txt' }, created_at: new Date(), external_request_key: 'ver.txt' }; }
function doc(state = 'processing') { return { id: 'doc', base_id: 'base', state, versions: [{ id: 'ver', object_key: 'private', binding_id: 'binding', external_document_id: 'remote', index_state: 'parse_requested', binding: { base_id: 'base', external_dataset_id: 'dataset', connection: { account_id: 1, vdn_id: 1, state: 'active', external_tenant_id: 'tenant', credential_ref: 'key', base_url: 'http://ragflow-api' } } }] }; }
describe('durable knowledge worker', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mock.job.mockResolvedValue(job()); mock.claim.mockResolvedValue({ count: 1 });
    mock.documents.mockResolvedValue([doc()]); mock.connection.mockResolvedValue({ config: { tenantId: 'tenant', baseUrl: 'http://ragflow-api' }, credentialRef: 'key', client: { post: mock.post, upload: mock.upload, delete: mock.remove } });
    mock.remote.mockResolvedValue({ id: 'remote', run: '1' }); mock.count.mockResolvedValue(0); mock.unlink.mockResolvedValue(undefined);
  });
  it('uses a CAS lease and does no work when another worker wins', async () => {
    mock.claim.mockResolvedValueOnce({ count: 0 }); await runKnowledgeJob();
    expect(mock.claim.mock.calls[0][0].where).toMatchObject({ id: 'job', state: { in: ['queued', 'running'] } });
    expect(mock.connection).not.toHaveBeenCalled();
  });
  it('does not turn successful parse polling into cumulative retry failure', async () => {
    await runKnowledgeJob();
    expect(mock.claim.mock.calls[1][0].data).toMatchObject({ state: 'queued', last_error: null, payload: { errorAttempts: 0 } });
    expect(mock.post).not.toHaveBeenCalled();
  });
  it('reconciles a crashed upload without sending a duplicate write', async () => {
    mock.remote.mockResolvedValue(undefined); await runKnowledgeJob();
    expect(mock.upload).not.toHaveBeenCalled(); expect(mock.claim.mock.calls[1][0].data.state).toBe('queued');
  });
  it('fails an old uncertain write without blindly recreating it', async () => {
    mock.job.mockResolvedValue({ ...job(), created_at: new Date(Date.now() - 360000) }); mock.remote.mockResolvedValue(undefined);
    await runKnowledgeJob(); expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.claim.mock.calls[1][0].data).toMatchObject({ state: 'failed', last_error: 'upload_write_uncertain' });
  });
  it('does not recreate an uncertain dataset', async () => {
    mock.job.mockResolvedValue({ ...job(), operation: 'create_base', payload: { baseId: 'base' }, created_at: new Date(Date.now() - 360000) }); mock.base.mockResolvedValue({ id: 'base', state: 'active' });
    mock.dataset.mockResolvedValue(undefined); await runKnowledgeJob();
    expect(mock.post).not.toHaveBeenCalled(); expect(mock.claim.mock.calls[1][0].data.last_error).toBe('dataset_write_uncertain');
  });
  it('does not upload an already tombstoned document', async () => {
    mock.job.mockResolvedValue({ ...job(), external_request_key: null }); mock.documents.mockResolvedValue([doc('deleted')]);
    await runKnowledgeJob(); expect(mock.upload).not.toHaveBeenCalled(); expect(mock.claim.mock.calls[1][0].data.state).toBe('succeeded');
  });
  it('waits for active uploads before physically deleting', async () => {
    mock.job.mockResolvedValue({ ...job(), operation: 'delete' }); mock.documents.mockResolvedValue([doc('deleted')]); mock.count.mockResolvedValue(1);
    await runKnowledgeJob(); expect(mock.remove).not.toHaveBeenCalled(); expect(mock.unlink).not.toHaveBeenCalled(); expect(mock.claim.mock.calls[1][0].data.state).toBe('queued');
  });
  it('checks remote absence before confirming deletion', async () => {
    mock.job.mockResolvedValue({ ...job(), operation: 'delete' }); mock.documents.mockResolvedValue([doc('deleted')]);
    mock.remote.mockResolvedValueOnce({ id: 'remote' }).mockResolvedValueOnce(undefined);
    await runKnowledgeJob(); expect(mock.remove).toHaveBeenCalledWith('/datasets/dataset/documents', { ids: ['remote'] });
    expect(mock.version).toHaveBeenCalledWith({ where: { id: 'ver' }, data: { index_state: 'deleted' } });
    expect(mock.unlink).toHaveBeenCalledWith('private');
    expect(mock.claim.mock.calls[1][0].data.state).toBe('succeeded');
  });
  it('does not erase an original before remote absence is confirmed', async () => {
    mock.job.mockResolvedValue({ ...job(), operation: 'delete' }); mock.documents.mockResolvedValue([doc('deleted')]);
    await runKnowledgeJob(); expect(mock.unlink).not.toHaveBeenCalled(); expect(mock.version).not.toHaveBeenCalled();
    expect(mock.claim.mock.calls[1][0].data.state).toBe('queued');
  });
  it('resumes safely when the original was already removed before a crash', async () => {
    mock.job.mockResolvedValue({ ...job(), operation: 'delete' }); mock.documents.mockResolvedValue([doc('deleted')]);
    mock.remote.mockResolvedValue(undefined); mock.unlink.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await runKnowledgeJob(); expect(mock.claim.mock.calls[1][0].data.state).toBe('succeeded');
  });
  it('can delete a historical version without a private original key', async () => {
    const d: any = doc('deleted'); d.versions[0].object_key = null;
    mock.job.mockResolvedValue({ ...job(), operation: 'delete' }); mock.documents.mockResolvedValue([d]);
    mock.remote.mockResolvedValue(undefined);
    await runKnowledgeJob(); expect(mock.unlink).not.toHaveBeenCalled();
    expect(mock.version).toHaveBeenCalledWith({ where: { id: 'ver' }, data: { index_state: 'deleted' } });
    expect(mock.claim.mock.calls[1][0].data.state).toBe('succeeded');
  });
  it('does not confirm deletion when original cleanup fails', async () => {
    mock.job.mockResolvedValue({ ...job(), operation: 'delete' }); mock.documents.mockResolvedValue([doc('deleted')]);
    mock.remote.mockResolvedValue(undefined); mock.unlink.mockRejectedValue(Object.assign(new Error('private path'), { code: 'EACCES' }));
    await runKnowledgeJob(); expect(mock.version).not.toHaveBeenCalled();
    expect(mock.claim.mock.calls[1][0].data).toMatchObject({ state: 'queued', last_error: 'provider_unavailable' });
  });
  it('fails a terminal parse error with a sanitized code', async () => {
    mock.remote.mockResolvedValue({ id: 'remote', run: '4' }); await runKnowledgeJob();
    expect(mock.claim.mock.calls[1][0].data).toMatchObject({ state: 'failed', last_error: 'parse_failed' });
  });
  it('explicit retry can restart a failed parse on the same remote document', async () => {
    const d = doc(); d.versions[0].index_state = 'pending'; mock.documents.mockResolvedValue([d]);
    mock.job.mockResolvedValue({ ...job(), payload: { extension: '.txt', retryParse: true } });
    mock.remote.mockResolvedValue({ id: 'remote', run: '4' }); mock.post.mockResolvedValue({});
    await runKnowledgeJob(); expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.post).toHaveBeenCalledWith('/datasets/dataset/documents/parse', { document_ids: ['remote'] });
    expect(mock.claim.mock.calls[1][0].data.state).toBe('queued');
  });
  it('cannot overwrite a version after its lease was lost', async () => {
    mock.remote.mockResolvedValue({ id: 'remote', run: '4' }); mock.claim.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await runKnowledgeJob(); expect(mock.versionMany).not.toHaveBeenCalled();
  });
  it('sanitizes provider failures and counts only consecutive failures', async () => {
    mock.connection.mockRejectedValue(new Error('Authorization secret token')); await runKnowledgeJob();
    expect(mock.claim.mock.calls[1][0].data).toMatchObject({ state: 'queued', last_error: 'provider_unavailable', payload: { errorAttempts: 1 } });
  });
});
