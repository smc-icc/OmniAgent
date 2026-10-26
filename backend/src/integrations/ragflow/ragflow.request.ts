export interface RetrievalGroup {
  readonly bindingId: string;
  readonly datasetIds: readonly string[];
  readonly documentIds: readonly string[];
  readonly rerankId?: string;
}

export function buildRetrievalBody(group: RetrievalGroup, question: string): Record<string, unknown> {
  if (!question.trim()) throw new Error('invalid_retrieval_input');
  if (!group.datasetIds.length || group.datasetIds.some((id) => !id.trim())) throw new Error('empty_dataset_allowlist');
  if (!group.documentIds.length || group.documentIds.some((id) => !id.trim())) throw new Error('empty_document_allowlist');
  return {
    question,
    dataset_ids: [...group.datasetIds],
    document_ids: [...group.documentIds],
    page: 1,
    page_size: 10,
    similarity_threshold: 0.2,
    vector_similarity_weight: 0.3,
    knn_top_k: 1024,
    knn_num_candidates: 2048,
    rerank_candidates_count: 64,
    ...(group.rerankId ? { rerank_id: group.rerankId } : {}),
    keyword: false,
    cross_languages: [],
    use_kg: false,
    toc_enhance: false,
    include_knowledge_compilation: false,
    highlight: false,
    raptor: false,
    graphrag: false,
  };
}
