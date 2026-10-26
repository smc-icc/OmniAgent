import { AsyncLocalStorage } from 'node:async_hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../../plugins/db.js', () => ({ prisma: { $transaction: mock.transaction } }));
vi.mock('../../modules/access/access.scope.js', () => ({ accessScope: new AsyncLocalStorage() }));
import { accessScope } from '../../modules/access/access.scope.js';
import { knowledgeTransaction } from '../../modules/knowledge/knowledge.repository.js';

const principal = { accountId: 1, vdnId: 2, userId: 3 } as any;
const scope = { accountId: 1, vdnId: 2, userId: 3, permission: 'knowledge.create' } as any;
describe('explicitly authorized atomic knowledge transactions', () => {
  beforeEach(() => vi.resetAllMocks());
  it('creates related records inside one transaction without outer-client FK checks', async () => {
    const tx = { knowledge_bases: { create: vi.fn() }, knowledge_acl_entries: { create: vi.fn() } };
    mock.transaction.mockImplementation(async work => {
      expect(accessScope.getStore()).toBeUndefined();
      return work(tx);
    });
    const result = await accessScope.run(scope, async () => {
      const value = await knowledgeTransaction(principal, async client => {
        expect(client).toBe(tx);
        expect(accessScope.getStore()).toBeUndefined();
        await client.knowledge_bases.create({ data: {} } as any);
        await client.knowledge_acl_entries.create({ data: {} } as any);
        return 'committed';
      });
      expect(accessScope.getStore()).toBe(scope);
      return value;
    });
    expect(result).toBe('committed');expect(mock.transaction).toHaveBeenCalledOnce();
  });
  it.each([
    { accountId: 9 }, { vdnId: 9 }, { userId: 9 }, { permission: 'conversation.create' },
  ])('rejects a mismatched request scope %j', mismatch => {
    expect(() => accessScope.run({ ...scope, ...mismatch }, () => knowledgeTransaction(principal, vi.fn())))
      .toThrow('知识库事务缺少有效授权范围');
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it('rejects calls without an authenticated request scope', () => {
    expect(() => knowledgeTransaction(principal, vi.fn())).toThrow('知识库事务缺少有效授权范围');
  });
  it('preserves rollback errors and restores the original request scope', async () => {
    mock.transaction.mockImplementation(async work => work({}));
    await accessScope.run(scope, async () => {
      await expect(knowledgeTransaction(principal, async () => { throw Error('rollback'); })).rejects.toThrow('rollback');
      expect(accessScope.getStore()).toBe(scope);
    });
  });
});
