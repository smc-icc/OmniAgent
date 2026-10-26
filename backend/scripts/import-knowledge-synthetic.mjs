import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const backend = resolve(process.cwd());
const configPath = resolve(backend, '../release/knowledge-deploy/ragflow-target.local.json');
const target = JSON.parse(await readFile(configPath, 'utf8'));
const key = (await readFile(resolve(backend, '../release/knowledge-secrets/contract-api-key'), 'utf8')).trim();
const syntheticRoot = resolve(backend, '../docs/knowledge/synthetic');
const manifest = JSON.parse(await readFile(resolve(syntheticRoot, 'documents.json'), 'utf8'));
const runId = randomUUID();
const outputDir = resolve(backend, `../docs/knowledge/runs/synthetic-${runId}`);
await mkdir(outputDir, { recursive: true });

async function request(path, options = {}) {
  const response = await fetch(`${target.allowedOrigin}/api/v1${path}`, {
    ...options,
    signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${key}`, ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers ?? {}) },
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw new Error(`ragflow_${response.status}_${payload.code ?? 'unknown'}`);
  return payload.data;
}

const dataset = await request('/datasets', { method: 'POST', body: JSON.stringify({
  name: `omni-synthetic-v1-${runId}`,
  permission: 'me', embedding_model: target.embeddingModel,
  chunk_method: 'naive', parser_config: { layout_recognize: 'DeepDOC', chunk_token_num: 512, auto_keywords: 0, auto_questions: 0, children_delimiter: '', raptor: { use_raptor: false }, graphrag: { use_graphrag: false } },
}) });
const datasetId = dataset.id;
const form = new FormData();
for (const doc of manifest.documents) {
  const content = await readFile(resolve(syntheticRoot, doc.file));
  form.append('file', new Blob([content], { type: 'text/markdown' }), doc.file);
}
const uploaded = await request(`/datasets/${datasetId}/documents`, { method: 'POST', body: form });
const ids = uploaded.map((item) => item.id);
if (ids.length !== manifest.documents.length) throw new Error(`upload_count_${ids.length}`);
await request(`/datasets/${datasetId}/documents/parse`, { method: 'POST', body: JSON.stringify({ document_ids: ids }) });

const deadline = Date.now() + 20 * 60 * 1000;
let done = false;
while (!done) {
  const listing = await request(`/datasets/${datasetId}/documents?page=1&page_size=100`);
  const docs = listing.docs ?? [];
  done = docs.length === ids.length && docs.every((doc) => Number(doc.progress) === 1 && Number(doc.chunk_count) > 0);
  const failed = docs.filter((doc) => ['2', '3', '4', 'failed', 'cancelled'].includes(String(doc.run)) || Number(doc.progress) < 0);
  if (failed.length) throw new Error(`parse_failed_${failed.length}`);
  if (done) break;
  if (Date.now() > deadline) throw new Error('parse_timeout');
  console.log(JSON.stringify({ phase: 'parsing', complete: docs.filter((doc) => Number(doc.progress) === 1).length, total: ids.length }));
  await new Promise((r) => setTimeout(r, 5000));
}

const questions = [
  ['资料 SYN-DOC-001 的首次响应时限是多少？', ids[0]],
  ['资料 SYN-DOC-015 的标准服务费是多少？', ids[14]],
  ['资料 SYN-DOC-030 适用哪个 VDN？', ids[29]],
];
const retrieval = [];
for (const [question, documentId] of questions) {
  const body = { question, dataset_ids: [datasetId], document_ids: [documentId], page: 1, page_size: 5, similarity_threshold: 0, vector_similarity_weight: 0.5, top_k: 5, rerank_id: target.rerankerModel, keyword: false, highlight: false, use_kg: false, toc_enhance: false, include_knowledge_compilation: false, cross_languages: false, raptor: false, graphrag: false };
  const result = await request('/retrieval', { method: 'POST', body: JSON.stringify(body) });
  retrieval.push({ question, documentId, total: result.total, sources: (result.chunks ?? []).map((chunk) => ({ documentId: chunk.document_id, similarity: chunk.similarity, content: String(chunk.content ?? '').slice(0, 240) })) });
}
const report = { runId, provenance: 'synthetic-only', datasetId, datasetName: `omni-synthetic-v1-${runId}`, documentCount: ids.length, parsed: true, retrieval, cleanup: 'retained-for-test-review', createdAt: new Date().toISOString() };
await writeFile(resolve(outputDir, 'report.json'), JSON.stringify(report, null, 2));
await writeFile(resolve(outputDir, 'document-ids.json'), JSON.stringify({ datasetId, ids }, null, 2));
console.log(JSON.stringify({ runId, datasetId, documents: ids.length, parsed: true, report: resolve(outputDir, 'report.json') }));
