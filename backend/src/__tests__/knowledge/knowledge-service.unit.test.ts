import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ principal: vi.fn(), documents: vi.fn(), connection: vi.fn(), post: vi.fn(), audit: vi.fn() }));
vi.mock('../../plugins/db.js', () => ({ prisma: {} }));
vi.mock('../../modules/knowledge/knowledge.runtime-policy.js', () => ({
  knowledgePrincipal: mock.principal, documentPolicy: (d: any) => d.policy, libraryPolicy: (b: any) => b.policy,
}));
vi.mock('../../modules/knowledge/knowledge.repository.js', () => ({
  loadDocuments: mock.documents, audit: mock.audit,
  tenantWhere: (p: any) => ({ account_id: p.accountId, vdn_id: p.vdnId }),
}));
vi.mock('../../modules/knowledge/knowledge.connection.js', () => ({ knowledgeConnection: mock.connection }));
import { askKnowledge } from '../../modules/knowledge/knowledge.service.js';

const p = () => ({ userId: 1, accountId: 1, vdnId: 1, enabled: true, operatorId: 'operator:1:1',
  agentGroupIds: [], skillGroupIds: [], departmentIds: [], roleIds: [], customGroupIds: [],
  permissions: ['knowledge.read', 'ai.execute'], scopes: { 'knowledge.read': ['account'], 'ai.execute': ['account'] } });
function document() {
  const owner = { ownerOperatorId: 'operator:1:2', agentGroupIds: [], departmentIds: [] };
  const policy = { accountId: 1, vdnId: 1, libraryId: 'base', documentId: 'doc', versionId: 'ver', activeVersionId: 'ver',
    authorOperatorId: 'operator:1:2', ownership: owner, state: 'published', indexReady: true, customerApproved: false,
    validFrom: null, validTo: null, aclMode: 'inherit', acl: [],
    library: { accountId: 1, vdnId: 1, libraryId: 'base', enabled: true, ownership: owner,
      acl: [{ kind: 'account', subject: 'account:1:1', action: 'read' }] } };
  const connection = { account_id: 1, vdn_id: 1, state: 'active', external_tenant_id: 'tenant1', credential_ref: 'vdn:1:1', base_url: 'http://ragflow-api' };
  return { id: 'doc', base_id: 'base', active_version_id: 'ver', audience: 'internal', policy,
    base: { acl_revision: 1, active_generation: 1 }, versions: [{ id: 'ver', binding_id: 'binding', external_document_id: 'remote',
      binding: { id: 'binding', base_id: 'base', state: 'active', generation: 1, external_dataset_id: 'dataset', connection } }] };
}
describe('runtime knowledge retrieval', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mock.principal.mockImplementation(async () => p());
    mock.documents.mockImplementation(async () => [document()]);
    mock.connection.mockResolvedValue({ client: { post: mock.post }, config: { tenantId: 'tenant1', baseUrl: 'http://ragflow-api', apiKey: 'private' }, credentialRef: 'vdn:1:1' });
    mock.post.mockResolvedValue({ chunks: [{ id: 'chunk', dataset_id: 'dataset', document_id: 'remote', content: 'ICCLOCAL20261011', similarity: 0.9 }] });
  });
  it('uses explicit VDN identity and document allowlists', async () => {
    expect((await askKnowledge({ id: 'request' } as any, '资料编号？')).answer).toContain('ICCLOCAL20261011');
    expect(mock.documents.mock.calls[0][0]).toMatchObject({ accountId: 1, vdnId: 1 });
    expect(mock.post.mock.calls[0][1]).toMatchObject({ dataset_ids: ['dataset'], document_ids: ['remote'] });
  });
  it('does not call upstream for an empty authorized set', async () => {
    mock.documents.mockResolvedValue([]);
    expect((await askKnowledge({} as any, '问题')).answered).toBe(false);
    expect(mock.connection).not.toHaveBeenCalled(); expect(mock.post).not.toHaveBeenCalled();
  });
  it('rejects upstream results outside the allowlist', async () => {
    mock.post.mockResolvedValue({ chunks: [{ id: 'chunk', dataset_id: 'dataset', document_id: 'other', content: 'secret' }] });
    await expect(askKnowledge({} as any, '问题')).rejects.toThrow('unauthorized_retrieval_source');
  });
  it.each(['withdrawn', 'deleted'])('rejects %s sources changed during retrieval', async state => {
    const latest = document(); latest.policy.state = state;
    mock.documents.mockResolvedValueOnce([document()]).mockResolvedValueOnce([latest]);
    await expect(askKnowledge({} as any, '问题')).rejects.toMatchObject({ statusCode: 403 });
  });
  it('rejects live grant revocation during retrieval', async () => {
    mock.principal.mockResolvedValueOnce(p()).mockResolvedValueOnce({ ...p(), permissions: [] });
    await expect(askKnowledge({} as any, '问题')).rejects.toThrow('资料或授权已变更');
  });
  it('rejects a binding disabled during retrieval', async () => {
    const latest = document(); latest.versions[0].binding.state = 'disabled';
    mock.documents.mockResolvedValueOnce([document()]).mockResolvedValueOnce([latest]);
    await expect(askKnowledge({} as any, '问题')).rejects.toThrow('资料或授权已变更');
  });
  it('does not retrieve a source from another VDN', async () => {
    const d = document(); d.policy.vdnId = 2;
    mock.documents.mockResolvedValue([d]);
    expect((await askKnowledge({} as any, '问题')).answered).toBe(false);
    expect(mock.post).not.toHaveBeenCalled();
  });
});
