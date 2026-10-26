import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ binding: vi.fn(), member: vi.fn(), rows: vi.fn() }));
vi.mock('../../plugins/db.js', () => ({ prisma: {
  conf_user_bindings: { findFirst: mock.binding }, account_users: { findFirst: mock.member },
} }));
vi.mock('../../modules/access/access.context.js', () => ({ getAccess: vi.fn() }));
vi.mock('../../modules/access/access.db.js', () => ({ database: async () => ({}), rows: mock.rows }));
import { conversationKnowledgeOwnership, libraryPolicy } from '../../modules/knowledge/knowledge.runtime-policy.js';

describe('knowledge organization adapter', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mock.binding.mockResolvedValue({ source_user_id: 10599 });
    mock.member.mockResolvedValue({ user_id: 3 });
    mock.rows.mockResolvedValueOnce([{ id: 5 }]).mockResolvedValueOnce([{ id: 7 }]);
  });
  it('uses the bound ConfManager source ID and both tenant constraints', async () => {
    expect(await conversationKnowledgeOwnership(1, 2, 3)).toEqual({
      ownerOperatorId: 'operator:2:3', agentGroupIds: ['agent_group:2:5'], departmentIds: ['department:2:7'],
    });
    expect(mock.binding).toHaveBeenCalledWith({ where: { user_id: 3, vdn_id: 2, enabled: true } });
    expect(mock.member).toHaveBeenCalledWith({ where: { user_id: 3, account_id: 1 } });
    for (const call of mock.rows.mock.calls) {
      expect(call[1]).toContain('u.IsValid=1'); expect(call[2]).toEqual([2, 10599]);
    }
  });
  it.each(['binding', 'member'])('does not infer organization without %s', async key => {
    mock[key as 'binding' | 'member'].mockResolvedValue(null);
    expect(await conversationKnowledgeOwnership(1, 2, 3)).toEqual({ ownerOperatorId: 'operator:2:3', agentGroupIds: [], departmentIds: [] });
    expect(mock.rows).not.toHaveBeenCalled();
  });
  it('does not assign unclaimed conversations to the requesting user', async () => {
    expect(await conversationKnowledgeOwnership(1, 2, null)).toEqual({ ownerOperatorId: null, agentGroupIds: [], departmentIds: [] });
    expect(mock.binding).not.toHaveBeenCalled();
  });
  it('preserves stored organization ownership on a library', () => {
    expect(libraryPolicy({ id: 'base', account_id: 1, vdn_id: 2, owner_user_id: 3,
      state: 'active', agent_group_ids: [5], department_id: 7 }).ownership).toEqual({
      ownerOperatorId: 'operator:2:3', agentGroupIds: ['agent_group:2:5'], departmentIds: ['department:2:7'],
    });
  });
});
