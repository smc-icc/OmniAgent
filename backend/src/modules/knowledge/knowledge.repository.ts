import { prisma } from '../../plugins/db.js';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/index.js';
import { accessScope } from '../access/access.scope.js';
import type { KnowledgePrincipal } from '../access/knowledge.authorization.js';

export const tenantWhere = (p: Pick<KnowledgePrincipal, 'accountId' | 'vdnId'>) => ({ account_id: p.accountId, vdn_id: p.vdnId });
type KnowledgeTransaction = Pick<Prisma.TransactionClient, 'knowledge_bases' | 'knowledge_documents' | 'knowledge_document_versions'
  | 'knowledge_connections' | 'knowledge_bindings' | 'knowledge_acl_entries' | 'knowledge_sync_jobs' | 'knowledge_audit_events'>;
export function knowledgeTransaction<T>(p: KnowledgePrincipal, work: (tx: KnowledgeTransaction) => Promise<T>): Promise<T> {
  const scope = accessScope.getStore();
  if (!scope || scope.accountId !== p.accountId || scope.vdnId !== p.vdnId || scope.userId !== p.userId
    || !scope.permission.startsWith('knowledge.')) throw new AppError(403, '知识库事务缺少有效授权范围');
  // The generic FK guard uses the outer client and cannot see uncommitted rows.
  // Knowledge writes instead enforce tenantWhere and resource policies explicitly;
  // keep this exception inside the atomic, knowledge-only transaction callback.
  return accessScope.exit(() => prisma.$transaction(tx => work(tx)));
}
export const documentInclude = { base: { include: { acl: true } }, acl: true,
  versions: { orderBy: { version_no: 'desc' as const }, include: { binding: { include: { connection: true } } } } };
export async function loadDocuments(p: Pick<KnowledgePrincipal, 'accountId' | 'vdnId'>, ids?: string[]) {
  return prisma.knowledge_documents.findMany({ where: { ...tenantWhere(p), base: tenantWhere(p), ...(ids ? { id: { in: ids } } : {}) }, include: documentInclude });
}
export function audit(tx: any, p: KnowledgePrincipal, action: string, resourceId: string, requestId: string) {
  return tx.knowledge_audit_events.create({ data: { ...tenantWhere(p), actor_kind: 'user', actor_id: String(p.userId), action,
    resource_id: resourceId, request_id: requestId, outcome: 'success' } });
}
