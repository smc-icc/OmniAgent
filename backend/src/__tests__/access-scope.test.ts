import { describe, expect, it, vi } from 'vitest';
vi.mock('../shared/services/icc-groups-dal.js', () => ({ getIccMysqlPool: vi.fn() }));
import { accessScope, combineWhere, conversationScope, modelScope, type ScopeContext } from '../modules/access/access.scope.js';
import { withAccessScope } from '../modules/access/access.prisma.js';
import { permissionCatalog } from '../modules/access/access.catalog.js';
import { routePolicy } from '../modules/access/access.route-policy.js';

const ctx: ScopeContext = { userId: 10, accountId: 1, agentId: 20, vdnId: 2, administrator: false, permission: 'conversation.read', scopes: ['self'], all: false, userIds: [10], agentIds: [20], workNos: ['2001'] };
describe('scope enforcement before queries and side effects', () => {
  it('preserves unique IDs and ANDs client filters with scope', () => {
    const where = combineWhere({ id: 999, OR: [{ account_id: 999 }], AND: { status: 0 } }, conversationScope(ctx));
    expect(where.id).toBe(999);
    expect(where.AND).toContainEqual(expect.objectContaining({ account_id: 1 }));
    expect(where.AND).toContainEqual({ status: 0 });
  });
  it('same group expands owners without broadening tenant', () => {
    const scope = conversationScope({ ...ctx, userIds: [10, 11], scopes: ['group'] });
    expect(scope.account_id).toBe(1);
    expect(scope.OR[0].assignee_id.in).toEqual([10, 11]);
    expect(conversationScope({ ...ctx, all: true })).toEqual({ account_id: 1 });
  });
  it('unassigned queue is restricted to inbox membership and a queue/claim operation', () => {
    expect(conversationScope(ctx).OR).toHaveLength(2);
    expect(conversationScope({ ...ctx, permission: 'conversation.queue' }).OR[2]).toEqual({ assignee_id: null, inbox: { inbox_members: { some: { user_id: { in: [10] } } } } });
  });
  it('voicemail includes VDN and notifications remain personal even with account scope', () => {
    expect(modelScope('icc_voicemails', ctx, new Set(['vdn_id']))).toEqual({ vdn_id: 2, assignee_id: { in: [10] } });
    expect(modelScope('notifications', { ...ctx, all: true }, new Set(['account_id']))).toEqual({ account_id: 1, user_id: 10 });
  });
  it('request scopes are isolated across concurrent asynchronous handlers', async () => {
    const values = await Promise.all([10, 11].map(userId => accessScope.run({ ...ctx, userId }, async () => { await Promise.resolve(); return accessScope.getStore()?.userId; })));
    expect(values).toEqual([10, 11]); expect(accessScope.getStore()).toBeUndefined();
  });
  function extension() {
    let intercept: any;
    const client = { $extends: (definition: any) => { intercept = definition.query.$allOperations; return client; }, conversations: { findFirst: vi.fn().mockResolvedValue(null) }, accounts: { findFirst: vi.fn().mockResolvedValue({ id: 1 }) } };
    withAccessScope(client as any);
    return (model: string | undefined, operation: string, args: any, query: any) => accessScope.run(ctx, () => intercept({ model, operation, args, query }));
  }
  it.each(['findMany', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany', 'findUnique', 'update', 'delete'])('scopes %s before execution', async operation => {
    const query = vi.fn().mockResolvedValue([]);
    await extension()('conversations', operation, { where: { id: 777 } }, query);
    expect(query.mock.calls[0][0].where).toEqual(combineWhere({ id: 777 }, conversationScope(ctx)));
  });
  it('scopes nested message lists before pagination', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await extension()('conversations', 'findMany', { include: { messages: { take: 5 } } }, query);
    expect(query.mock.calls[0][0].include.messages.where.AND[0].conversation.account_id).toBe(1);
  });
  it('denies foreign conversation IDs before creating a message', async () => {
    const query = vi.fn();
    await expect(extension()('messages', 'create', { data: { conversation_id: 999, account_id: 1 } }, query)).rejects.toMatchObject({ statusCode: 403 });
    expect(query).not.toHaveBeenCalled();
  });
  it('denies nested writes and account changes', async () => {
    const query = vi.fn();
    await expect(extension()('conversations', 'update', { where: { id: 1 }, data: { account_id: 2 } }, query)).rejects.toMatchObject({ statusCode: 403 });
    await expect(extension()('conversations', 'update', { where: { id: 1 }, data: { messages: { create: { content: 'x' } } } }, query)).rejects.toMatchObject({ statusCode: 403 });
    expect(query).not.toHaveBeenCalled();
  });
  it('raw queries cannot silently bypass a limited scope', async () => {
    await expect(extension()(undefined, '$queryRaw', {}, vi.fn())).rejects.toMatchObject({ statusCode: 403 });
  });
});
describe('permission matrix', () => {
  it('has stable unique codes/IDs and only supported data scopes', () => {
    expect(new Set(permissionCatalog.map(p => p.value)).size).toBe(permissionCatalog.length);
    expect(new Set(permissionCatalog.map(p => p.code)).size).toBe(permissionCatalog.length);
    expect(permissionCatalog.find(p => p.code === 'channel.update')?.scopes).toEqual(['account']);
  });
  it('separates reads, replies, deletion and export; unknown modules fail closed', () => {
    const base = '/api/v1/accounts/:account_id/conversations/:id';
    expect(routePolicy('GET', base)?.permission).toBe('conversation.read');
    expect(routePolicy('POST', base + '/messages')?.permission).toBe('conversation.reply');
    expect(routePolicy('DELETE', base)?.permission).toBe('conversation.delete');
    expect(routePolicy('GET', base + '/transcript')?.permission).toBe('conversation.export');
    expect(routePolicy('POST', '/api/new-feature')).toBeUndefined();
  });
});
