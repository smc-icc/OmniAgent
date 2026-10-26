import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  SOURCE_COMMIT, RUN_STATE_MAP, PARSER_CONFIG, assertTestTarget,
  inspectEnvelope, inspectRunState, contractRetrievalBody, assertSources, redactEvidence,
  assertTwoPagePositions,
} from '../src/integrations/ragflow/ragflow.contract.js';
import { twoPagePdfFixture } from './ragflow-pdf-fixture.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(backendRoot, '../../RAGFlow');
const docsRoot = resolve(backendRoot, '../docs/knowledge');
const args = process.argv.slice(2);
const flags = new Set(['--source-only', '--live', '--check-release']);
if (args.some(arg => !flags.has(arg)) || args.length > 1) {
  console.error('Usage: tsx scripts/ragflow-contract.ts [--source-only|--live|--check-release]');
  process.exit(2);
}

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const git = (...gitArgs: string[]) => execFileSync('git', ['-C', sourceRoot, ...gitArgs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const endpointSchemas = [
  { method: 'POST', path: '/datasets', file: 'dataset_api.py', request: 'name, embedding_model, permission=me, chunk_method=naive, parser_config', response: 'data.id' },
  { method: 'GET', path: '/datasets/<dataset_id>', file: 'dataset_api.py', response: 'data dataset detail' },
  { method: 'PUT', path: '/datasets/<dataset_id>', file: 'dataset_api.py', request: 'controlled dataset settings', response: 'code/data' },
  { method: 'DELETE', path: '/datasets', file: 'dataset_api.py', request: 'ids: nonempty array; probe-created dataset only', response: 'code/data' },
  { method: 'POST', path: '/datasets/<dataset_id>/documents', file: 'document_api.py', request: 'multipart file', response: 'data: document[]; code=500 may contain successful uploads' },
  { method: 'GET', path: '/datasets/<dataset_id>/documents', file: 'document_api.py', response: 'data: {total, docs: [{id, run, progress, chunk_count, progress_msg}]}' },
  { method: 'POST', path: '/datasets/<dataset_id>/documents/parse', file: 'document_api.py', request: 'document_ids: nonempty array', response: 'data: {success_count, errors?}' },
  { method: 'POST', path: '/datasets/<dataset_id>/documents/stop', file: 'document_api.py', request: 'document_ids: nonempty array', response: 'data: {success_count, errors?}; completion race must be checked' },
  { method: 'DELETE', path: '/datasets/<dataset_id>/documents', file: 'document_api.py', request: 'ids: nonempty array; never delete_all', response: 'data: {deleted}' },
  { method: 'GET', path: '/datasets/<dataset_id>/documents/<document_id>/chunks', file: 'chunk_api.py', response: 'data: {total, chunks, doc}; positions are numeric arrays' },
  { method: 'POST', path: '/retrieval', file: 'chunk_api.py', request: 'dataset_ids + nonempty document_ids + explicit disabled enhancements', response: 'data: {total, chunks: [{id, content, document_id, dataset_id, positions, similarity}], doc_aggs}' },
];

async function sourceEvidence() {
  const files = [...new Set([
    ...endpointSchemas.map(e => `api/apps/restful_apis/${e.file}`),
    'api/apps/__init__.py', 'common/constants.py', 'rag/nlp/__init__.py',
    'rag/nlp/search.py', 'api/utils/validation_utils.py', 'pyproject.toml',
    'Dockerfile', 'docker/entrypoint.sh',
  ])];
  const texts = new Map(await Promise.all(files.map(async file => [file, await readFile(resolve(sourceRoot, file), 'utf8')] as const)));
  for (const endpoint of endpointSchemas) {
    const source = texts.get(`api/apps/restful_apis/${endpoint.file}`)!;
    if (!source.includes(`@manager.route("${endpoint.path}", methods=["${endpoint.method}"])`)) {
      throw new Error('source_endpoint_drift');
    }
  }
  const sourceCommit = git('rev-parse', 'HEAD');
  const status = git('status', '--porcelain');
  if (sourceCommit !== SOURCE_COMMIT || status) throw new Error('source_baseline_mismatch');
  return {
    sourceCommit, sourceDescription: git('describe', '--always', '--tags'), sourceDirty: false,
    sourceCheckedAt: new Date().toISOString(),
    sourceFiles: files.map(path => ({ path, sha256: hash(texts.get(path)!) })),
    apiScheme: 'python', apiPrefix: '/api/v1', contractVersion: '183bed69d-python-v1',
    imageDigest: null, imageSourceMatches: null, pythonRequirement: '>=3.13,<3.14',
    endpointSchemas, runStateMap: RUN_STATE_MAP,
    positionConvention: { source: 'rag/nlp/__init__.py:add_positions', pdfPageBase: 1, tuple: ['page', 'left', 'right', 'top', 'bottom'], runtimeVerified: false },
    parserConfig: PARSER_CONFIG, parserConfigHash: hash(JSON.stringify(PARSER_CONFIG)),
    modelIds: { embedding: null, reranker: null, chat: null },
    disabledEnhancements: ['use_kg', 'toc_enhance', 'include_knowledge_compilation', 'keyword', 'cross_languages', 'raptor', 'graphrag', 'children_delimiter'],
    upstreamRisks: ['empty document_ids removes document filtering', 'knowledge compilation defaults to enabled', 'retrieval_by_children runs even without request enhancement flags', 'HTTP 200 is not business success'],
    verifiedAt: null,
    status: 'source_verified_runtime_pending',
    pending: ['fixed-image-runtime-attestation', 'live-api-cycle', 'partial-upload', 'cancellation-race', 'two-page-pdf', '30-approved-documents', '100-human-labelled-questions', 'model-revisions'],
  };
}

// Live probes only use disposable synthetic documents. Business evaluation is a separate gate.
async function liveProbe() {
  const configPath = process.env.RAGFLOW_CONTRACT_TARGET_FILE;
  if (!configPath) throw new Error('missing_test_target_file');
  const target = assertTestTarget(JSON.parse(await readFile(configPath, 'utf8')));
  const key = (await readFile(resolve(dirname(configPath), target.credentialFile), 'utf8')).trim();
  if (!key || /[\r\n]/.test(key)) throw new Error('invalid_credential_file');
  const runId = randomUUID();
  const outputDir = resolve(docsRoot, `runs/${runId}`);
  await mkdir(outputDir, { recursive: true });
  let datasetId: string | undefined;
  const createdIds: string[] = [];
  const checks: string[] = [];
  let sequence = 0;
  let outcome = 'failed';
  let cleanup = 'not_created';
  // This private recovery file contains IDs only; it is not a response fixture or a credential store.
  const recoveryPath = resolve(outputDir, 'recovery.json');
  const datasetName = `${target.datasetPrefix}${runId}`;
  await writeFile(recoveryPath, JSON.stringify({ datasetName, datasetId: null, documentIds: [], state: 'creation_not_started' }, null, 2));
  const saveRecovery = (state: string) => writeFile(recoveryPath,
    JSON.stringify({ datasetName, datasetId, documentIds: createdIds, state }, null, 2));
  async function request(label: string, method: string, path: string, body?: object | FormData) {
    let response: Response;
    try {
      response = await fetch(`${target.allowedOrigin}/api/v1${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${key}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error(method === 'GET' ? 'upstream_read_failed' : 'upstream_write_uncertain'); }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error('invalid_response_json'); }
    await writeFile(resolve(outputDir, `${String(++sequence).padStart(3, '0')}-${label}.json`), JSON.stringify({
      provenance: 'live-redacted', observedAt: new Date().toISOString(), httpStatus: response.status,
      payload: redactEvidence(payload),
    }, null, 2));
    return inspectEnvelope(response.status, payload);
  }
  const requireSuccess = (result: ReturnType<typeof inspectEnvelope>) => {
    if (result.state !== 'success') throw new Error('upstream_business_failure');
    return result.data;
  };
  const idSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) }).passthrough();
  const docsSchema = z.object({ total: z.number(), docs: z.array(idSchema.extend({ run: z.union([z.string(), z.number()]), progress: z.number(), chunk_count: z.number() })) });
  const actionSchema = z.object({ success_count: z.literal(1), errors: z.array(z.unknown()).max(0).optional() });
  try {
    await saveRecovery('creation_pending');
    const created = idSchema.parse(requireSuccess(await request('create', 'POST', '/datasets', {
      name: datasetName, permission: 'me', embedding_model: target.embeddingModel,
      chunk_method: 'naive', parser_config: PARSER_CONFIG,
    })));
    datasetId = created.id;
    await saveRecovery('dataset_created');
    const datasetPath = `/datasets/${datasetId}`;
    const markers = [`OMNI_ALPHA_${runId}`, `OMNI_BETA_${runId}`];
    async function upload(form: FormData) {
      const result = await request('upload', 'POST', `${datasetPath}/documents`, form);
      // Preserve successful IDs even on a partial-success envelope. Never repeat POST on failure.
      createdIds.push(...result.successfulIds);
      await saveRecovery('upload_observed');
      const uploaded = z.array(idSchema).length(1).parse(requireSuccess(result));
      return uploaded[0]!.id;
    }
    async function parseAndPreview(documentId: string, label: string) {
      actionSchema.parse(requireSuccess(await request('parse', 'POST', `${datasetPath}/documents/parse`, { document_ids: [documentId] })));
      const deadline = Date.now() + 30 * 60 * 1000;
      while (true) {
        const listed = docsSchema.parse(requireSuccess(await request('status', 'GET', `${datasetPath}/documents?id=${encodeURIComponent(documentId)}`)));
        const doc = listed.docs.find(item => item.id === documentId);
        if (!doc) throw new Error('document_missing');
        const state = inspectRunState(doc.run);
        if (state === 'failed' || state === 'cancelled') throw new Error('parsing_failed');
        if (state === 'done') {
          if (doc.progress !== 1 || doc.chunk_count < 1) throw new Error('empty_or_incomplete_document');
          break;
        }
        if (Date.now() >= deadline) throw new Error('parsing_deadline');
        console.log(JSON.stringify({ phase: 'parsing', document: label, state }));
        await delay(5000);
      }
      const preview = z.object({ total: z.number().positive(), chunks: z.array(z.unknown()).min(1) }).parse(
        requireSuccess(await request('chunks', 'GET', `${datasetPath}/documents/${documentId}/chunks?available=true&page_size=100`)));
      assertSources(preview.chunks, created.id, [documentId]);
      return preview;
    }
    for (let index = 0; index < markers.length; index++) {
      const form = new FormData();
      form.set('file', new Blob([`# Contract fixture ${index}\n\nThe verification code is ${markers[index]}.\n`], { type: 'text/markdown' }), `omni-contract-${runId}-${index}.md`);
      await parseAndPreview(await upload(form), `markdown-${index + 1}`);
    }
    checks.push('create', 'single-file-upload', 'parse-terminal-state', 'available-chunks');
    const retrievalSchema = z.object({ total: z.number(), chunks: z.array(z.unknown()) });
    const allowedBody = contractRetrievalBody(datasetId, [createdIds[0]!], markers[0]!);
    const allowed = retrievalSchema.parse(requireSuccess(await request('allowlist', 'POST', '/retrieval', allowedBody)));
    assertSources(allowed.chunks, datasetId, [createdIds[0]!]);
    if (!allowed.chunks.length) throw new Error('allowlist_no_hits');
    checks.push('nonempty-allowlist-source-check');
    if (target.rerankerModel) {
      const reranked = retrievalSchema.parse(requireSuccess(await request('reranked-allowlist', 'POST', '/retrieval', {
        ...allowedBody, rerank_id: target.rerankerModel, similarity_threshold: 0,
      })));
      assertSources(reranked.chunks, datasetId, [createdIds[0]!]);
      if (!reranked.chunks.length) throw new Error('allowlist_no_hits');
      checks.push('reranked-allowlist-source-check');
    }
    // Deliberate unsafe upstream behavior probe is confined to this newly created dataset.
    const empty = retrievalSchema.parse(requireSuccess(await request('empty-allowlist-probe', 'POST', '/retrieval', {
      ...allowedBody, document_ids: [], question: markers[1],
    })));
    assertSources(empty.chunks, datasetId, createdIds);
    if (!empty.chunks.some(chunk => (chunk as { document_id: string }).document_id === createdIds[1])) throw new Error('empty_allowlist_contract_changed');
    checks.push('upstream-empty-allowlist-expands');
    const invalid = await request('error-code', 'POST', '/retrieval', { ...allowedBody, document_ids: [randomUUID().replaceAll('-', '')] });
    if (invalid.state !== 'failed' || invalid.code === 0) throw new Error('invalid_document_not_rejected');
    checks.push('unknown-document-business-error');
    const partialForm = new FormData();
    partialForm.append('file', new Blob(['# Cancellation fixture\n\nOnly synthetic test content.\n']), `omni-contract-${runId}-cancel.md`);
    partialForm.append('file', new Blob(['Unsupported synthetic format']), `omni-contract-${runId}.omniunsupported`);
    const partial = await request('partial-upload', 'POST', `${datasetPath}/documents`, partialForm);
    createdIds.push(...partial.successfulIds);
    await saveRecovery('partial_upload_observed');
    if (partial.state !== 'partial' || partial.successfulIds.length !== 1) throw new Error('partial_upload_contract_mismatch');
    const cancelId = idSchema.parse(z.array(idSchema).length(1).parse(partial.data)[0]).id;
    checks.push('partial-upload-preserves-success');
    actionSchema.parse(requireSuccess(await request('parse-cancellation', 'POST', `${datasetPath}/documents/parse`, { document_ids: [cancelId] })));
    const stop = z.object({ success_count: z.number().int().min(0).max(1), errors: z.array(z.unknown()).optional() }).parse(
      requireSuccess(await request('stop-cancellation', 'POST', `${datasetPath}/documents/stop`, { document_ids: [cancelId] })));
    if ((stop.success_count === 1 && stop.errors?.length) || (stop.success_count === 0 && !stop.errors?.length)) {
      throw new Error('cancellation_contract_mismatch');
    }
    // Observe the winner repeatedly; one request cannot prove all possible race schedules.
    for (let attempt = 0; attempt < 3; attempt++) {
      await delay(5000);
      const listed = docsSchema.parse(requireSuccess(await request('after-stop', 'GET', `${datasetPath}/documents?id=${cancelId}`)));
      const doc = listed.docs.find(item => item.id === cancelId);
      if (!doc || inspectRunState(doc.run) !== (stop.success_count === 1 ? 'cancelled' : 'done')) {
        throw new Error('cancellation_contract_mismatch');
      }
    }
    checks.push(stop.success_count === 1 ? 'cancellation-observed' : 'completion-won-stop-race');
    if (stop.success_count === 1) {
      const cancelledChunks = z.object({ total: z.literal(0), chunks: z.array(z.unknown()).length(0) });
      cancelledChunks.parse(requireSuccess(await request('cancelled-chunks', 'GET', `${datasetPath}/documents/${cancelId}/chunks?available=true`)));
      checks.push('cancelled-document-has-no-available-chunks');
    }
    const pdfForm = new FormData();
    pdfForm.set('file', new Blob([new Uint8Array(twoPagePdfFixture())], { type: 'application/pdf' }), `omni-contract-${runId}-two-pages.pdf`);
    const pdf = await parseAndPreview(await upload(pdfForm), 'two-page-pdf');
    // Diagnostics only for our generated PDF: preserve marker presence, never arbitrary text.
    await writeFile(resolve(outputDir, 'pdf-marker-observation.json'), JSON.stringify(pdf.chunks.map(chunk => {
      const c = chunk as { content?: string; positions?: unknown };
      const content = c.content ?? '';
      const normalized = content.replace(/[\s_]+/g, '');
      return { pageOneExact: content.includes('OMNI_PAGE_ONE'), pageTwoExact: content.includes('OMNI_PAGE_TWO'),
        pageOneNormalized: normalized.includes('OMNIPAGEONE'), pageTwoNormalized: normalized.includes('OMNIPAGETWO'), positions: c.positions };
    }), null, 2));
    assertTwoPagePositions(pdf.chunks);
    checks.push('two-page-pdf-one-based-positions');
    const deleted = z.object({ deleted: z.literal(1) }).parse(requireSuccess(await request('delete-document', 'DELETE', `${datasetPath}/documents`, { ids: [createdIds[0]] })));
    void deleted;
    // This fixed API rejects a missing explicit ID with code 102, rather than an empty list.
    const deletedLookup = await request('after-delete-id', 'GET', `${datasetPath}/documents?id=${createdIds[0]}`);
    if (deletedLookup.state !== 'failed' || deletedLookup.code !== 102) throw new Error('document_delete_not_visible');
    const after = docsSchema.parse(requireSuccess(await request('after-delete-list', 'GET', `${datasetPath}/documents?page=1&page_size=100`)));
    if (after.total !== createdIds.length - 1 || after.docs.length !== after.total
        || after.docs.some(doc => doc.id === createdIds[0])) throw new Error('document_delete_not_visible');
    const afterRetrieval = retrievalSchema.parse(requireSuccess(await request('after-delete-retrieval', 'POST', '/retrieval', {
      ...allowedBody, document_ids: [],
    })));
    // Dataset-wide probe is confined to this run's disposable dataset. It must
    // not surface the deleted document or a successfully cancelled document.
    assertSources(afterRetrieval.chunks, datasetId, createdIds.filter(id =>
      id !== createdIds[0] && (stop.success_count === 0 || id !== cancelId)));
    checks.push('document-delete', 'deleted-document-absent-from-retrieval');
    outcome = 'core_probe_passed';
  } finally {
    if (datasetId) {
      try {
        requireSuccess(await request('cleanup-dataset', 'DELETE', '/datasets', { ids: [datasetId] }));
        cleanup = 'deleted';
      } catch { cleanup = 'needs_reconciliation'; outcome = 'failed'; }
    }
    await saveRecovery(cleanup);
    await writeFile(resolve(outputDir, 'report.json'), JSON.stringify({
      runId, observedAt: new Date().toISOString(), outcome, cleanup, checks,
      sourceCommit: target.sourceCommit, operatorDeclaredImageDigest: target.imageDigest,
      embeddingModel: target.embeddingModel,
      rerankerModel: target.rerankerModel ?? null,
      pending: ['runtime-image-attestation', 'cancellation-race-stress', 'business-evaluation',
        ...(!checks.includes('partial-upload-preserves-success') ? ['partial-upload'] : []),
        ...(!checks.includes('two-page-pdf-one-based-positions') ? ['two-page-pdf'] : [])],
      verifiedAt: null,
    }, null, 2));
    console.log(JSON.stringify({ runId, outcome, cleanup, passedChecks: checks.length }));
    if (cleanup === 'needs_reconciliation') throw new Error('cleanup_needs_reconciliation');
  }
}

try {
  if (args.includes('--check-release')) {
    const contract = JSON.parse(await readFile(resolve(docsRoot, 'ragflow-contract.json'), 'utf8'));
    if (contract.sourceCommit !== SOURCE_COMMIT || contract.status !== 'verified' || !contract.verifiedAt || contract.pending?.length) {
      throw new Error('t01_runtime_and_evaluation_not_verified');
    }
    console.log('T01 contract gate passed');
  } else {
    const evidence = await sourceEvidence();
    await mkdir(docsRoot, { recursive: true });
    // Source refresh never overwrites a reviewed contract or previous live evidence.
    await writeFile(resolve(docsRoot, 'ragflow-source-observation.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ status: evidence.status, sourceCommit: evidence.sourceCommit, endpoints: endpointSchemas.length }));
    if (args.includes('--live')) await liveProbe();
  }
} catch (error) {
  // Never print arbitrary upstream messages, payloads, config, credential paths or fetch errors.
  const safeErrors = new Set(['missing_test_target_file', 'invalid_credential_file', 'source_baseline_mismatch', 'source_endpoint_drift', 't01_runtime_and_evaluation_not_verified', 'upstream_read_failed', 'upstream_write_uncertain', 'invalid_response_json', 'invalid_envelope', 'upstream_business_failure', 'parsing_failed', 'parsing_deadline', 'document_missing', 'empty_or_incomplete_document', 'unauthorized_retrieval_source', 'allowlist_no_hits', 'empty_allowlist_contract_changed', 'invalid_document_not_rejected', 'document_delete_not_visible', 'cleanup_needs_reconciliation']);
  ['partial_upload_contract_mismatch', 'cancellation_contract_mismatch', 'pdf_position_contract_mismatch'].forEach(code => safeErrors.add(code));
  console.error(JSON.stringify({ status: 'blocked_or_failed', code: error instanceof Error && safeErrors.has(error.message) ? error.message : 'contract_validation_failed' }));
  process.exitCode = 1;
}
