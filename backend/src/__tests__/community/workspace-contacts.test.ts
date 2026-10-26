import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ enabled: false, find: vi.fn(), unread: vi.fn() }));
vi.mock('../../modules/product-modules/authority.js', () => ({ productModules: () => ({ snapshot: async () => ({ modules: { icc: { available: m.enabled } } }) }) }));
vi.mock('../../plugins/db.js', () => ({ prisma: { conversations: { findMany: m.find } } }));
vi.mock('../../shared/services/conversation-unread.js', () => ({ countAgentUnread: m.unread }));
import { omnichannelContacts, omnichannelContactsExport } from '../../modules/omnichannel/omnichannel.routes.js';
const row = (id: number, type: string) => ({ id, account_id: 1, additional_attributes: {}, agent_last_seen_at: null, created_at: new Date(), last_activity_at: new Date(), inbox: { id, name: type, channel_type: type }, messages: [], contact: { id, name: type === 'Channel::Voice' ? 'phone-only-record' : 'online-record', phone_number: null, email: null } });
beforeEach(() => { vi.resetAllMocks(); m.enabled = false; m.find.mockResolvedValue([row(1, 'Channel::WebWidget'), row(2, 'Channel::Voice')]); m.unread.mockResolvedValue(0); });
function request(query = {}) { return { query, currentUser: { id: 1 }, log: { error: vi.fn() } } as any; }
function reply() { return { send: vi.fn(v => v), header: vi.fn() } as any; }
it.each(['customers', 'history'])('Community %s excludes phone records and phone summary', async tab => {
  const r = reply(); await omnichannelContacts(request({ tab }), r);
  expect(r.send.mock.calls[0][0].items.map((x: any) => x.conversation_id)).toEqual([1]);
  expect(r.send.mock.calls[0][0].channel_summary.map((x: any) => x.channel_group)).toEqual(['media']);
});
it('Community history CSV does not expose phone records', async () => {
  const r = reply(); await omnichannelContactsExport(request({ tab: 'history' }), r);
  expect(r.send.mock.calls[0][0]).toContain('online-record');
  expect(r.send.mock.calls[0][0]).not.toContain('phone-only-record');
});
it('installed enabled ICC keeps phone records available', async () => {
  m.enabled = true; const r = reply(); await omnichannelContacts(request({ channel_group: 'phone' }), r);
  expect(r.send.mock.calls[0][0].items.map((x: any) => x.conversation_id)).toEqual([2]);
});
