import { z } from 'zod';

// Only trusted identity/organization/repository adapters may supply these inputs.
// No database, network, cache or administrator permission expansion lives here.
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const positiveId = z.number().int().positive();
const subjectKind = z.enum(['account', 'agent_group', 'skill_group', 'department', 'role', 'custom_group', 'operator']);
export type KnowledgeAclKind = z.infer<typeof subjectKind>;
export type KnowledgeUse = 'staff_qa' | 'reply_suggestion';
export function knowledgeSubject(kind: KnowledgeAclKind, vdnId: number, rawId: string): string {
  return `${subjectKind.parse(kind)}:${positiveId.parse(vdnId)}:${id.parse(rawId)}`;
}
const subject = (kind: KnowledgeAclKind) => z.string().regex(new RegExp(`^${kind}:[1-9][0-9]*:[A-Za-z0-9_-]+$`));
const aclSchema = z.object({ kind: subjectKind, subject: z.string().min(1), action: z.enum(['read', 'manage']) }).strict()
  .refine(entry => subject(entry.kind).safeParse(entry.subject).success);
export type KnowledgeAclEntry = z.infer<typeof aclSchema>;
const ownership = z.object({
  ownerOperatorId: subject('operator').nullable(),
  agentGroupIds: z.array(subject('agent_group')), departmentIds: z.array(subject('department')),
});
const tenant = z.object({ accountId: positiveId, vdnId: positiveId });
const librarySchema = tenant.extend({ libraryId: id, enabled: z.boolean(), ownership, acl: z.array(aclSchema) });
const documentSchema = tenant.extend({
  documentId: id, libraryId: id, versionId: id, activeVersionId: id.nullable(),
  authorOperatorId: subject('operator'), ownership,
  state: z.enum(['draft', 'processing', 'ready', 'published', 'withdrawn', 'expired', 'deleted']),
  indexReady: z.boolean(), customerApproved: z.boolean(),
  validFrom: z.date().nullable(), validTo: z.date().nullable(),
  aclMode: z.enum(['inherit', 'restricted']), acl: z.array(aclSchema), library: librarySchema,
});
const principalSchema = tenant.extend({
  userId: positiveId, operatorId: subject('operator'), enabled: z.literal(true),
  agentGroupIds: z.array(subject('agent_group')), skillGroupIds: z.array(subject('skill_group')),
  departmentIds: z.array(subject('department')), roleIds: z.array(subject('role')),
  customGroupIds: z.array(subject('custom_group')),
  permissions: z.array(z.string()),
  scopes: z.record(z.array(z.enum(['self', 'group', 'department', 'account']))),
});
export type KnowledgeDocumentPolicy = z.infer<typeof documentSchema>;
export type KnowledgePrincipal = z.infer<typeof principalSchema>;
export type KnowledgeLibraryPolicy = z.infer<typeof librarySchema>;
const conversationSchema = tenant.extend({ conversationId: id, ownership });
export type KnowledgeConversationPolicy = z.infer<typeof conversationSchema>;
function sameTenant(a: z.infer<typeof tenant>, b: z.infer<typeof tenant>): boolean {
  return a.accountId === b.accountId && a.vdnId === b.vdnId;
}
function inVdn(value: string, kind: KnowledgeAclKind, vdnId: number): boolean {
  return value.startsWith(`${kind}:${vdnId}:`);
}
function validPrincipal(input: KnowledgePrincipal): boolean {
  if (!principalSchema.safeParse(input).success) return false;
  if (!inVdn(input.operatorId, 'operator', input.vdnId)) return false;
  return (['agent_group', 'skill_group', 'department', 'role', 'custom_group'] as const)
    .every(kind => members(input, kind).every(value => inVdn(value, kind, input.vdnId)));
}
function members(p: KnowledgePrincipal, kind: KnowledgeAclKind): string[] {
  switch (kind) {
    case 'account': return [knowledgeSubject('account', p.vdnId, String(p.accountId))];
    case 'operator': return [p.operatorId];
    case 'agent_group': return p.agentGroupIds;
    case 'skill_group': return p.skillGroupIds;
    case 'department': return p.departmentIds;
    case 'role': return p.roleIds;
    case 'custom_group': return p.customGroupIds;
  }
}
function scopeAllows(p: KnowledgePrincipal, operation: string, owner: z.infer<typeof ownership>): boolean {
  if (!p.permissions.includes(operation)) return false;
  return (p.scopes[operation] ?? []).some(scope => {
    switch (scope) {
      case 'account': return true;
      case 'self': return owner.ownerOperatorId === p.operatorId;
      case 'group': return owner.agentGroupIds.some(value => p.agentGroupIds.includes(value));
      case 'department': return owner.departmentIds.some(value => p.departmentIds.includes(value));
      default: return false;
    }
  });
}
function aclAllows(acl: KnowledgeAclEntry[], p: KnowledgePrincipal, action: 'read' | 'manage'): boolean {
  return acl.some(entry => entry.action === action && members(p, entry.kind).includes(entry.subject));
}
function validDocument(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal): boolean {
  return validPrincipal(p) && documentSchema.safeParse(d).success && sameTenant(d, p)
    && sameTenant(d.library, p) && d.libraryId === d.library.libraryId && d.library.enabled
    && inVdn(d.authorOperatorId, 'operator', p.vdnId);
}
function resourceAllows(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal, operation: string, action: 'read' | 'manage'): boolean {
  return scopeAllows(p, operation, d.ownership) && aclAllows(d.library.acl, p, action)
    && (d.aclMode === 'inherit' || aclAllows(d.acl, p, action));
}
// Reading/downloading knowledge does not require AI execution permission.
export function canReadKnowledge(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal, now = new Date()): boolean {
  if (!validDocument(d, p) || !z.date().safeParse(now).success) return false;
  if (d.state !== 'published' || !d.indexReady || d.activeVersionId !== d.versionId) return false;
  if (d.validFrom && d.validTo && d.validFrom >= d.validTo) return false;
  if (d.validFrom && now < d.validFrom || d.validTo && now >= d.validTo) return false;
  return resourceAllows(d, p, 'knowledge.read', 'read');
}
export function canDownloadKnowledge(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal, now = new Date()): boolean {
  return canReadKnowledge(d, p, now) && scopeAllows(p, 'knowledge.download', d.ownership);
}
export function canExportKnowledge(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal, now = new Date()): boolean {
  return canDownloadKnowledge(d, p, now) && scopeAllows(p, 'knowledge.export', d.ownership);
}
export function isDocumentUsable(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal, use: KnowledgeUse, now = new Date(), conversation?: KnowledgeConversationPolicy): boolean {
  // Auto reply needs the phase-two bot policy; no operator-only fallback.
  if (!['staff_qa', 'reply_suggestion'].includes(use) || !canReadKnowledge(d, p, now)) return false;
  if (!scopeAllows(p, 'ai.execute', d.ownership)) return false;
  if (use === 'reply_suggestion' && (!d.customerApproved || !conversation)) return false;
  if (conversation && (!conversationSchema.safeParse(conversation).success || !sameTenant(conversation, p)
    || !scopeAllows(p, 'conversation.read', conversation.ownership)
    || !scopeAllows(p, 'conversation.ai', conversation.ownership))) return false;
  return true;
}
export function canCreateKnowledge(library: KnowledgeLibraryPolicy, p: KnowledgePrincipal): boolean {
  return validPrincipal(p) && librarySchema.safeParse(library).success && sameTenant(library, p)
    && library.enabled && scopeAllows(p, 'knowledge.create', library.ownership) && aclAllows(library.acl, p, 'manage');
}
export function canManageKnowledgeLibrary(library: KnowledgeLibraryPolicy, p: KnowledgePrincipal, operation: string): boolean {
  return validPrincipal(p) && librarySchema.safeParse(library).success && sameTenant(library, p)
    && library.enabled && scopeAllows(p, operation, library.ownership) && aclAllows(library.acl, p, 'manage');
}
export function canManageKnowledge(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal, action: 'update' | 'delete' | 'publish' | 'grant' | 'reindex'): boolean {
  return ['update', 'delete', 'publish', 'grant', 'reindex'].includes(action) && validDocument(d, p)
    && d.state !== 'deleted' && resourceAllows(d, p, `knowledge.${action}`, 'manage');
}
export function canApproveKnowledge(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal): boolean {
  return canManageKnowledge(d, p, 'publish') && ['ready', 'withdrawn'].includes(d.state) && d.indexReady && d.authorOperatorId !== p.operatorId;
}
// Audience changes are separate from content updates, including on already published versions.
export function canChangeKnowledgeAudience(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal): boolean {
  return canManageKnowledge(d, p, 'publish') && canManageKnowledge(d, p, 'grant')
    && d.authorOperatorId !== p.operatorId;
}
export function canGrantKnowledge(d: KnowledgeDocumentPolicy, p: KnowledgePrincipal, proposed: KnowledgeAclEntry[], grantableSubjects: readonly string[]): boolean {
  return canManageKnowledge(d, p, 'grant') && z.array(aclSchema).safeParse(proposed).success
    && proposed.every(entry => inVdn(entry.subject, entry.kind, p.vdnId)
      && (entry.kind !== 'account' || entry.subject === knowledgeSubject('account', p.vdnId, String(p.accountId)))
      && grantableSubjects.includes(entry.subject));
}
export interface AuthorizedDocument { readonly documentId: string; readonly versionId: string; }
declare const authorizationBrand: unique symbol;
export interface AuthorizedKnowledge {
  readonly [authorizationBrand]: true;
  readonly documents: readonly AuthorizedDocument[];
}
const issued = new WeakSet<object>();
export function resolveAuthorizedDocuments(policies: readonly KnowledgeDocumentPolicy[], p: KnowledgePrincipal, use: KnowledgeUse, now = new Date(), conversation?: KnowledgeConversationPolicy): AuthorizedKnowledge {
  const documents: AuthorizedDocument[] = [];
  const seen = new Set<string>();
  for (const d of policies) {
    if (!isDocumentUsable(d, p, use, now, conversation)) continue;
    const key = `${d.documentId}/${d.versionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    documents.push(Object.freeze({ documentId: d.documentId, versionId: d.versionId }));
  }
  const result = Object.freeze({ documents: Object.freeze(documents) }) as AuthorizedKnowledge;
  issued.add(result);
  return result;
}
export function assertAuthorizedSources(selection: AuthorizedKnowledge, sources: readonly AuthorizedDocument[]): void {
  if (!issued.has(selection)) throw new Error('knowledge_authorization_invalid');
  if (!selection.documents.length) throw new Error('knowledge_authorization_empty');
  if (!z.array(z.object({ documentId: id, versionId: id })).safeParse(sources).success
    || sources.some(s => !selection.documents.some(d => d.documentId === s.documentId && d.versionId === s.versionId))) {
    throw new Error('knowledge_source_denied');
  }
}
// Callers must reload server-side identity and policies immediately before sensitive effects.
export function revalidateAuthorizedSources(policies: readonly KnowledgeDocumentPolicy[], p: KnowledgePrincipal, use: KnowledgeUse, sources: readonly AuthorizedDocument[], now = new Date(), conversation?: KnowledgeConversationPolicy): void {
  assertAuthorizedSources(resolveAuthorizedDocuments(policies, p, use, now, conversation), sources);
}
export async function withAuthorizedDocuments<T>(selection: AuthorizedKnowledge, perform: (documents: readonly AuthorizedDocument[]) => Promise<T>): Promise<T | null> {
  if (!issued.has(selection)) throw new Error('knowledge_authorization_invalid');
  if (!selection.documents.length) return null;
  return perform(selection.documents);
}
