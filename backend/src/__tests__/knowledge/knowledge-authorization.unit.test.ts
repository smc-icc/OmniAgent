import { describe, expect, it, vi } from 'vitest';
import {
  assertAuthorizedSources, canApproveKnowledge, canChangeKnowledgeAudience, canCreateKnowledge, canDownloadKnowledge,
  canExportKnowledge, canGrantKnowledge, canManageKnowledge, canReadKnowledge,
  isDocumentUsable, knowledgeSubject, resolveAuthorizedDocuments, revalidateAuthorizedSources,
  withAuthorizedDocuments, type AuthorizedKnowledge, type KnowledgeAclEntry,
  type KnowledgeConversationPolicy, type KnowledgeDocumentPolicy, type KnowledgePrincipal,
} from '../../modules/access/knowledge.authorization.js';
import { permissionCatalog } from '../../modules/access/access.catalog.js';

const now = new Date('2026-09-15T00:00:00Z');
const owner = { ownerOperatorId: 'operator:2:op-1', agentGroupIds: ['agent_group:2:g-1'], departmentIds: ['department:2:d-1'] };
const acl = (action: 'read' | 'manage' = 'read'): KnowledgeAclEntry[] => [{ kind: 'operator', subject: 'operator:2:op-1', action }];
const principal = (overrides: Partial<KnowledgePrincipal> = {}): KnowledgePrincipal => ({
  userId: 10, accountId: 1, vdnId: 2, enabled: true, operatorId: 'operator:2:op-1',
  agentGroupIds: ['agent_group:2:g-1'], skillGroupIds: ['skill_group:2:s-1'],
  departmentIds: ['department:2:d-1'], roleIds: ['role:2:r-1'], customGroupIds: ['custom_group:2:c-1'],
  permissions: ['knowledge.read', 'ai.execute'], scopes: { 'knowledge.read': ['account'], 'ai.execute': ['account'] },
  ...overrides,
});
const policy = (overrides: Partial<KnowledgeDocumentPolicy> = {}): KnowledgeDocumentPolicy => ({
  accountId: 1, vdnId: 2, documentId: 'doc-1', libraryId: 'lib-1', versionId: 'v-1', activeVersionId: 'v-1',
  authorOperatorId: 'operator:2:author', ownership: owner, state: 'published', indexReady: true,
  customerApproved: true, validFrom: null, validTo: null, aclMode: 'restricted', acl: acl(),
  library: { accountId: 1, vdnId: 2, libraryId: 'lib-1', enabled: true, ownership: owner, acl: acl() },
  ...overrides,
});
const conversation = (overrides: Partial<KnowledgeConversationPolicy> = {}): KnowledgeConversationPolicy => ({
  accountId: 1, vdnId: 2, conversationId: 'conv-1', ownership: owner, ...overrides,
});
function grant(p: KnowledgePrincipal, operation: string, scopes: KnowledgePrincipal['scopes'][string] = ['account']): KnowledgePrincipal {
  return { ...p, permissions: [...p.permissions, operation], scopes: { ...p.scopes, [operation]: scopes } };
}
const conversational = () => grant(grant(principal(), 'conversation.read', ['self']), 'conversation.ai', ['self']);
const managed = (overrides: Partial<KnowledgeDocumentPolicy> = {}) => policy({
  acl: acl('manage'), library: { ...policy().library, acl: acl('manage') }, ...overrides,
});

