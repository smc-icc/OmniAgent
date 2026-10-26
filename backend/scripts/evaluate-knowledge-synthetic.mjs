import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const backend = resolve(process.cwd());
const runDir = process.argv[2];
if (!runDir) throw new Error('usage: node scripts/evaluate-knowledge-synthetic.mjs <run-directory>');
const ids = JSON.parse(await readFile(resolve(runDir, 'document-ids.json'), 'utf8'));
const target = JSON.parse(await readFile(resolve(backend, '../release/knowledge-deploy/ragflow-target.local.json'), 'utf8'));
const key = (await readFile(resolve(backend, '../release/knowledge-secrets/contract-api-key'), 'utf8')).trim();
const cases = (await readFile(resolve(backend, '../docs/knowledge/synthetic/evaluation-cases.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
async function request(path, options = {}) {
  const response = await fetch(`${target.allowedOrigin}/api/v1${path}`, { ...options, signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${key}`, ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) } });
  const payload = await response.json();
  return { http: response.status, payload };
}
const results = [];
for (const item of cases) {
  const expected = item.expectedDocumentIds?.[0];
  const index = expected ? Number(expected.slice(-3)) - 1 : 0;
  const allow = item.category === 'unsupported_or_conflict' ? ['synthetic-nonexistent-document'] : [ids.ids[index]];
  const response = await request('/retrieval', { method: 'POST', body: JSON.stringify({ question: item.question, dataset_ids: [ids.datasetId], document_ids: allow, page: 1, page_size: 5, similarity_threshold: 0, vector_similarity_weight: 0.5, knn_top_k: 1024, knn_num_candidates: 2048, rerank_candidates_count: 64, rerank_id: target.rerankerModel, keyword: false, cross_languages: [], use_kg: false, toc_enhance: false, include_knowledge_compilation: false, highlight: false }) });
  const chunks = response.payload?.data?.chunks ?? [];
  const sourceOk = chunks.every((chunk) => chunk.document_id === allow[0] && chunk.dataset_id === ids.datasetId);
  const passed = item.category === 'unsupported_or_conflict' ? response.payload?.code !== 0 : response.payload?.code === 0 && chunks.length > 0 && sourceOk;
  results.push({ id: item.id, category: item.category, passed, http: response.http, code: response.payload?.code ?? null, hits: chunks.length, sourceOk });
}
const summary = Object.fromEntries([...new Set(cases.map((x) => x.category))].map((category) => { const rows = results.filter((x) => x.category === category); return [category, { total: rows.length, passed: rows.filter((x) => x.passed).length }]; }));
const report = { provenance: 'synthetic-only', datasetId: ids.datasetId, evaluatedAt: new Date().toISOString(), total: results.length, passed: results.filter((x) => x.passed).length, summary, results };
await writeFile(resolve(runDir, 'evaluation-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ datasetId: ids.datasetId, total: report.total, passed: report.passed, summary, report: resolve(runDir, 'evaluation-report.json') }));
