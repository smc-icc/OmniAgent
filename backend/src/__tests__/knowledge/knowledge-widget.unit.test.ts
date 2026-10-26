import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ inbox: vi.fn(), widget: vi.fn(), ci: vi.fn(), contact: vi.fn(), contactCreate: vi.fn(), contactUpdate: vi.fn(),
  conversations: vi.fn(), conversation: vi.fn(), createConversation: vi.fn(), updateConversation: vi.fn(),
  messages: vi.fn(), message: vi.fn(), create: vi.fn(), update: vi.fn(), enqueue: vi.fn(), emit: vi.fn() }));
vi.mock('../../plugins/db.js', () => ({ prisma: {
  inboxes: { findUnique: m.inbox, findFirst: m.inbox }, channel_web_widgets: { findFirst: m.widget },
  contact_inboxes: { findFirst: m.ci }, contacts: { findUnique: m.contact, create: m.contactCreate, update: m.contactUpdate },
  conversations: { findFirst: m.conversation, findMany: m.conversations, create: m.createConversation, update: m.updateConversation, updateMany: m.updateConversation },
  messages: { findMany: m.messages, findFirst: m.message, create: m.create, update: m.update },
} }));
vi.mock('../../modules/itr/debug-ingest.js', () => ({ agentDbg: vi.fn() }));
vi.mock('../../modules/itr/itr-lifecycle.js', () => ({ relayVisitorToItr: vi.fn(), autoStartItrForConversation: vi.fn() }));
vi.mock('../../shared/services/conversation-unread.js', () => ({ emitConversationUnreadChanged: vi.fn(async () => {}) }));
import * as widget from '../../modules/widget/widget.controller.js';
const conv = () => ({ id: 2, account_id: 1, inbox_id: 4, contact_id: 5, status: 0, updated_at: new Date(0), custom_attributes: { ai_auto_reply: true, internal: 'retained' } });
function request(extra: any = {}) {
  const payload = 'visitor:4:1700000000000';
  const token = Buffer.from(`${payload}:${createHash('sha256').update(payload + 'secret').digest('hex')}`).toString('base64url');
  return { headers: { 'x-auth-token': token, 'x-website-token': 'website' }, query: {}, params: { id: '2', conversation_id: '2' },
    body: {}, server: { enqueue: m.enqueue, emitToAccount: m.emit, io: { to: () => ({ emit: m.emit }) } }, ...extra } as any;
}
function reply() { const r: any = { statusCode: 200, status: vi.fn((s: number) => { r.statusCode = s; return r; }), send: vi.fn() }; return r; }
describe('real widget knowledge ingress and isolation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.inbox.mockResolvedValue({ id: 4, channel_id: 40, account_id: 1, channel_type: 'Channel::WebWidget' });
    m.widget.mockResolvedValue({ id: 40, account_id: 1, website_token: 'website', hmac_token: 'secret' });
    m.ci.mockResolvedValue({ id: 6, contact_id: 5, inbox_id: 4, source_id: 'visitor' });
    m.contact.mockResolvedValue({ id: 5, account_id: 1, name: 'Visitor', email: 'visitor@example.test' });
    m.contactCreate.mockResolvedValue({ id: 9, account_id: 1, name: 'New visitor' });
    m.conversation.mockResolvedValue(conv()); m.createConversation.mockResolvedValue(conv());
    m.updateConversation.mockResolvedValue({ count: 1 });
    m.messages.mockResolvedValue([]); m.create.mockImplementation(async ({ data }: any) => ({ id: 7, created_at: new Date(), ...data }));
    m.enqueue.mockResolvedValue(undefined);
  });
  it('stores canonical Contact identity and queues a real incoming widget message', async () => {
    const r = reply(); await widget.widgetCreateMessage(request({ body: { content: '资料编号？', conversation_id: 2 } }), r);
    expect(r.statusCode).toBe(200);
    expect(m.create.mock.calls[0][0].data).toMatchObject({ account_id: 1, inbox_id: 4, sender_type: 'Contact', sender_id: 5, message_type: 0 });
    expect(m.enqueue).toHaveBeenCalledWith('conversation', 'ai_auto_reply', { account_id: 1, conversation_id: 2, message_id: 7 });
    expect(m.conversation.mock.calls[0][0].where).toEqual({ id: 2, account_id: 1, inbox_id: 4, contact_id: 5 });
  });
  it('does not let a visitor impersonate an outgoing agent message', async () => {
    const r = reply(); await widget.widgetCreateMessage(request({ body: { content: 'fake', conversation_id: 2, message_type: 'outgoing' } }), r);
    expect(r.statusCode).toBe(422); expect(m.create).not.toHaveBeenCalled();
  });
  it('does not queue auto replies when the persisted switch is disabled', async () => {
    m.conversation.mockResolvedValue({ ...conv(), custom_attributes: { ai_auto_reply: false } });
    await widget.widgetCreateMessage(request({ body: { content: 'question', conversation_id: 2 } }), reply());
    expect(m.enqueue.mock.calls.every(c => c[1] !== 'ai_auto_reply')).toBe(true);
  });
  it('sets canonical identity on the initial conversation message too', async () => {
    await widget.widgetCreateConversation(request({ body: { message: { content: 'hello' } } }), reply());
    expect(m.create.mock.calls[0][0].data).toMatchObject({ sender_type: 'Contact', sender_id: 5, message_type: 0 });
    expect(m.createConversation.mock.calls[0][0].data.contact_inbox_id).toBe(6);
  });
  const endpoints = [widget.widgetToggleTyping, widget.widgetUpdateLastSeen, widget.widgetToggleStatus,
    widget.widgetTranscript, widget.widgetSetCustomAttributes, widget.widgetMessages];
  it.each(endpoints)('rejects another contact/tenant conversation in %s', async endpoint => {
    m.conversation.mockResolvedValue(null); const r = reply(); await endpoint(request(), r);
    expect(r.statusCode).toBe(404); expect(m.messages).not.toHaveBeenCalled();
    expect(m.updateConversation).not.toHaveBeenCalled(); expect(m.emit).not.toHaveBeenCalled(); expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.conversation.mock.calls[0][0].where).toMatchObject({ account_id: 1, inbox_id: 4, contact_id: 5 });
  });
  it('rejects cross-tenant message creation', async () => {
    m.conversation.mockResolvedValue(null); const r = reply();
    await widget.widgetCreateMessage(request({ body: { content: 'attack', conversation_id: 99 } }), r);
    expect(r.statusCode).toBe(404); expect(m.create).not.toHaveBeenCalled();
  });
  it.each([widget.widgetMessages, widget.widgetTranscript])('hides private, pending and suppressed replies in %s', async endpoint => {
    await endpoint(request(), reply());
    expect(m.messages.mock.calls[0][0].where).toMatchObject({ account_id: 1, inbox_id: 4, conversation_id: 2, private: false,
      OR: [{ knowledge_trigger_id: null }, { content_attributes: { path: ['delivery_state'], equals: 'delivered' } }] });
  });
  it('namespaces visitor attributes without changing server AI controls', async () => {
    await widget.widgetSetCustomAttributes(request({ body: { custom_attributes: { ai_auto_reply: false, internal: 'overwritten' } } }), reply());
    expect(m.updateConversation.mock.calls[0][0].data.custom_attributes).toEqual({ ai_auto_reply: true, internal: 'retained',
      widget: { ai_auto_reply: false, internal: 'overwritten' } });
    expect(m.updateConversation.mock.calls[0][0].where.updated_at).toEqual(new Date(0));
  });
  it('does not overwrite a concurrent agent change to AI controls', async () => {
    m.updateConversation.mockResolvedValue({ count: 0 });
    const r = reply();
    await widget.widgetSetCustomAttributes(request({ body: { custom_attributes: { theme: 'light' } } }), r);
    expect(r.statusCode).toBe(409);
  });
  it('denies an unowned message update before writing', async () => {
    m.message.mockResolvedValue(null); const r = reply(); await widget.widgetUpdateMessage(request({ body: { content: 'overwrite' } }), r);
    expect(r.statusCode).toBe(404); expect(m.update).not.toHaveBeenCalled();
    expect(m.message.mock.calls[0][0].where.conversation).toEqual({ account_id: 1, inbox_id: 4, contact_id: 5 });
  });
  it('cannot modify the immutable knowledge delivery ledger', async () => {
    m.message.mockResolvedValue({ knowledge_trigger_id: 3 }); const r = reply();
    await widget.widgetUpdateMessage(request({ body: { content: 'overwrite' } }), r);
    expect(r.statusCode).toBe(403); expect(m.update).not.toHaveBeenCalled();
  });
  it('binds the token to the actual widget channel, not equal numeric IDs', async () => {
    await widget.widgetContact(request(), reply());
    expect(m.widget.mock.calls[0][0].where).toEqual({ id: 40, account_id: 1, website_token: 'website' });
  });
  it('denies contact-inbox records whose contact belongs to another account', async () => {
    m.contact.mockResolvedValue({ id: 5, account_id: 2 }); const r = reply(); await widget.widgetContact(request(), r);
    expect(r.statusCode).toBe(401);
  });
  it('does not recover another visitor just by claiming their email', async () => {
    await widget.widgetConfig(request({ headers: {}, body: { website_token: 'website', contact: { email: 'visitor@example.test' } } }), reply());
    expect(m.contactCreate).toHaveBeenCalled(); expect(m.inbox.mock.calls[0][0].where).toMatchObject({ channel_id: 40, account_id: 1 });
  });
  it.each([{ target: ['email', 'account_id'] }, { target: 'uniq_email_per_account_contact' }])('creates a separate unverified visitor on an email conflict: $target', async ({ target }) => {
    m.contactCreate.mockRejectedValueOnce({ code: 'P2002', meta: { target } });
    const r = reply();
    await widget.widgetConfig(request({ headers: {}, body: { website_token: 'website', contact: { email: 'visitor@example.test' } } }), r);
    expect(r.statusCode).toBe(200);
    expect(m.contactCreate).toHaveBeenCalledTimes(2);
    expect(m.contactCreate.mock.calls[1][0].data).toMatchObject({ account_id: 1, email: null,
      additional_attributes: { widget_unverified_email: 'visitor@example.test' } });
    expect(r.send.mock.calls[0][0].contact.id).toBe(9);
  });
  it('does not mask unrelated unique constraint failures as duplicate emails', async () => {
    const error = { code: 'P2002', meta: { target: ['id'] } };
    m.contactCreate.mockRejectedValueOnce(error);
    await expect(widget.widgetConfig(request({ headers: {}, body: { website_token: 'website' } }), reply())).rejects.toBe(error);
    expect(m.contactCreate).toHaveBeenCalledTimes(1);
  });
  it('returns a conflict when a visitor updates to another contact email', async () => {
    m.contactUpdate.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['email', 'account_id'] } });
    const r = reply();
    await widget.widgetUpdateContact(request({ body: { email: 'existing@example.test' } }), r);
    expect(r.statusCode).toBe(409);
    expect(m.contactUpdate.mock.calls[0][0].where).toEqual({ id: 5 });
  });
  it.each(endpoints)('requires a valid visitor token in %s', async endpoint => {
    const r = reply(); await endpoint(request({ headers: {} }), r); expect(r.statusCode).toBe(401);
  });
});
