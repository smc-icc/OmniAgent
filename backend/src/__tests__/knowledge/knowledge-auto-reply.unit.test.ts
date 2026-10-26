import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ conv: vi.fn(), trigger: vi.fn(), existing: vi.fn(), create: vi.fn(), claim: vi.fn(),
  update: vi.fn(), convUpdate: vi.fn(), ask: vi.fn(), revalidate: vi.fn(), dispatch: vi.fn(), audit: vi.fn(), emit: vi.fn(), transaction: vi.fn() }));
vi.mock('../../plugins/db.js', () => ({ prisma: {
  conversations: { findFirst: m.conv, updateMany: m.convUpdate },
  messages: { findUnique: m.existing, findUniqueOrThrow: m.existing, findFirst: m.trigger, create: m.create, updateMany: m.claim, update: m.update },
  knowledge_audit_events: { create: m.audit }, $transaction: m.transaction,
} }));
vi.mock('../../modules/access/access.scope.js', () => ({ accessScope: { exit: (f: any) => f() } }));
vi.mock('../../modules/knowledge/knowledge.service.js', () => ({ askConversationKnowledge: m.ask, revalidateConversationKnowledge: m.revalidate }));
vi.mock('../../shared/services/channel-outgoing.js', () => ({ dispatchOutgoingMessage: m.dispatch }));
vi.mock('../../processors/socket-ref.js', () => ({ ioRef: { get: () => ({ to: () => ({ emit: m.emit }) }) } }));
import { runAiAutoReplyJob } from '../../shared/services/ai-auto-reply.js';
import { prisma } from '../../plugins/db.js';
const job = { account_id: 1, conversation_id: 2, message_id: 3 };
const conversation = () => ({ id: 2, account_id: 1, inbox_id: 4, assignee_id: 5, status: 0,
  inbox: { account_id: 1 }, custom_attributes: { ai_auto_reply: true }, updated_at: new Date(0) });
const reply = () => ({ id: 6, account_id: 1, conversation_id: 2, inbox_id: 4, sender_id: 5, content: '[1] ICC-TEST-42',
  created_at: new Date(), content_attributes: { kind: 'ai_auto', delivery_state: 'pending', sources: [{ documentId: 'doc', versionId: 'ver' }] } });
