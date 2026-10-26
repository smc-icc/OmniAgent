export interface AuthorizedSource {
  readonly documentId: string;
  readonly versionId: string;
  readonly bindingId: string;
  readonly datasetId: string;
  readonly externalDocumentId: string;
  readonly revision: number;
  readonly audience: 'internal' | 'customer_approved';
}

export interface KnowledgeHit {
  readonly chunkId: string;
  readonly documentId: string;
  readonly versionId: string;
  readonly content: string;
  readonly datasetId: string;
  readonly similarity?: number;
  readonly positions?: readonly unknown[];
}

export function normalizeRetrieval(response: unknown, authorized: readonly AuthorizedSource[]): KnowledgeHit[] {
  if (!response || typeof response !== 'object' || (response as { code?: unknown }).code !== 0) throw new Error('upstream_business_failure');
  const chunks = (response as { data?: { chunks?: unknown } }).data?.chunks;
  if (!Array.isArray(chunks)) throw new Error('invalid_chunks');
  const byExternal = new Map(authorized.map((source) => [`${source.datasetId}:${source.externalDocumentId}`, source]));
  const hits: KnowledgeHit[] = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') throw new Error('invalid_chunks');
    const item = chunk as { id?: unknown; dataset_id?: unknown; document_id?: unknown; content?: unknown; similarity?: unknown; positions?: unknown };
    if (typeof item.id !== 'string' || typeof item.dataset_id !== 'string' || typeof item.document_id !== 'string' || typeof item.content !== 'string') throw new Error('invalid_chunks');
    const source = byExternal.get(`${item.dataset_id}:${item.document_id}`);
    if (!source) throw new Error('unauthorized_retrieval_source');
    hits.push({ chunkId: item.id, documentId: source.documentId, versionId: source.versionId, content: item.content, datasetId: item.dataset_id, ...(typeof item.similarity === 'number' ? { similarity: item.similarity } : {}), ...(Array.isArray(item.positions) ? { positions: item.positions } : {}) });
  }
  return hits;
}
