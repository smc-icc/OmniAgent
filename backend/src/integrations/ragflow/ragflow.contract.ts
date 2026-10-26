import { z } from 'zod';
import { createHash } from 'node:crypto';

export const SOURCE_COMMIT = '183bed69ded49c60bb1804419c9e13a9ca3abd70';
export const RUN_STATE_MAP = {
  '0': 'queued', UNSTART: 'queued', '1': 'parsing', RUNNING: 'parsing',
  '2': 'cancelled', CANCEL: 'cancelled', '3': 'done', DONE: 'done',
  '4': 'failed', FAIL: 'failed', '5': 'queued', SCHEDULE: 'queued',
} as const;

const targetSchema = z.object({
  environment: z.literal('isolated-test'),
  baseUrl: z.string().url(), allowedOrigin: z.string().url(),
  dedicatedTenant: z.literal(true), datasetPrefix: z.literal('omni-contract-'),
  credentialFile: z.string().min(1), embeddingModel: z.string().min(1),
  rerankerModel: z.string().min(1).optional(),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sourceCommit: z.literal(SOURCE_COMMIT), apiScheme: z.literal('python'),
});

export function assertTestTarget(input: unknown) {
  const target = targetSchema.parse(input);
  const url = new URL(target.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || url.pathname !== '/' || url.origin !== target.allowedOrigin) {
    throw new Error('invalid_test_origin');
  }
  return target;
}

const envelopeSchema = z.object({ code: z.number().int(), data: z.unknown().optional() }).passthrough();
export function inspectEnvelope(status: number, value: unknown) {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) throw new Error('invalid_envelope');
  const envelope = parsed.data;
  const successfulIds = Array.isArray(envelope.data)
    ? envelope.data.flatMap(item => item && typeof item.id === 'string' ? [item.id] : []) : [];
  const httpOk = status >= 200 && status < 300;
  const state = httpOk && envelope.code === 0 ? 'success'
    : httpOk && successfulIds.length > 0 ? 'partial' : 'failed';
  return { state, code: envelope.code, data: envelope.data, successfulIds } as const;
}

export function inspectRunState(run: unknown) {
  if ((typeof run !== 'string' && typeof run !== 'number')
      || !Object.hasOwn(RUN_STATE_MAP, String(run))) throw new Error('unknown_run_state');
  return RUN_STATE_MAP[String(run) as keyof typeof RUN_STATE_MAP];
}

export const PARSER_CONFIG = {
  layout_recognize: 'DeepDOC', chunk_token_num: 512,
  auto_keywords: 0, auto_questions: 0, children_delimiter: '',
  raptor: { use_raptor: false }, graphrag: { use_graphrag: false },
};

// This probe body is not an application authorization boundary. Production uses T03/T04.
export function contractRetrievalBody(datasetId: string, documentIds: string[], question: string) {
  if (!documentIds.length || documentIds.some(id => !id.trim())) throw new Error('empty_document_allowlist');
  if (!datasetId.trim() || !question.trim()) throw new Error('invalid_retrieval_input');
  return {
    question, dataset_ids: [datasetId], document_ids: [...documentIds],
    page: 1, page_size: 10, similarity_threshold: 0.2, vector_similarity_weight: 0.3,
    knn_top_k: 1024, knn_num_candidates: 2048, rerank_candidates_count: 64,
    keyword: false, cross_languages: [], use_kg: false, toc_enhance: false,
    include_knowledge_compilation: false, highlight: false,
  };
}

export function assertSources(chunks: unknown, datasetId: string, documentIds: string[]) {
  if (!Array.isArray(chunks)) throw new Error('invalid_chunks');
  const schema = z.object({
    id: z.string().min(1), content: z.string(),
    dataset_id: z.string(), document_id: z.string(),
  }).passthrough();
  for (const chunk of chunks) {
    const parsed = schema.safeParse(chunk);
    if (!parsed.success || parsed.data.dataset_id !== datasetId
        || !documentIds.includes(parsed.data.document_id)) throw new Error('unauthorized_retrieval_source');
  }
}

// Only for the synthetic two-page PDF probe; not a universal document locator.
export function assertTwoPagePositions(chunks: unknown) {
  const parsed = z.array(z.object({
    content: z.string(),
    positions: z.array(z.tuple([
      z.number().int().min(1).max(2), z.number().finite(), z.number().finite(),
      z.number().finite(), z.number().finite(),
    ]).refine(p => p[1] <= p[2] && p[3] <= p[4])).min(1),
  })).min(1).safeParse(chunks);
  // Live DeepDOC OCR normalizes underscores/spaces in the fixed fixture markers.
  // Preserve marker identity and the one-based page/coordinate checks.
  if (!parsed.success || ['OMNIPAGEONE', 'OMNIPAGETWO'].some((marker, index) =>
    !parsed.data.some(chunk => chunk.content.replace(/[\s_]+/g, '').includes(marker)
      && chunk.positions.some(position => position[0] === index + 1)))) {
    throw new Error('pdf_position_contract_mismatch');
  }
}

// Allowlist evidence fields: unknown response fields never enter artifacts unredacted.
const numericFields = new Set(['code', 'total', 'progress', 'chunk_count', 'success_count', 'deleted', 'similarity']);
const idFields = new Set(['id', 'dataset_id', 'document_id', 'tenant_id']);
export function redactEvidence(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return null;
  if (key === 'positions') {
    return Array.isArray(value) ? value.map(position =>
      Array.isArray(position) ? position.map(n => typeof n === 'number' && Number.isFinite(n) ? n : null) : null) : null;
  }
  if (key === 'run') {
    try { inspectRunState(value); return value; } catch { return '<unknown-state>'; }
  }
  if (idFields.has(key) && typeof value === 'string') return `id:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
  if (typeof value === 'number' && numericFields.has(key)) return value;
  if (Array.isArray(value)) return value.map(item => redactEvidence(item));
  if (typeof value === 'object') {
    const safeKeys = new Set(['data', 'docs', 'chunks', 'doc_aggs', 'doc', 'errors', 'positions', 'run', ...numericFields, ...idFields]);
    return Object.fromEntries(Object.entries(value).filter(([name]) => safeKeys.has(name))
      .map(([name, child]) => [name, redactEvidence(child, name)]));
  }
  return typeof value === 'boolean' ? value : '<redacted>';
}