describe('T03A identity, scope and ACL', () => {
  it('allows published knowledge and internal QA without conversation permissions', () => {
    expect(canReadKnowledge(policy(), principal(), now)).toBe(true);
    expect(isDocumentUsable(policy(), principal(), 'staff_qa', now)).toBe(true);
  });
  it.each([{ accountId: 9 }, { vdnId: 9 }, { libraryId: 'foreign' }])('denies foreign documents %j', overrides => {
    expect(canReadKnowledge(policy(overrides), principal(), now)).toBe(false);
  });
  it.each([{ accountId: 9 }, { vdnId: 9 }, { enabled: false }, { acl: [] }])('requires library authorization %j', overrides => {
    expect(canReadKnowledge(policy({ library: { ...policy().library, ...overrides } }), principal(), now)).toBe(false);
  });
  it.each([
    { userId: 0 }, { enabled: false }, { operatorId: '' }, { operatorId: 'operator:9:op-1' },
    { agentGroupIds: ['agent_group:9:g-1'] }, { roleIds: ['role:9:r-1'] }, { scopes: {} }, { permissions: [] },
  ])('denies invalid or unauthorized principals %j', overrides => {
    expect(canReadKnowledge(policy(), { ...principal(), ...overrides } as KnowledgePrincipal, now)).toBe(false);
  });
  it.each(['self', 'group', 'department', 'account'] as const)('uses explicit %s ownership scope', scope => {
    const p = principal({ scopes: { 'knowledge.read': [scope] } });
    expect(canReadKnowledge(policy(), p, now)).toBe(true);
    const unrelated = { ownerOperatorId: 'operator:2:other', agentGroupIds: ['agent_group:2:other'], departmentIds: ['department:2:child'] };
    expect(canReadKnowledge(policy({ ownership: unrelated }), p, now)).toBe(scope === 'account');
  });
  it('unions operation scopes while intersecting with ACL', () => {
    const p = principal({ scopes: { 'knowledge.read': ['self', 'department'] } });
    const d = policy({ ownership: { ...owner, ownerOperatorId: null } });
    expect(canReadKnowledge(d, p, now)).toBe(true);
    expect(canReadKnowledge({ ...d, acl: [] }, p, now)).toBe(false);
  });
  it('requires explicit inheritance and intersects restricted ACL with library ACL', () => {
    expect(canReadKnowledge(policy({ acl: [] }), principal(), now)).toBe(false);
    expect(canReadKnowledge(policy({ aclMode: 'inherit', acl: [] }), principal(), now)).toBe(true);
    expect(canReadKnowledge(policy({ aclMode: 'inherit', library: { ...policy().library, acl: [] } }), principal(), now)).toBe(false);
    expect(canReadKnowledge(policy({ acl: acl('manage') }), principal(), now)).toBe(false);
  });
  it.each([
    ['account', 'account:2:1'], ['operator', 'operator:2:op-1'], ['agent_group', 'agent_group:2:g-1'],
    ['skill_group', 'skill_group:2:s-1'], ['department', 'department:2:d-1'],
    ['role', 'role:2:r-1'], ['custom_group', 'custom_group:2:c-1'],
  ] as const)('supports %s ACL membership but rejects foreign subjects', (kind, subject) => {
    expect(canReadKnowledge(policy({ acl: [{ kind, subject, action: 'read' }] }), principal(), now)).toBe(true);
    expect(canReadKnowledge(policy({ acl: [{ kind, subject: subject.replace(':2:', ':9:'), action: 'read' }] }), principal(), now)).toBe(false);
  });
  it('validates subject kind and construction', () => {
    expect(canReadKnowledge(policy({ acl: [{ kind: 'role', subject: 'operator:2:op-1', action: 'read' }] }), principal(), now)).toBe(false);
    expect(() => knowledgeSubject('operator', 0, 'op-1')).toThrow();
    expect(() => knowledgeSubject('operator', 2, 'op:1')).toThrow();
    expect(knowledgeSubject('operator', 2, 'op-1')).toBe('operator:2:op-1');
  });
});

