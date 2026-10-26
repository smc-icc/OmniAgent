import type { FastifyRequest } from 'fastify';
import { AppError } from '../../shared/errors/index.js';
import { getAccess } from '../access/access.context.js';
import { database, rows } from '../access/access.db.js';
import { prisma } from '../../plugins/db.js';
import { knowledgeSubject, type KnowledgePrincipal, type KnowledgeLibraryPolicy, type KnowledgeDocumentPolicy } from '../access/knowledge.authorization.js';

export async function knowledgePrincipal(req: FastifyRequest): Promise<KnowledgePrincipal> {
  const a = await getAccess(req);
  const db = await database();
  const groups = await rows<{ id: number }>(db, 'SELECT GroupID AS id FROM t_user_usertogroup WHERE VDNID=? AND UserID=?', [a.vdnId, a.agentId]);
  const departments = await rows<{ id: number }>(db, 'SELECT departid AS id FROM t_user_usertodepart WHERE VDNID=? AND UserID=?', [a.vdnId, a.agentId]);
  const roles = await rows<{ id: number }>(db, 'SELECT RoleID AS id FROM t_user_usertorole WHERE UserID=? AND (VDNID=? OR (?=1 AND VDNID<=0))', [a.agentId, a.vdnId, a.vdnId]);
  return { accountId: a.accountId, vdnId: a.vdnId, userId: a.userId, enabled: true,
    operatorId: knowledgeSubject('operator', a.vdnId, String(a.userId)),
    agentGroupIds: groups.map(x => knowledgeSubject('agent_group', a.vdnId, String(x.id))),
    departmentIds: departments.map(x => knowledgeSubject('department', a.vdnId, String(x.id))),
    roleIds: roles.map(x => knowledgeSubject('role', a.vdnId, String(x.id))), skillGroupIds: [], customGroupIds: [],
    permissions: a.permissions, scopes: a.scopes };
}

/** Internal background identity: use the persisted assignee and reload Conf grants. */
export async function conversationKnowledgePrincipal(accountId: number, conversationId: number, assigneeId: number) {
  const conversation = await prisma.conversations.findFirst({ where: { id: conversationId, account_id: accountId, assignee_id: assigneeId } });
  const currentUser = await prisma.users.findUnique({ where: { id: assigneeId } });
  if (!conversation || !currentUser) throw new AppError(403, '自动回复坐席身份已变更');
  const principal = await knowledgePrincipal({ currentUser, headers: { 'x-account-id': String(accountId) },
    query: {}, params: {}, routeOptions: {} } as unknown as FastifyRequest);
  if (principal.accountId !== accountId || principal.userId !== assigneeId
    || !['knowledge.read', 'ai.execute', 'conversation.read', 'conversation.ai'].every(code => principal.permissions.includes(code))) {
    throw new AppError(403, '自动回复缺少当前坐席授权');
  }
  return principal;
}

export async function conversationKnowledgeOwnership(accountId: number, vdnId: number, userId: number | null) {
  const ownership = { ownerOperatorId: userId ? knowledgeSubject('operator', vdnId, String(userId)) : null,
    agentGroupIds: [] as string[], departmentIds: [] as string[] };
  if (!userId) return ownership;
  const binding = await prisma.conf_user_bindings.findFirst({ where: { user_id: userId, vdn_id: vdnId, enabled: true } });
  const member = await prisma.account_users.findFirst({ where: { user_id: userId, account_id: accountId } });
  if (!binding || !member) return ownership;
  const db = await database();
  const groups = await rows<{ id: number }>(db, `SELECT g.GroupID AS id FROM t_user_usertogroup g
    JOIN t_user_users u ON u.ID=g.UserID AND u.VDNID=g.VDNID AND u.IsValid=1 WHERE g.VDNID=? AND g.UserID=?`, [vdnId, binding.source_user_id]);
  const departments = await rows<{ id: number }>(db, `SELECT d.departid AS id FROM t_user_usertodepart d
    JOIN t_user_users u ON u.ID=d.UserID AND u.VDNID=d.VDNID AND u.IsValid=1 WHERE d.VDNID=? AND d.UserID=?`, [vdnId, binding.source_user_id]);
  ownership.agentGroupIds = groups.map(x => knowledgeSubject('agent_group', vdnId, String(x.id)));
  ownership.departmentIds = departments.map(x => knowledgeSubject('department', vdnId, String(x.id)));
  return ownership;
}

export function libraryPolicy(base: any): KnowledgeLibraryPolicy {
  return { accountId: base.account_id, vdnId: base.vdn_id, libraryId: base.id, enabled: base.state === 'active',
    ownership: { ownerOperatorId: knowledgeSubject('operator', base.vdn_id, String(base.owner_user_id)),
      agentGroupIds: Array.isArray(base.agent_group_ids) ? base.agent_group_ids.map((id: string) => knowledgeSubject('agent_group', base.vdn_id, String(id))) : [],
      departmentIds: base.department_id ? [knowledgeSubject('department', base.vdn_id, String(base.department_id))] : [] },
    acl: (base.acl ?? []).filter((a: any) => !a.document_id && a.account_id === base.account_id && a.vdn_id === base.vdn_id)
      .map((a: any) => ({ kind: a.subject_type, subject: a.subject_id, action: a.capability })) };
}

export function documentPolicy(doc: any, version = doc.versions?.[0]): KnowledgeDocumentPolicy {
  const lib = libraryPolicy(doc.base);
  return { accountId: doc.account_id, vdnId: doc.vdn_id, libraryId: doc.base_id, documentId: doc.id,
    versionId: version?.id ?? 'none', activeVersionId: doc.active_version_id,
    authorOperatorId: knowledgeSubject('operator', doc.vdn_id, String(version?.created_by ?? doc.owner_user_id)),
    ownership: { ...lib.ownership, ownerOperatorId: knowledgeSubject('operator', doc.vdn_id, String(doc.owner_user_id)) },
    state: doc.state, indexReady: version?.index_state === 'ready', customerApproved: doc.audience === 'customer_approved',
    validFrom: doc.valid_from, validTo: doc.valid_to, aclMode: doc.acl_mode, library: lib,
    acl: (doc.acl ?? []).filter((a: any) => a.account_id === doc.account_id && a.vdn_id === doc.vdn_id)
      .map((a: any) => ({ kind: a.subject_type, subject: a.subject_id, action: a.capability })) };
}
