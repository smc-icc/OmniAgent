import { describe, expect, it } from 'vitest';
import { buildRetrievalBody } from '../../integrations/ragflow/ragflow.request.js';
import { normalizeRetrieval } from '../../integrations/ragflow/ragflow.normalize.js';

describe('RAGFlow request safety', () => {
  it('rejects an empty document allowlist', () => {
    expect(() => buildRetrievalBody({ bindingId: 'b1', datasetIds: ['d1'], documentIds: [] }, '保修')).toThrow('empty_document_allowlist');
  });

  it('fixes enhancement flags and carries only the server-selected sources', () => {
    const body = buildRetrievalBody({ bindingId: 'b1', datasetIds: ['d1'], documentIds: ['rf-a'] }, '保修');
    expect(body).toMatchObject({ dataset_ids: ['d1'], document_ids: ['rf-a'], keyword: false, use_kg: false, include_knowledge_compilation: false });
  });

  it('rejects a successful response containing an unknown document', () => {
    expect(() => normalizeRetrieval({ code: 0, data: { chunks: [{ id: 'c-b', dataset_id: 'ds', document_id: 'rf-b', content: '内部价格' }] } }, [{ documentId: 'a', versionId: 'v1', bindingId: 'bind', datasetId: 'ds', externalDocumentId: 'rf-a', revision: 1, audience: 'internal' }])).toThrow('unauthorized_retrieval_source');
  });
});