describe('T03A version and purpose constraints', () => {
  it.each(['draft', 'processing', 'ready', 'withdrawn', 'expired', 'deleted'] as const)('does not expose %s versions', state => {
    expect(canReadKnowledge(policy({ state }), principal(), now)).toBe(false);
  });
  it.each([{ indexReady: false }, { activeVersionId: null }, { activeVersionId: 'v-2' }])('requires the active indexed version %j', overrides => {
    expect(canReadKnowledge(policy(overrides), principal(), now)).toBe(false);
  });
  it('keeps V1 usable while V2 is unfinished', () => {
    const selection = resolveAuthorizedDocuments([policy(), policy({ versionId: 'v-2', state: 'processing', indexReady: false })], principal(), 'staff_qa', now);
    expect(selection.documents).toEqual([{ documentId: 'doc-1', versionId: 'v-1' }]);
  });
  it('enforces inclusive start and exclusive expiry, rejecting malformed windows', () => {
    expect(canReadKnowledge(policy({ validFrom: now }), principal(), now)).toBe(true);
    for (const overrides of [
      { validFrom: new Date(now.getTime() + 1) }, { validTo: now },
      { validFrom: new Date('invalid') }, { validTo: new Date('invalid') },
      { validFrom: now, validTo: now }, { validFrom: now, validTo: new Date(now.getTime() - 1) },
    ]) expect(canReadKnowledge(policy(overrides), principal(), now)).toBe(false);
    expect(canReadKnowledge(policy(), principal(), new Date('invalid'))).toBe(false);
  });
  it('separates reading from AI permission and operation scope', () => {
    const p = principal({ permissions: ['knowledge.read'] });
    expect(canReadKnowledge(policy(), p, now)).toBe(true);
    expect(isDocumentUsable(policy(), p, 'staff_qa', now)).toBe(false);
    expect(isDocumentUsable(policy(), grant(p, 'ai.execute', []), 'staff_qa', now)).toBe(false);
  });
  it('requires customer approval and conversation context for reply suggestions', () => {
    expect(isDocumentUsable(policy({ customerApproved: false }), principal(), 'staff_qa', now)).toBe(true);
    expect(isDocumentUsable(policy(), conversational(), 'reply_suggestion', now, conversation())).toBe(true);
    expect(isDocumentUsable(policy({ customerApproved: false }), conversational(), 'reply_suggestion', now, conversation())).toBe(false);
    expect(isDocumentUsable(policy(), conversational(), 'reply_suggestion', now)).toBe(false);
    expect(isDocumentUsable(policy(), conversational(), 'auto_reply' as 'staff_qa', now, conversation())).toBe(false);
  });
  it.each(['conversation.read', 'conversation.ai'])('independently requires %s and its scope', operation => {
    const p = conversational();
    for (const denied of [
      { ...p, permissions: p.permissions.filter(code => code !== operation) },
      { ...p, scopes: { ...p.scopes, [operation]: [] } },
    ]) expect(isDocumentUsable(policy(), denied, 'reply_suggestion', now, conversation())).toBe(false);
  });
  it.each(['staff_qa', 'reply_suggestion'] as const)('cannot expand conversation scope using AI account scope in %s', use => {
    for (const conv of [conversation({ accountId: 9 }), conversation({ vdnId: 9 }),
      conversation({ ownership: { ...owner, ownerOperatorId: 'operator:2:other' } }),
    ]) expect(isDocumentUsable(policy(), conversational(), use, now, conv)).toBe(false);
  });
});

