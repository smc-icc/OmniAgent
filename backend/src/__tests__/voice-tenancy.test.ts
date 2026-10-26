import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ live: vi.fn(), convs: [] as any[], next: 1000, managed: true,
  emit: vi.fn(), contactAccounts: [] as number[], scoped: undefined as any,
  participants: [] as any[], cdr: undefined as any, dbFiles: [] as any[], fsFiles: [] as any[] }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => m.managed, assertLiveBinding: m.live }));
vi.mock('../plugins/db.js', () => ({ prisma: { conversation_participants: { upsert: async (args: any) => { m.participants.push(args); return args.create; } }, conversations: {
  findUnique: async ({ where }: any) => m.convs.find(c => c.id === where.id) ?? null,
  findFirst: async ({ where }: any) => m.convs.find(c => c.account_id === where.account_id) ?? null,
  findMany: async ({ where }: any) => m.convs.filter(c => (where.account_id == null || c.account_id === where.account_id)
    && (where.assignee_id == null || c.assignee_id === where.assignee_id) && (where.status == null || c.status === where.status)),
  create: async ({ data }: any) => { const c = { id: m.next++, ...data }; m.convs.push(c); return c; },
  update: async ({ where, data }: any) => { const c = m.convs.find(c => c.id === where.id); Object.assign(c, data); return c; },
} } }));
vi.mock('../shared/services/channel-incoming.js', () => ({
  findOrCreateContact: async (account: number) => { m.contactAccounts.push(account); return { id: account + 500, name: 'fixture', phone_number: '555' }; },
  findOrCreateContactInbox: async (inbox: number, contact: number) => ({ id: inbox + contact }),
  findOrCreateOpenConversation: async (account: number, inbox: number, contact: number, ci: number, attrs: unknown) => {
    const c = { id: m.next++, account_id: account, inbox_id: inbox, contact_id: contact, status: 0,
      additional_attributes: attrs, assignee_id: null }; m.convs.push(c); return c;
  },
}));
vi.mock('../shared/services/voice-inbox.js', () => ({ ensureVoiceInbox: async (account: number) => ({ id: account + 100 }) }));
vi.mock('../shared/services/conversation-lifecycle.js', () => ({
  asAttrMap: (v: unknown) => v ?? {}, mergeAttrs: (a: object, b: object) => ({ ...a, ...b }),
  writeSystemMessage: async () => {}, markConversationEnded: async (id: number) => { m.convs.find(c => c.id === id).status = 1; },
}));
vi.mock('../shared/services/icc-call-dal.js', () => ({ lookupCallCdr: async () => m.cdr ?? null, lookupRecordFilesByNumber: async () => m.dbFiles, lookupRecordPath: async () => null }));
vi.mock('../shared/services/recording-access.js', () => ({ listRecentRecordingFiles: async () => m.fsFiles }));
vi.mock('../shared/services/recording-match.js', () => ({ matchRecordFile: (_call: unknown, _db: unknown, fs: any[]) => fs[0]?.path ?? null }));
vi.mock('../shared/services/icc-groups-dal.js', () => ({ loadGroupsByVdnFromIccDb: async () => [], loadVdnAsrEngine: async () => 'fixture' }));
vi.mock('../shared/services/aiqc-auto-submit.js', () => ({ maybeAutoSubmitAiqc: async () => {} }));
vi.mock('../modules/access/access.scope.js', () => ({ accessScope: { getStore: () => m.scoped, run: async (ctx: unknown, fn: () => unknown) => { m.scoped = ctx; return fn(); } } }));
import { persistVoiceOffered, persistVoiceAnswered, persistVoiceEnded, conversationIdForCall } from '../shared/services/voice-session.js';

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); m.convs = []; m.next += 100; m.contactAccounts = []; m.managed = true;
  m.participants = []; m.cdr = undefined; m.dbFiles = []; m.fsFiles = [];
  m.live.mockImplementation(async (id: number) => ({ binding: { vdn_id: id === 10 ? 1 : 2, work_no: '2001', source_user_id: id + 10 },
    map: { vdn_id: id === 10 ? 1 : 2, account_id: id === 10 ? 71 : 82, enabled: true }, user: { id: id + 10 } }));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const offer = (id = 55) => ({ CallID: id, Caller: '555', Called: '9001', AgentID: 20 });
describe('CCS call persistence follows authenticated tenant ownership', () => {
  it('uses VDN account mapping for contacts, conversations and broadcasts', async () => {
    const c = await persistVoiceOffered(offer(), { userId: 20, vdnId: 2, agentId: 30 }, { emitToAccount: m.emit });
    expect(c?.account_id).toBe(82); expect(m.contactAccounts).toEqual([82]);
    expect(m.participants[0].create).toMatchObject({ account_id: 82, user_id: 20, conversation_id: c?.id });
    expect(m.emit.mock.calls.map(c => c[0])).toEqual([82]);
  });
  it('same numeric CallID in two VDNs cannot overwrite or answer the other conversation', async () => {
    const a = await persistVoiceOffered(offer(77), { userId: 10, vdnId: 1, agentId: 20 });
    const b = await persistVoiceOffered(offer(77), { userId: 20, vdnId: 2, agentId: 30 });
    await persistVoiceAnswered({ CallID: 77 }, { userId: 20, vdnId: 2 });
    expect(m.convs.find(c => c.id === b?.id)?.additional_attributes).toHaveProperty('answered_at');
    expect(m.convs.find(c => c.id === a?.id)?.additional_attributes).not.toHaveProperty('answered_at');
    expect(conversationIdForCall(77, { accountId: 71, vdnId: 1 })).toBe(a?.id);
    expect(conversationIdForCall(77, { accountId: 82, vdnId: 2 })).toBe(b?.id);
    expect(conversationIdForCall(77)).toBeUndefined();
  });
  it('rejects stale/foreign event VDN before creating any conversation', async () => {
    await expect(persistVoiceOffered(offer(), { userId: 10, vdnId: 2 })).rejects.toMatchObject({ statusCode: 403 });
    expect(m.convs).toEqual([]);
  });
  it('revoked membership cannot create, answer or end calls', async () => {
    m.live.mockRejectedValue(Object.assign(new Error('revoked'), { statusCode: 403 }));
    await expect(persistVoiceOffered(offer(), { userId: 10, vdnId: 1 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(persistVoiceAnswered(offer(), { userId: 10, vdnId: 1 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(persistVoiceEnded(offer(), {}, { userId: 10, vdnId: 1 })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('same-number filesystem recordings cannot be attached without tenant-owned CDR evidence', async () => {
    const c = await persistVoiceOffered(offer(90), { userId: 10, vdnId: 1, agentId: 20 });
    m.cdr = { callerNo: '555', beginTime: new Date(), talkTimeLong: 5 };
    m.fsFiles = [{ path: '/recordings/foreign-vdn-same-phone.wav' }];
    await persistVoiceEnded(offer(90), {}, { userId: 10, vdnId: 1, agentId: 20 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.convs.find(row => row.id === c?.id)?.additional_attributes).not.toHaveProperty('recording_path');
  });
});
