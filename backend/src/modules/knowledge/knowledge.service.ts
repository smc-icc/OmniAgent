import type { FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../plugins/db.js';
import { AppError } from '../../shared/errors/index.js';
import { canCreateKnowledge, canManageKnowledgeLibrary, canReadKnowledge, canManageKnowledge, canApproveKnowledge,
  canChangeKnowledgeAudience, canDownloadKnowledge, isDocumentUsable, knowledgeSubject } from '../access/knowledge.authorization.js';
import type { KnowledgePrincipal, KnowledgeConversationPolicy } from '../access/knowledge.authorization.js';
import { knowledgePrincipal, libraryPolicy, documentPolicy, conversationKnowledgeOwnership, conversationKnowledgePrincipal } from './knowledge.runtime-policy.js';
import { knowledgeConnection } from './knowledge.connection.js';
import { loadDocuments, tenantWhere, audit, knowledgeTransaction } from './knowledge.repository.js';
import { normalizeRetrieval, type AuthorizedSource, type KnowledgeHit } from '../../integrations/ragflow/ragflow.normalize.js';
import { buildRetrievalBody } from '../../integrations/ragflow/ragflow.request.js';
import { groundedAnswer } from './knowledge.answer.js';
import { uncertain } from './knowledge.provider.js';
import { writeOriginal, originalPath } from './knowledge.storage.js';
export { originalsRoot, originalPath } from './knowledge.storage.js';

const missing = () => new AppError(404, '知识库或文档不存在');
export async function knowledgeList(req: FastifyRequest) {
  const p = await knowledgePrincipal(req);
  const bases = await prisma.knowledge_bases.findMany({ where: tenantWhere(p), include: { acl: true, bindings: { where: { state: 'active' } } }, orderBy: { created_at: 'asc' } });
  const visible = bases.filter(b => canManageKnowledgeLibrary(libraryPolicy(b), p, 'knowledge.read'));
  const docs = await loadDocuments(p);
  const baseJobs = await prisma.knowledge_sync_jobs.findMany({ where: { ...tenantWhere(p), operation: 'create_base' } });
  return { accountId: p.accountId, vdnId: p.vdnId,
    bases: bases.filter(b => visible.some(v => v.id === b.id) || docs.some(d => d.base_id === b.id && canReadKnowledge(documentPolicy(d), p)))
      .map(b => ({ id: b.id, name: b.name, ready: b.bindings.some(v => v.generation === b.active_generation),
        error: baseJobs.find(j => (j.payload as any)?.baseId === b.id)?.last_error,
        canRetry: canManageKnowledgeLibrary(libraryPolicy(b), p, 'knowledge.reindex') && baseJobs.some(j => (j.payload as any)?.baseId === b.id && j.state === 'failed'),
        readAccess: b.acl.some(a => a.capability === 'read' && a.subject_type === 'account') ? 'account' : 'owner',
        canUpload: canCreateKnowledge(libraryPolicy(b), p), canGrant: canManageKnowledgeLibrary(libraryPolicy(b), p, 'knowledge.grant') })),
    documents: docs.filter(d => canReadKnowledge(documentPolicy(d), p) || canManageKnowledge(documentPolicy(d), p, 'update'))
      .map(d => ({ id: d.id, baseId: d.base_id, title: d.title, state: d.state, audience: d.audience,
        indexState: d.versions[0]?.index_state, error: d.versions[0]?.error_code, chunks: d.versions[0]?.chunk_count ?? 0,
        canPublish: canApproveKnowledge(documentPolicy(d), p), canWithdraw: d.state === 'published' && canManageKnowledge(documentPolicy(d), p, 'publish'),
        canDelete: canManageKnowledge(documentPolicy(d), p, 'delete'), canDownload: canDownloadKnowledge(documentPolicy(d), p),
        canRetry: d.versions[0]?.index_state === 'failed' && canManageKnowledge(documentPolicy(d), p, 'reindex'),
        canApproveCustomer: canChangeKnowledgeAudience(documentPolicy(d), p), updatedAt: d.updated_at })) };
}
export async function retryKnowledge(req: FastifyRequest, id: string, kind: 'base' | 'document') {
  const p = await knowledgePrincipal(req);
  return knowledgeTransaction(p, async tx => {
    let dedupe: string;
    if (kind === 'base') {
      const b = await tx.knowledge_bases.findFirst({ where: { ...tenantWhere(p), id }, include: { acl: true } });
      if (!b) throw missing();
      if (!canManageKnowledgeLibrary(libraryPolicy(b), p, 'knowledge.reindex')) throw new AppError(403, '无权重试此知识库');
      dedupe = `base:${id}`;
    } else {
      const d = await tx.knowledge_documents.findFirst({ where: { ...tenantWhere(p), id, base: tenantWhere(p) }, include: { base: { include: { acl: true } }, acl: true, versions: { orderBy: { version_no: 'desc' } } } });
      if (!d) throw missing();
      if (!canManageKnowledge(documentPolicy(d), p, 'reindex')) throw new AppError(403, '无权重试此文档');
      dedupe = `upload:${d.versions[0]?.id}`;
    }
    const j = await tx.knowledge_sync_jobs.findFirst({ where: { ...tenantWhere(p), dedupe_key: dedupe, state: 'failed' } });
    if (!j) throw new AppError(409, '没有可重试的失败任务');
    const changed = await tx.knowledge_sync_jobs.updateMany({ where: { id: j.id, state: 'failed', updated_at: j.updated_at }, data: { state: 'queued', next_run_at: new Date(), last_error: null, attempts: 0,
      payload: { ...(j.payload as object), errorAttempts: 0, startedAt: Date.now(), retryParse: kind === 'document' } } });
    if (!changed.count) throw new AppError(409, '任务已变更，请刷新');
    // Keep the original write intent: a retry reconciles the same remote resource.
    if (j.version_id) await tx.knowledge_document_versions.update({ where: { id: j.version_id }, data: { index_state: 'pending', error_code: null } });
    await audit(tx, p, `${kind}.retry`, id, req.id);
    return { ok: true };
  });
}
export async function setKnowledgeAccess(req: FastifyRequest, id: string, readAccess: 'account' | 'owner') {
  const p = await knowledgePrincipal(req);
  return knowledgeTransaction(p, async tx => {
    const base = await tx.knowledge_bases.findFirst({ where: { ...tenantWhere(p), id }, include: { acl: true } });
    if (!base) throw missing();
    if (!canManageKnowledgeLibrary(libraryPolicy(base), p, 'knowledge.grant')) throw new AppError(403, '无权调整知识库授权');
    await tx.knowledge_acl_entries.deleteMany({ where: { ...tenantWhere(p), base_id: id, document_id: null, capability: 'read' } });
    const kind = readAccess === 'account' ? 'account' : 'operator';
    await tx.knowledge_acl_entries.create({ data: { ...tenantWhere(p), base_id: id, capability: 'read', subject_type: kind,
      subject_id: knowledgeSubject(kind, p.vdnId, String(readAccess === 'account' ? p.accountId : base.owner_user_id)) } });
    await tx.knowledge_bases.updateMany({ where: { ...tenantWhere(p), id }, data: { acl_revision: { increment: 1 } } });
    await audit(tx, p, 'base.grant', id, req.id);
    return { ok: true };
  });
}
export async function createKnowledgeBase(req: FastifyRequest, name: string) {
  const p = await knowledgePrincipal(req), id = randomUUID();
  const subject = knowledgeSubject('account', p.vdnId, String(p.accountId));
  const organization = { agent_group_ids: p.agentGroupIds.map(x => Number(x.split(':')[2])),
    department_id: p.departmentIds.length ? Math.min(...p.departmentIds.map(x => Number(x.split(':')[2]))) : null };
  const policy = libraryPolicy({ ...tenantWhere(p), ...organization, id, state: 'active', owner_user_id: p.userId, acl: [
    { ...tenantWhere(p), subject_type: 'account', subject_id: subject, capability: 'manage' }] });
  if (!canCreateKnowledge(policy, p)) throw new AppError(403, '没有创建知识库的权限');
  await knowledgeConnection(p.accountId, p.vdnId);
  return knowledgeTransaction(p, async tx => {
    const base = await tx.knowledge_bases.create({ data: { ...tenantWhere(p), ...organization, id, name, owner_user_id: p.userId } });
    for (const capability of ['read', 'manage']) await tx.knowledge_acl_entries.create({ data: { ...tenantWhere(p), base_id: id, subject_type: 'account', subject_id: subject, capability } });
    await tx.knowledge_sync_jobs.create({ data: { ...tenantWhere(p), operation: 'create_base', dedupe_key: `base:${id}`, actor_user_id: p.userId, payload: { baseId: id } } });
    await audit(tx, p, 'base.create', id, req.id);
    return { id: base.id, name: base.name, state: 'provisioning' };
  });
}
export async function uploadKnowledge(req: FastifyRequest, baseId: string, filename: string, bytes: Buffer) {
  const p = await knowledgePrincipal(req);
  const base = await prisma.knowledge_bases.findFirst({ where: { ...tenantWhere(p), id: baseId }, include: { acl: true, bindings: { where: { state: 'active' }, include: { connection: true } } } });
  if (!base) throw missing();
  if (!canCreateKnowledge(libraryPolicy(base), p)) throw new AppError(403, '无权上传到此知识库');
  const binding = base.bindings.find(b => b.generation === base.active_generation && b.connection.account_id === p.accountId && b.connection.vdn_id === p.vdnId && b.connection.state === 'active');
  if (!binding) throw new AppError(409, '知识库尚未完成开通，请刷新后重试');
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new AppError(422, '文件须为 1 字节至 20 MB');
  if (!/\.(txt|md|pdf|docx|csv|xlsx)$/i.test(filename)) throw new AppError(422, '支持 txt、md、pdf、docx、csv、xlsx');
  const docId = randomUUID(), versionId = randomUUID(), key = `${p.accountId}/${p.vdnId}/${versionId}`;
  // Reserve the immutable object key before writing bytes. A failed transaction
  // can no longer leave an untracked original; staging survives process crashes.
  const result = await knowledgeTransaction(p, async tx => {
    await tx.knowledge_documents.create({ data: { ...tenantWhere(p), id: docId, base_id: baseId, source_type: 'upload', source_id: docId,
      title: path.basename(filename).slice(0, 200), category: '', owner_user_id: p.userId, state: 'processing' } });
    await tx.knowledge_document_versions.create({ data: { id: versionId, document_id: docId, version_no: 1, binding_id: binding.id,
      content_sha256: createHash('sha256').update(bytes).digest('hex'), object_key: key, parser_config_hash: binding.config_hash, created_by: p.userId } });
    await tx.knowledge_sync_jobs.create({ data: { ...tenantWhere(p), operation: 'upload', document_id: docId, version_id: versionId, binding_id: binding.id,
      dedupe_key: `upload:${versionId}`, actor_user_id: p.userId, state: 'staging', locked_until: new Date(Date.now() + 10 * 60_000),
      payload: { extension: path.extname(filename).toLowerCase() } } });
    await audit(tx, p, 'document.upload', docId, req.id);
    return { id: docId, state: 'processing' };
  });
  try {
    await writeOriginal(key, bytes);
    const queued = await prisma.knowledge_sync_jobs.updateMany({ where: { ...tenantWhere(p), version_id: versionId, state: 'staging' },
      data: { state: 'queued', locked_until: null } });
    if (!queued.count) throw new Error('staging_claim_lost');
  } catch {
    // Leave the reservation for hash-checked recovery. Never delete a possibly
    // committed original on an uncertain database response.
    throw new AppError(503, '上传未确认完成，后台将自动核验，请勿重复上传');
  }
  return result;
}
export async function changeKnowledge(req: FastifyRequest, id: string, action: 'publish' | 'withdraw' | 'delete', customerApproved = false) {
  const p = await knowledgePrincipal(req);
  return knowledgeTransaction(p, async tx => {
    const d = await tx.knowledge_documents.findFirst({ where: { ...tenantWhere(p), id, base: tenantWhere(p) }, include: { base: { include: { acl: true } }, acl: true, versions: { orderBy: { version_no: 'desc' } } } });
    if (!d) throw missing();
    const policy = documentPolicy(d), version = d.versions[0];
    if (!canManageKnowledge(policy, p, action === 'withdraw' ? 'publish' : action)) throw new AppError(403, '无权操作此文档');
    if (action === 'publish' && (!canApproveKnowledge(policy, p) || (customerApproved && !canChangeKnowledgeAudience(policy, p)))) throw new AppError(409, '文档须索引完成，并由非作者的授权审核人发布');
    const updated = await tx.knowledge_documents.updateMany({ where: { ...tenantWhere(p), id, state: d.state, updated_at: d.updated_at }, data: {
      state: action === 'publish' ? 'published' : action === 'delete' ? 'deleted' : 'withdrawn',
      active_version_id: action === 'publish' ? version!.id : null,
      ...(action === 'publish' ? { audience: customerApproved ? 'customer_approved' : 'internal' } : {}),
      ...(action === 'delete' ? { deleted_at: new Date() } : {}) } });
    if (!updated.count) throw new AppError(409, '文档已变更，请刷新');
    if (action === 'publish') await tx.knowledge_document_versions.update({ where: { id: version!.id }, data: { review_state: 'approved', reviewed_by: p.userId, reviewed_at: new Date() } });
    if (action === 'delete') await tx.knowledge_sync_jobs.create({ data: { ...tenantWhere(p), operation: 'delete', document_id: id, dedupe_key: `delete:${id}`, actor_user_id: p.userId } });
    await tx.knowledge_bases.updateMany({ where: { ...tenantWhere(p), id: d.base_id }, data: { acl_revision: { increment: 1 } } });
    await audit(tx, p, `document.${action}`, id, req.id);
    return { ok: true };
  });
}
export async function knowledgeDownload(req: FastifyRequest, id: string) {
  const p = await knowledgePrincipal(req), d = (await loadDocuments(p, [id]))[0];
  if (!d) throw missing();
  const version = d.versions.find(v => v.id === d.active_version_id);
  if (!version?.object_key || !canDownloadKnowledge(documentPolicy(d, version), p)) throw new AppError(403, '无权下载此文档');
  const bytes = await readFile(originalPath(version.object_key));
  const fresh = await knowledgePrincipal(req), latest = (await loadDocuments(fresh, [id]))[0];
  if (!latest || !canDownloadKnowledge(documentPolicy(latest, latest.versions.find(v => v.id === version.id)), fresh)) throw new AppError(403, '文档权限已变更');
  await audit(prisma, fresh, 'document.download', id, req.id);
  return { bytes, filename: d.title };
}
async function conversationPolicy(p: KnowledgePrincipal, conversationId?: number): Promise<KnowledgeConversationPolicy | undefined> {
  if (!conversationId) return undefined;
  const c = await prisma.conversations.findFirst({ where: { id: conversationId, account_id: p.accountId }, select: { id: true, assignee_id: true } });
  if (!c) throw new AppError(403, '会话不在当前授权范围');
  return { accountId: p.accountId, vdnId: p.vdnId, conversationId: String(c.id),
    ownership: await conversationKnowledgeOwnership(p.accountId, p.vdnId, c.assignee_id) };
}
export async function askKnowledge(req: FastifyRequest, question: string, conversationId?: number) {
  return retrieveKnowledge(() => knowledgePrincipal(req), req.id, question, conversationId);
}
export async function askConversationKnowledge(accountId: number, conversationId: number, assigneeId: number, question: string) {
  return retrieveKnowledge(() => conversationKnowledgePrincipal(accountId, conversationId, assigneeId),
    `auto:${conversationId}`, question, conversationId);
}
export async function revalidateConversationKnowledge(accountId: number, conversationId: number, assigneeId: number,
  sources: readonly { documentId: string; versionId: string }[]) {
  const p = await conversationKnowledgePrincipal(accountId, conversationId, assigneeId);
  const docs = await loadDocuments(p, [...new Set(sources.map(s => s.documentId))]);
  const conversation = await conversationPolicy(p, conversationId);
  const { config, credentialRef } = await knowledgeConnection(p.accountId, p.vdnId);
  if (!sources.length || sources.some(s => {
    const d = docs.find(d => d.id === s.documentId), v = d?.versions.find(v => v.id === s.versionId);
    const b = v?.binding, c = b?.connection;
    return !d || !v || !b || !c || b.base_id !== d.base_id || b.state !== 'active' || b.generation !== d.base.active_generation
      || c.state !== 'active' || c.account_id !== p.accountId || c.vdn_id !== p.vdnId
      || c.external_tenant_id !== config.tenantId || c.credential_ref !== credentialRef || c.base_url !== config.baseUrl
      || !isDocumentUsable(documentPolicy(d, v), p, 'reply_suggestion', new Date(), conversation);
  })) throw new AppError(403, '自动回复资料或授权已变更');
  return p;
}
async function retrieveKnowledge(resolvePrincipal: () => Promise<KnowledgePrincipal>, requestId: string, question: string, conversationId?: number) {
  const p = await resolvePrincipal(), docs = await loadDocuments(p);
  const use = conversationId ? 'reply_suggestion' : 'staff_qa', conversation = await conversationPolicy(p, conversationId);
  const authorized: AuthorizedSource[] = [];
  for (const d of docs) {
    const v = d.versions.find(v => v.id === d.active_version_id);
    if (!v || !isDocumentUsable(documentPolicy(d, v), p, use, new Date(), conversation)) continue;
    const b = v.binding, c = b.connection;
    if (b.state !== 'active' || b.base_id !== d.base_id || b.generation !== d.base.active_generation || c.state !== 'active' || c.account_id !== p.accountId || c.vdn_id !== p.vdnId || !v.external_document_id) continue;
    authorized.push({ documentId: d.id, versionId: v.id, bindingId: b.id, datasetId: b.external_dataset_id,
      externalDocumentId: v.external_document_id, revision: d.base.acl_revision, audience: d.audience as any });
  }
  if (!authorized.length) return groundedAnswer([]);
  if (authorized.length > 2000) throw new AppError(422, '当前授权资料过多，请缩小知识库范围');
  const { client, config, credentialRef } = await knowledgeConnection(p.accountId, p.vdnId);
  const hits: KnowledgeHit[] = [];
  for (const bindingId of new Set(authorized.map(x => x.bindingId))) {
    const sources = authorized.filter(x => x.bindingId === bindingId);
    const c = docs.flatMap(d => d.versions).find(v => v.binding_id === bindingId)!.binding.connection;
    if (c.external_tenant_id !== config.tenantId || c.credential_ref !== credentialRef || c.base_url !== config.baseUrl) throw new AppError(503, '知识库连接已变更，需重新核验');
    for (let i = 0; i < sources.length; i += 500) {
      const batch = sources.slice(i, i + 500);
      const result = await client.post('/retrieval', buildRetrievalBody({ bindingId, datasetIds: [...new Set(batch.map(x => x.datasetId))], documentIds: batch.map(x => x.externalDocumentId), rerankId: config.rerankModel }, question));
      if (uncertain(result)) throw new AppError(503, '检索超时，请稍后重试');
      hits.push(...normalizeRetrieval({ code: 0, data: result }, batch));
    }
  }
  // Reload real ConfManager grants and source state after network I/O. Revoked or
  // deleted sources must not escape in an in-flight response.
  const fresh = await resolvePrincipal(), current = await loadDocuments(fresh, [...new Set(hits.map(h => h.documentId))]);
  const currentConversation = await conversationPolicy(fresh, conversationId);
  const connectionNow = await knowledgeConnection(fresh.accountId, fresh.vdnId);
  if (fresh.accountId !== p.accountId || fresh.vdnId !== p.vdnId || hits.some(h => {
    const d = current.find(d => d.id === h.documentId), v = d?.versions.find(v => v.id === h.versionId);
    const source = authorized.find(s => s.documentId === h.documentId && s.versionId === h.versionId);
    const b = v?.binding, c = b?.connection;
    return !d || !v || !b || !c || !source || b.id !== source.bindingId || b.base_id !== d.base_id || b.state !== 'active'
      || b.generation !== d.base.active_generation || b.external_dataset_id !== h.datasetId || v.external_document_id !== source.externalDocumentId
      || c.state !== 'active' || c.account_id !== fresh.accountId || c.vdn_id !== fresh.vdnId
      || c.external_tenant_id !== connectionNow.config.tenantId || c.base_url !== connectionNow.config.baseUrl
      || c.credential_ref !== connectionNow.credentialRef || connectionNow.config.apiKey !== config.apiKey
      || !isDocumentUsable(documentPolicy(d, v), fresh, use, new Date(), currentConversation);
  })) throw new AppError(403, '资料或授权已变更，请重新查询');
  await audit(prisma, fresh, 'knowledge.ask', 'retrieval', requestId);
  return groundedAnswer(hits.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)));
}