describe('T03A management, download and export', () => {
  it('requires publish and grant authority to change customer approval, never content-edit authority alone', () => {
    const d = managed({ state: 'ready' });
    const publisher = grant(principal(), 'knowledge.publish');
    const approver = grant(publisher, 'knowledge.grant');
    expect(canChangeKnowledgeAudience(d, approver)).toBe(true);
    expect(canChangeKnowledgeAudience(d, publisher)).toBe(false);
    expect(canChangeKnowledgeAudience(d, grant(principal(), 'knowledge.update'))).toBe(false);
    expect(canChangeKnowledgeAudience(d, grant(approver, 'knowledge.grant', []))).toBe(false);
    expect(canChangeKnowledgeAudience({ ...d, authorOperatorId: approver.operatorId }, approver)).toBe(false);
    expect(canChangeKnowledgeAudience({ ...d, acl: [] }, approver)).toBe(false);
  });
  it('requires read, download and export permissions and ranges independently', () => {
    const d = policy({ ownership: { ...owner, ownerOperatorId: 'operator:2:other' } });
    const download = grant(principal(), 'knowledge.download');
    expect(canDownloadKnowledge(d, principal(), now)).toBe(false);
    expect(canDownloadKnowledge(d, download, now)).toBe(true);
    expect(canDownloadKnowledge(d, grant(principal(), 'knowledge.download', ['self']), now)).toBe(false);
    expect(canExportKnowledge(d, download, now)).toBe(false);
    expect(canExportKnowledge(d, grant(download, 'knowledge.export', ['self']), now)).toBe(false);
    expect(canExportKnowledge(d, grant(download, 'knowledge.export'), now)).toBe(true);
    expect(canExportKnowledge(d, grant(principal(), 'knowledge.export'), now)).toBe(false);
    expect(canExportKnowledge({ ...d, acl: [] }, grant(download, 'knowledge.export'), now)).toBe(false);
  });
  it.each(['update', 'delete', 'publish', 'grant', 'reindex'] as const)('requires %s permission, range and both manage ACLs', action => {
    const p = grant(principal(), `knowledge.${action}`);
    expect(canManageKnowledge(managed({ state: 'draft' }), p, action)).toBe(true);
    expect(canManageKnowledge(managed(), principal(), action)).toBe(false);
    expect(canManageKnowledge(policy(), p, action)).toBe(false);
    expect(canManageKnowledge(managed({ library: policy().library }), p, action)).toBe(false);
    expect(canManageKnowledge(managed({ acl: [] }), p, action)).toBe(false);
    expect(canManageKnowledge(managed(), grant(p, `knowledge.${action}`, []), action)).toBe(false);
    expect(canManageKnowledge(managed({ accountId: 9 }), p, action)).toBe(false);
    expect(canManageKnowledge(managed({ state: 'deleted' }), p, action)).toBe(false);
  });
  it('requires a managed enabled library for creation', () => {
    const p = grant(principal(), 'knowledge.create');
    expect(canCreateKnowledge(managed().library, p)).toBe(true);
    expect(canCreateKnowledge(policy().library, p)).toBe(false);
    expect(canCreateKnowledge(managed().library, principal())).toBe(false);
    expect(canCreateKnowledge({ ...managed().library, enabled: false }, p)).toBe(false);
    expect(canCreateKnowledge({ ...managed().library, vdnId: 9 }, p)).toBe(false);
  });
  it('requires an indexed ready version and a reviewer other than its author', () => {
    const p = grant(principal(), 'knowledge.publish');
    const d = managed({ state: 'ready' });
    expect(canApproveKnowledge(d, p)).toBe(true);
    expect(canApproveKnowledge({ ...d, authorOperatorId: p.operatorId }, p)).toBe(false);
    expect(canApproveKnowledge({ ...d, indexReady: false }, p)).toBe(false);
    expect(canApproveKnowledge({ ...d, state: 'processing' }, p)).toBe(false);
    expect(canApproveKnowledge(d, grant(principal(), 'knowledge.update'))).toBe(false);
  });
  it('only grants subjects inside the trusted grantable scope and current tenant/VDN', () => {
    const p = grant(principal(), 'knowledge.grant');
    expect(canGrantKnowledge(managed(), p, acl(), ['operator:2:op-1'])).toBe(true);
    expect(canGrantKnowledge(managed(), grant(principal(), 'knowledge.update'), acl(), ['operator:2:op-1'])).toBe(false);
    expect(canGrantKnowledge(managed(), p, acl(), [])).toBe(false);
    for (const entry of [
      { kind: 'operator', subject: 'operator:9:op-1', action: 'read' },
      { kind: 'account', subject: 'account:2:9', action: 'read' },
      { kind: 'role', subject: 'operator:2:op-1', action: 'read' },
    ] as KnowledgeAclEntry[]) expect(canGrantKnowledge(managed(), p, [entry], [entry.subject])).toBe(false);
  });
});

