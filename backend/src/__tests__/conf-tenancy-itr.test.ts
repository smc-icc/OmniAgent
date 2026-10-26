import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ inbox: vi.fn() }));
vi.mock('../plugins/db.js', () => ({ prisma: { inboxes: { findUnique: m.inbox } } }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => process.env.CONF_TENANCY_ENABLED === '1' }));
import { assertItrConversationInbox } from '../shared/services/conf-itr-tenancy.js';
beforeEach(() => { process.env.CONF_TENANCY_ENABLED = '1'; m.inbox.mockReset().mockResolvedValue({ account_id: 70 }); });
describe('ITR persisted conversation inbox ownership', () => {
  it('accepts the owned persisted inbox without process defaults', async () => { await expect(assertItrConversationInbox({ account_id: 70, inbox_id: 4 }, 4)).resolves.toBeUndefined(); expect(m.inbox).toHaveBeenCalledWith({ where: { id: 4 }, select: { account_id: true } }); });
  it('rejects caller-supplied other inbox before querying or routing', async () => { await expect(assertItrConversationInbox({ account_id: 70, inbox_id: 4 }, 5)).rejects.toThrow('当前会话'); expect(m.inbox).not.toHaveBeenCalled(); });
  it('rejects cross-account persisted inbox', async () => { m.inbox.mockResolvedValue({ account_id: 71 }); await expect(assertItrConversationInbox({ account_id: 70, inbox_id: 4 })).rejects.toThrow('租户不一致'); });
  it('rejects missing conversation, missing account and missing inbox', async () => { for (const c of [null, { inbox_id: 4 }, { account_id: 70 }]) await expect(assertItrConversationInbox(c)).rejects.toThrow('可靠租户'); });
  it('rejects deleted inbox', async () => { m.inbox.mockResolvedValue(null); await expect(assertItrConversationInbox({ account_id: 70, inbox_id: 4 })).rejects.toThrow(); });
  it('leaves feature-off legacy behavior unchanged', async () => { process.env.CONF_TENANCY_ENABLED = '0'; await expect(assertItrConversationInbox(null, 5)).resolves.toBeUndefined(); expect(m.inbox).not.toHaveBeenCalled(); });
});
