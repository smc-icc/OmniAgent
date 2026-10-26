import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { accessScope } from '../access/access.scope.js';
import { knowledgeConnection } from './knowledge.connection.js';
import { tenantWhere, loadDocuments } from './knowledge.repository.js';
import { originalPath } from './knowledge.service.js';
import { parserProfile, providerId, uncertain, findDataset, findProviderDocument } from './knowledge.provider.js';
import { recoverStagedUpload, cleanupKnowledgeOriginals } from './knowledge.cleanup.js';

const delay = () => new Date(Date.now() + 5000);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function processJob(job: any): Promise<'done' | 'wait'> {
  const p = { accountId: job.account_id, vdnId: job.vdn_id }, tenant = tenantWhere(p);
  const { client, config, credentialRef } = await knowledgeConnection(p.accountId, p.vdnId);
  if (job.operation === 'create_base') {
    const baseId = job.payload.baseId;
    const base = await prisma.knowledge_bases.findFirst({ where: { ...tenant, id: baseId, state: 'active' } });
    if (!base) return 'done';
    const name = `omni_${baseId}`;
    let dataset = await findDataset(client, name);
    if (!dataset && job.external_request_key) {
      if (Date.now() - new Date(job.created_at).getTime() > 5 * 60_000) throw new Error('dataset_write_uncertain');
      return 'wait';
    }
    if (!dataset) {
      // Persist intent before sending a non-idempotent write. A lease recovery
      // reconciles by unique name and never blindly creates a second resource.
      await prisma.knowledge_sync_jobs.update({ where: { id: job.id }, data: { external_request_key: name } });
      dataset = await client.post('/datasets', { name, embedding_model: config.embeddingModel, permission: 'me', chunk_method: 'naive', parser_config: parserProfile });
      if (uncertain(dataset)) return 'wait';
    }
    const datasetId = providerId(dataset?.id);
    const connection = await prisma.knowledge_connections.upsert({ where: { account_id_vdn_id_provider: { ...tenant, provider: 'ragflow' } },
      create: { ...tenant, provider: 'ragflow', base_url: config.baseUrl, credential_ref: credentialRef, external_tenant_id: config.tenantId, contract_version: '183bed69d-python-v1' },
      update: {} });
    if (connection.external_tenant_id !== config.tenantId || connection.credential_ref !== credentialRef || connection.base_url !== config.baseUrl || connection.state !== 'active') throw new Error('connection_mismatch');
    await prisma.knowledge_bindings.upsert({ where: { base_id_generation: { base_id: base.id, generation: base.active_generation } }, update: {},
      create: { base_id: base.id, connection_id: connection.id, external_dataset_id: datasetId, generation: base.active_generation,
        parser_profile: parserProfile, embedding_model: config.embeddingModel, config_hash: hash(JSON.stringify(parserProfile)) } });
    return 'done';
  }
  const doc = (await loadDocuments(p, [job.document_id]))[0];
  if (!doc) throw new Error('job_document_missing');
  const checkBinding = (v: typeof doc.versions[number]) => {
    const b = v.binding, c = b.connection;
    if (b.base_id !== doc.base_id || c.account_id !== p.accountId || c.vdn_id !== p.vdnId || c.external_tenant_id !== config.tenantId || c.credential_ref !== credentialRef || c.base_url !== config.baseUrl || c.state !== 'active') throw new Error('connection_mismatch');
    return providerId(b.external_dataset_id);
  };
  if (job.operation === 'delete') {
    if (doc.state !== 'deleted') throw new Error('delete_not_tombstoned');
    const unfinished = await prisma.knowledge_sync_jobs.count({ where: { ...tenant, document_id: doc.id, operation: 'upload', state: { in: ['queued', 'running', 'staging', 'recovering'] } } });
    if (unfinished) return 'wait';
    for (const v of doc.versions) {
      const datasetId = checkBinding(v);
      // Also reconcile a write which completed just before a process crashed.
      const upload = await prisma.knowledge_sync_jobs.findFirst({ where: { ...tenant, version_id: v.id, operation: 'upload' } });
      const uploadPayload = upload?.payload as { extension?: string } | undefined;
      const remote = v.external_document_id ? await findProviderDocument(client, datasetId, { id: providerId(v.external_document_id) })
        : uploadPayload?.extension ? await findProviderDocument(client, datasetId, { name: `${v.id}${uploadPayload.extension}` }) : undefined;
      if (remote?.id) {
        const result = await client.delete(`/datasets/${datasetId}/documents`, { ids: [providerId(remote.id)] });
        if (uncertain(result)) return 'wait';
        if (await findProviderDocument(client, datasetId, { id: providerId(remote.id) })) return 'wait';
      }
      // Only remove private originals after confirmed remote absence. Missing
      // files are idempotent; other I/O errors keep the durable job retryable.
      if (v.object_key) for (const file of [originalPath(v.object_key), `${originalPath(v.object_key)}.part`]) {
        try { await unlink(file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      await prisma.knowledge_document_versions.update({ where: { id: v.id }, data: { index_state: 'deleted' } });
    }
    return 'done';
  }
  if (job.operation !== 'upload') throw new Error('unsupported_job_operation');
  const v = doc.versions.find(v => v.id === job.version_id && v.binding_id === job.binding_id);
  if (!v?.object_key) throw new Error('job_version_missing');
  const datasetId = checkBinding(v), name = `${v.id}${job.payload.extension}`;
  if (doc.state === 'deleted' && !job.external_request_key) return 'done';
  let remote = await findProviderDocument(client, datasetId, v.external_document_id ? { id: providerId(v.external_document_id) } : { name });
  if (!remote && job.external_request_key) {
    if (Date.now() - new Date(job.created_at).getTime() > 5 * 60_000) throw new Error('upload_write_uncertain');
    return 'wait';
  }
  if (!remote) {
    const bytes = await readFile(originalPath(v.object_key));
    if (createHash('sha256').update(bytes).digest('hex') !== v.content_sha256) throw new Error('original_hash_mismatch');
    await prisma.knowledge_sync_jobs.update({ where: { id: job.id }, data: { external_request_key: name } });
    const result = await client.upload<any>(`/datasets/${datasetId}/documents`, name, bytes, 'application/octet-stream');
    if (uncertain(result)) return 'wait';
    if (!Array.isArray(result) || result.length !== 1) throw new Error('invalid_upload_response');
    remote = result[0];
  }
  const externalId = providerId(remote.id);
  await prisma.knowledge_document_versions.update({ where: { id: v.id }, data: { external_document_id: externalId } });
  if (doc.state === 'deleted') return 'done';
  const run = String(remote.run);
  if (['4', 'FAIL', '2', 'CANCEL'].includes(run)) {
    if (v.index_state !== 'pending' || !job.payload.retryParse) throw new Error('parse_failed');
    await prisma.knowledge_document_versions.update({ where: { id: v.id }, data: { index_state: 'parse_requested' } });
    const result = await client.post<any>(`/datasets/${datasetId}/documents/parse`, { document_ids: [externalId] });
    if (!uncertain(result) && result?.errors?.length) throw new Error('parse_failed');
    return 'wait';
  }
  if (['3', 'DONE'].includes(run)) {
    if (!(Number(remote.chunk_count) > 0)) throw new Error('parse_empty');
    await prisma.$transaction(async tx => {
      await tx.knowledge_document_versions.update({ where: { id: v.id }, data: { index_state: 'ready', chunk_count: Number(remote.chunk_count), error_code: null } });
      await tx.knowledge_documents.updateMany({ where: { ...tenant, id: doc.id, state: 'processing' }, data: { state: 'ready' } });
    });
    return 'done';
  }
  if (!['parsing', 'parse_requested'].includes(v.index_state) && !['1', 'RUNNING', '5', 'SCHEDULE'].includes(run)) {
    await prisma.knowledge_document_versions.update({ where: { id: v.id }, data: { index_state: 'parse_requested' } });
    const result = await client.post<any>(`/datasets/${datasetId}/documents/parse`, { document_ids: [externalId] });
    if (!uncertain(result) && result?.errors?.length) throw new Error('parse_failed');
  }
  if (Date.now() - Number(job.payload.startedAt) > 30 * 60_000) throw new Error('parse_timeout');
  return 'wait';
}

export async function runKnowledgeJob() {
  await recoverStagedUpload();
  const now = new Date();
  const claimable = { state: { in: ['queued', 'running'] }, next_run_at: { lte: now }, OR: [{ locked_until: null }, { locked_until: { lte: now } }] };
  const job = await prisma.knowledge_sync_jobs.findFirst({ where: claimable, orderBy: { next_run_at: 'asc' } });
  if (!job) return;
  job.payload = { ...(job.payload as object), startedAt: Number((job.payload as any)?.startedAt) || Date.now() };
  const lease = new Date(Date.now() + 10 * 60_000);
  const claimed = await prisma.knowledge_sync_jobs.updateMany({ where: { id: job.id, ...claimable }, data: { state: 'running', locked_until: lease, attempts: { increment: 1 }, payload: job.payload } });
  if (!claimed.count) return;
  try {
    const state = await processJob(job);
    await prisma.knowledge_sync_jobs.updateMany({ where: { id: job.id, locked_until: lease }, data: { state: state === 'done' ? 'succeeded' : 'queued', locked_until: null, next_run_at: delay(), last_error: null,
      payload: { ...(job.payload as object), errorAttempts: 0 } } });
  } catch (error) {
    // Only fixed error codes are persisted; upstream exceptions can contain secrets.
    const codes = new Set(['dataset_write_uncertain', 'upload_write_uncertain', 'parse_failed', 'parse_empty', 'parse_timeout', 'original_hash_mismatch', 'connection_mismatch']);
    const code = error instanceof Error && codes.has(error.message) ? error.message : 'provider_unavailable';
    const errorAttempts = Number((job.payload as any)?.errorAttempts ?? 0) + 1;
    const terminal = codes.has(code) || errorAttempts >= 5;
    const changed = await prisma.knowledge_sync_jobs.updateMany({ where: { id: job.id, locked_until: lease }, data: { state: terminal ? 'failed' : 'queued', last_error: code, locked_until: null, next_run_at: new Date(Date.now() + 30_000),
      payload: { ...(job.payload as object), errorAttempts } } });
    if (changed.count && terminal && job.operation === 'upload' && job.version_id && job.document_id) await prisma.knowledge_document_versions.updateMany({ where: { id: job.version_id, index_state: { not: 'deleted' }, document: { ...tenantWhere({ accountId: job.account_id, vdnId: job.vdn_id }), id: job.document_id, state: { not: 'deleted' } } }, data: { index_state: 'failed', error_code: code } });
  }
}
export function startKnowledgeWorker(app: FastifyInstance) {
  if (!process.env.KNOWLEDGE_TENANT_CONFIG_FILE) return;
  let running: Promise<void> | undefined;
  let nextCleanup = 0;
  let cleanupCursor: string | undefined;
  const timer = setInterval(() => {
    if (running) return;
    running = accessScope.exit(async () => {
      await runKnowledgeJob();
      if (Date.now() >= nextCleanup) {
        const result = await cleanupKnowledgeOriginals({ apply: true, cursor: cleanupCursor });
        cleanupCursor = result.nextCursor;
        nextCleanup = Date.now() + (cleanupCursor ? 60_000 : 60 * 60_000);
      }
    }).catch(() => app.log.warn('knowledge worker unavailable')).finally(() => { running = undefined; });
  }, 2000);
  timer.unref();
  app.addHook('preClose', async () => { clearInterval(timer); await running; });
}
