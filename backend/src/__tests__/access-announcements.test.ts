import { describe, expect, it, vi } from 'vitest';
vi.mock('../shared/services/icc-groups-dal.js', () => ({ getIccMysqlPool: vi.fn() }));
import { announcementSchema, announcementVisibility } from '../modules/announcements/announcements.policy.js';
import { modelScope, type ScopeContext } from '../modules/access/access.scope.js';
import { routePolicy } from '../modules/access/access.route-policy.js';
const valid = { title: '公告', body: '正文', audience_mode: 'selected', recipient_ids: [7], starts_at: '2026-09-15T08:00:00+08:00', ends_at: null };
describe('announcement audience validation', () => {
  it('deduplicates operator snapshots', () => expect(announcementSchema.parse({ ...valid, recipient_ids: [7, 7, 9] }).recipient_ids).toEqual([7, 9]));
  it.each([{}, { audience_mode: undefined }, { recipient_ids: [] }, { recipient_ids: [-1] }, { recipient_ids: ['7'] }, { recipient_ids: [1.5] }, { audience_mode: 'all' }, { ends_at: valid.starts_at }, { ends_at: '2026-09-14T00:00:00Z' }, { account_id: 2 }, { vdn_id: 2 }, { body: '  ' }])('rejects unsafe or ambiguous input %j', patch => {
    expect(announcementSchema.safeParse(Object.keys(patch).length ? { ...valid, ...patch } : {}).success).toBe(false);
  });
  it('requires explicit all for an all-operator announcement', () => expect(announcementSchema.parse({ ...valid, audience_mode: 'all', recipient_ids: [] }).audience_mode).toBe('all'));
  it('enforces tenant, VDN, recipient, publication and both time boundaries in one predicate', () => {
    const now = new Date('2026-09-15T00:00:00Z');
    expect(announcementVisibility(2, 3, 7, now)).toEqual({ account_id: 2, vdn_id: 3, status: 'published', starts_at: { lte: now }, AND: [{ OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, { OR: [{ audience_mode: 'all' }, { audience_mode: 'selected', recipient_ids: { has: 7 } }] }] });
  });
  it('administration scope cannot broaden a personal inbox or read receipt', () => {
    const ctx = { accountId: 2, vdnId: 3, agentId: 7, userId: 9, permission: 'session', administrator: false, all: true, userIds: [9], agentIds: [7], workNos: [], scopes: ['account'] } as ScopeContext;
    const scoped = modelScope('agent_announcements', ctx, new Set());
    expect(scoped).toMatchObject({ account_id: 2, vdn_id: 3, status: 'published', AND: expect.any(Array) });
    expect(modelScope('agent_announcement_reads', ctx, new Set())).toMatchObject({ user_id: 9, announcement: { account_id: 2, vdn_id: 3, status: 'published' } });
    expect(modelScope('agent_announcements', { ...ctx, permission: 'announcement.read' }, new Set())).toEqual({ account_id: 2, vdn_id: 3 });
  });
  it.each([['GET', '/api/announcements/recipients', 'read'], ['GET', '/api/announcements/manage', 'read'], ['POST', '/api/announcements/manage', 'create'], ['PUT', '/api/announcements/manage/:id', 'update'], ['DELETE', '/api/announcements/manage/:id', 'delete'], ['POST', '/api/announcements/groups', 'create'], ['PUT', '/api/announcements/groups/:id', 'update'], ['DELETE', '/api/announcements/groups/:id', 'delete']])('guards %s %s', (method, path, action) => expect(routePolicy(method, path)?.permission).toBe(`announcement.${action}`));
  it('guards global search with conversation visibility', () => expect(routePolicy('GET', '/api/search/global')?.permission).toBe('conversation.read'));
});