describe('T03A authorized sources and revocation', () => {
  it('deduplicates document/version pairs and rejects foreign sources and versions', async () => {
    const selection = resolveAuthorizedDocuments([policy(), policy(), policy({ documentId: 'foreign', accountId: 8 })], principal(), 'staff_qa', now);
    expect(selection.documents).toEqual([{ documentId: 'doc-1', versionId: 'v-1' }]);
    const perform = vi.fn(async documents => documents.length);
    await expect(withAuthorizedDocuments(selection, perform)).resolves.toBe(1);
    expect(() => assertAuthorizedSources(selection, selection.documents)).not.toThrow();
    for (const source of [{ documentId: 'foreign', versionId: 'v-1' }, { documentId: 'doc-1', versionId: 'v-2' }]) {
      expect(() => assertAuthorizedSources(selection, [source])).toThrow('knowledge_source_denied');
    }
    expect(Object.isFrozen(selection)).toBe(true);
    expect(Object.isFrozen(selection.documents)).toBe(true);
    expect(Object.isFrozen(selection.documents[0])).toBe(true);
  });
  it('never invokes upstream with an empty allowlist', async () => {
    const selection = resolveAuthorizedDocuments([policy({ acl: [] })], principal(), 'staff_qa', now);
    const upstream = vi.fn();
    await expect(withAuthorizedDocuments(selection, upstream)).resolves.toBeNull();
    expect(upstream).not.toHaveBeenCalled();
    expect(() => assertAuthorizedSources(selection, [])).toThrow('knowledge_authorization_empty');
  });
  it('rejects forged, copied and deserialized authorizations', async () => {
    const real = resolveAuthorizedDocuments([policy()], principal(), 'staff_qa', now);
    for (const forged of [{ documents: real.documents }, { ...real }, JSON.parse(JSON.stringify(real))] as AuthorizedKnowledge[]) {
      const upstream = vi.fn();
      await expect(withAuthorizedDocuments(forged, upstream)).rejects.toThrow('knowledge_authorization_invalid');
      expect(() => assertAuthorizedSources(forged, real.documents)).toThrow('knowledge_authorization_invalid');
      expect(upstream).not.toHaveBeenCalled();
    }
  });
  it.each([
    ['role', 'role:2:r-1', 'roleIds'], ['skill_group', 'skill_group:2:s-1', 'skillGroupIds'],
    ['custom_group', 'custom_group:2:c-1', 'customGroupIds'],
  ] as const)('revalidates current %s membership', (kind, subject, field) => {
    const d = policy({ acl: [{ kind, subject, action: 'read' }] });
    const selection = resolveAuthorizedDocuments([d], principal(), 'staff_qa', now);
    expect(selection.documents).toHaveLength(1);
    expect(() => revalidateAuthorizedSources([d], principal({ [field]: [] }), 'staff_qa', selection.documents, now)).toThrow('knowledge_authorization_empty');
  });
  it('rejects any revoked source even when another source is still allowed', () => {
    const second = policy({ documentId: 'doc-2' });
    const selection = resolveAuthorizedDocuments([policy(), second], principal(), 'staff_qa', now);
    for (const revoked of [policy({ state: 'withdrawn' }), policy({ activeVersionId: 'v-2' }), policy({ validTo: now })]) {
      expect(() => revalidateAuthorizedSources([revoked, second], principal(), 'staff_qa', selection.documents, now)).toThrow('knowledge_source_denied');
    }
    expect(() => revalidateAuthorizedSources([policy(), second], principal(), 'staff_qa', selection.documents, now)).not.toThrow();
  });
});

describe('T03A append-only permission catalog', () => {
  it('preserves existing IDs, appends planned operations and never duplicates codes or IDs', () => {
    expect(new Set(permissionCatalog.map(p => p.value)).size).toBe(permissionCatalog.length);
    expect(new Set(permissionCatalog.map(p => p.code)).size).toBe(permissionCatalog.length);
    const expected = {
      'knowledge.read': 280, 'knowledge.create': 281, 'knowledge.update': 282, 'knowledge.delete': 283,
      'knowledge.publish': 284, 'knowledge.grant': 285, 'knowledge.download': 286, 'knowledge.reindex': 287,
      'knowledge.export': 288, 'ai.read': 300, 'ai.create': 301, 'ai.update': 302, 'ai.delete': 303,
      'ai.execute': 304, 'ai.autoreply': 305, 'ai.configure': 306, 'ai.audit': 307,
    };
    for (const [code, value] of Object.entries(expected)) expect(permissionCatalog.find(p => p.code === code)?.value).toBe(value);
    for (const p of permissionCatalog.filter(p => p.module === 'knowledge')) expect(p.scopes).toEqual(['self', 'group', 'department', 'account']);
  });
});