describe('grounded background auto replies', () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.conv.mockImplementation(async () => conversation());
    m.trigger.mockImplementation(async () => ({ id: 3, content: '资料编号？' }));
    m.existing.mockResolvedValue(null); m.create.mockImplementation(async () => reply());
    m.existing.mockResolvedValueOnce(null).mockResolvedValue(reply());
    m.update.mockImplementation(async ({ data }: any) => ({ ...reply(), ...data }));
    m.claim.mockResolvedValue({ count: 1 }); m.convUpdate.mockResolvedValue({ count: 1 });
    m.ask.mockResolvedValue({ answered: true, answer: '[1] ICC-TEST-42', sources: [{ documentId: 'doc', versionId: 'ver' }] });
    m.revalidate.mockResolvedValue({ accountId: 1, vdnId: 7, userId: 5 });
    m.transaction.mockImplementation((work: any) => work(prisma));
  });
  it('derives identity from the persisted assignee, preserves citations, dispatches and emits once', async () => {
    expect((await runAiAutoReplyJob(job)).ok).toBe(true);
    expect(m.ask).toHaveBeenCalledWith(1, 2, 5, '资料编号？');
    expect(m.create.mock.calls[0][0].data).toMatchObject({ knowledge_trigger_id: 3, account_id: 1,
      content_attributes: { mode: 'knowledge_extractive', vdn_id: 7 } });
    expect(m.revalidate).toHaveBeenCalledTimes(2); expect(m.dispatch).toHaveBeenCalledWith(2, 6, '[1] ICC-TEST-42');
    expect(m.emit).toHaveBeenCalledTimes(1);
  });
  it('rejects missing trigger ids instead of choosing an arbitrary incoming message', async () => {
    expect((await runAiAutoReplyJob({ ...job, message_id: undefined })).reason).toBe('invalid_trigger');
    expect(m.conv).not.toHaveBeenCalled(); expect(m.ask).not.toHaveBeenCalled();
  });
  it.each([null, { ...conversation(), assignee_id: null }, { ...conversation(), status: 1 },
    { ...conversation(), custom_attributes: { ai_auto_reply: false } }, { ...conversation(), inbox: { account_id: 9 } }])('refuses invalid conversations %j', async c => {
    m.conv.mockResolvedValue(c); expect((await runAiAutoReplyJob(job)).ok).toBe(false);
    expect(m.ask).not.toHaveBeenCalled(); expect(m.dispatch).not.toHaveBeenCalled();
  });
  it('constrains both trigger and conversation by tenant, privacy and sender', async () => {
    m.trigger.mockResolvedValue(null); await runAiAutoReplyJob(job);
    expect(m.conv.mock.calls[0][0].where).toEqual({ id: 2, account_id: 1 });
    expect(m.trigger.mock.calls[0][0].where).toMatchObject({ id: 3, account_id: 1, conversation_id: 2, private: false, message_type: 0, sender_type: 'Contact' });
  });
  it('does not answer a superseded customer message', async () => {
    m.trigger.mockResolvedValueOnce({ id: 3, content: 'question' }).mockResolvedValue({ id: 7 });
    expect((await runAiAutoReplyJob(job)).ok).toBe(false); expect(m.ask).not.toHaveBeenCalled();
  });
  it('has no generative fallback when the authorized corpus has no answer', async () => {
    m.ask.mockResolvedValue({ answered: false, sources: [] });
    expect((await runAiAutoReplyJob(job)).reason).toBe('no_authorized_answer'); expect(m.create).not.toHaveBeenCalled();
  });
  it('suppresses replies if live authorization is revoked during retrieval', async () => {
    m.revalidate.mockRejectedValue(Object.assign(new Error('revoked'), { statusCode: 403 }));
    expect((await runAiAutoReplyJob(job)).ok).toBe(false); expect(m.create).not.toHaveBeenCalled(); expect(m.dispatch).not.toHaveBeenCalled();
  });
  it('suppresses a pending reply if sources are withdrawn before dispatch', async () => {
    m.revalidate.mockResolvedValueOnce({ accountId: 1, vdnId: 7 }).mockRejectedValueOnce(new Error('withdrawn'));
    expect((await runAiAutoReplyJob(job)).reason).toBe('authorization_changed');
    expect(m.claim.mock.calls[0][0].data).toMatchObject({ private: true, content_attributes: { delivery_state: 'suppressed' } });
    expect(m.dispatch).not.toHaveBeenCalled();
  });
  it.each(['delivered', 'sending', 'uncertain', 'failed', 'suppressed'])('never redispatches %s replies on retry', async state => {
    m.existing.mockReset().mockResolvedValue({ ...reply(), content_attributes: { delivery_state: state } });
    await runAiAutoReplyJob(job); expect(m.ask).not.toHaveBeenCalled(); expect(m.dispatch).not.toHaveBeenCalled();
  });
  it('recovers a pending reply without regenerating it', async () => {
    m.existing.mockReset().mockResolvedValue(reply());
    expect((await runAiAutoReplyJob(job)).ok).toBe(true); expect(m.ask).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it('does not send when another delivery worker won the CAS claim', async () => {
    m.claim.mockResolvedValue({ count: 0 }); await runAiAutoReplyJob(job); expect(m.dispatch).not.toHaveBeenCalled();
  });
  it('records an ambiguous network failure and does not pretend delivery succeeded', async () => {
    m.dispatch.mockRejectedValue(new Error('timeout')); expect((await runAiAutoReplyJob(job)).reason).toBe('delivery_uncertain');
    expect(m.update.mock.calls[0][0].data.content_attributes.delivery_state).toBe('uncertain');
  });
  it('refuses a unique-trigger record belonging to a different tenant', async () => {
    m.existing.mockReset().mockResolvedValue({ ...reply(), account_id: 9 });
    expect((await runAiAutoReplyJob(job)).reason).toBe('tenant_mismatch'); expect(m.dispatch).not.toHaveBeenCalled();
  });
});
