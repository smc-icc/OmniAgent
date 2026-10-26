import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { agentDbg } from '../itr/debug-ingest.js';

function isContactEmailConflict(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } } | null;
  const target = e?.meta?.target;
  return e?.code === 'P2002' && (target === 'uniq_email_per_account_contact'
    || (Array.isArray(target) && target.includes('email') && target.includes('account_id')));
}

// ── Widget Token Service ──
// Keep the existing opaque token format so active visitors retain their identity.

function generateWidgetToken(sourceId: string, inboxId: number, hmacToken: string): string {
  const payload = `${sourceId}:${inboxId}:${Date.now()}`;
  const signature = createHash('sha256').update(`${payload}${hmacToken}`).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

function verifyWidgetToken(token: string, hmacToken: string): { source_id: string; inbox_id: number } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 4 || !parts[0] || !/^[1-9]\d*$/.test(parts[1]) || !/^\d+$/.test(parts[2])) return null;
    const signature = parts.pop();
    const sourceId = parts[0];
    const inboxId = parseInt(parts[1], 10);
    const payload = parts.join(':');

    const expected = createHash('sha256').update(`${payload}${hmacToken}`).digest('hex');
    if (!signature || !/^[a-f0-9]{64}$/.test(signature)
      || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
      || !Number.isSafeInteger(inboxId)) return null;

    return { source_id: sourceId, inbox_id: inboxId };
  } catch {
    return null;
  }
}

// ── Widget Auth Helper ──
// Loads contact and inbox from bearer token (X-Auth-Token header or query param)

async function loadWidgetContext(request: FastifyRequest): Promise<{
  contact: { id: number; name: string; email: string } | null;
  inbox: { id: number; account_id: number } | null;
  contactInbox: Record<string, unknown> | null;
  webWidget: Record<string, unknown> | null;
}> {
  const authHeader = request.headers['x-auth-token'] as string
    || (request.query as Record<string, string>)?.cw_token
    || '';

  if (!authHeader) {
    return { contact: null, inbox: null, contactInbox: null, webWidget: null };
  }

  const websiteToken = (request.headers['x-website-token'] as string)
    || (request.query as Record<string, string>)?.website_token
    || '';

  // An untrusted inbox selector is only used to locate the verification key.
  const parts = Buffer.from(authHeader, 'base64url').toString('utf8').split(':');
  const inboxId = Number(parts[1]);
  const empty = { contact: null, inbox: null, contactInbox: null, webWidget: null };
  if (!Number.isSafeInteger(inboxId) || inboxId <= 0) return empty;
  const inbox = await prisma.inboxes.findUnique({ where: { id: inboxId } });
  if (!inbox || inbox.channel_type !== 'Channel::WebWidget') return empty;
  const webWidget = await prisma.channel_web_widgets.findFirst({ where: {
    id: inbox.channel_id, account_id: inbox.account_id,
    ...(websiteToken ? { website_token: websiteToken } : {}),
  } });

  if (!webWidget?.hmac_token) {
    return { contact: null, inbox: null, contactInbox: null, webWidget: null };
  }

  const payload = verifyWidgetToken(authHeader, webWidget.hmac_token as string);
  if (!payload) {
    return { contact: null, inbox: null, contactInbox: null, webWidget: null };
  }

  const contactInbox = await prisma.contact_inboxes.findFirst({
    where: {
      source_id: payload.source_id,
      inbox_id: payload.inbox_id,
    },
  });

  const contact = contactInbox
    ? await prisma.contacts.findUnique({ where: { id: contactInbox.contact_id as number } })
    : null;

  if (!contact || contact.account_id !== inbox.account_id || payload.inbox_id !== inbox.id) return empty;

  return {
    contact: contact ? { id: contact.id as number, name: contact.name as string, email: contact.email as string } : null,
    inbox,
    contactInbox: contactInbox as Record<string, unknown> | null,
    webWidget: webWidget as Record<string, unknown> | null,
  };
}

// ── Helpers ──

async function ownedConversation(request: FastifyRequest, reply: FastifyReply, rawId: unknown) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.contact || !ctx.inbox) {
    reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  const id = Number(rawId);
  const conv = Number.isSafeInteger(id) && id > 0
    ? await prisma.conversations.findFirst({ where: {
      id, account_id: ctx.inbox.account_id, inbox_id: ctx.inbox.id, contact_id: ctx.contact.id,
    } }) : null;
  if (!conv) {
    reply.status(404).send({ error: 'Conversation not found' });
    return null;
  }
  return { ctx: { ...ctx, contact: ctx.contact, inbox: ctx.inbox }, conv };
}

const customerVisible = {
  private: false,
  OR: [{ knowledge_trigger_id: null }, { content_attributes: { path: ['delivery_state'], equals: 'delivered' } }],
};

async function enqueueKnowledgeReply(request: FastifyRequest, conversation: { id: number; account_id: number; custom_attributes: unknown }, messageId: number) {
  if ((conversation.custom_attributes as Record<string, unknown> | null)?.ai_auto_reply === true) {
    await request.server.enqueue('conversation', 'ai_auto_reply', {
      account_id: conversation.account_id, conversation_id: conversation.id, message_id: messageId,
    });
  }
}

function formatWidgetMessage(m: Record<string, unknown>) {
  return {
    id: m.id,
    content: m.content,
    message_type: ['incoming', 'outgoing', 'activity', 'template'][m.message_type as number] ?? 'outgoing',
    content_type: ['text', 'input_select', 'cards', 'form'][m.content_type as number] ?? 'text',
    content_attributes: m.content_attributes,
    conversation_id: m.conversation_id,
    created_at: (m.created_at as Date)?.getTime(),
    sender_type: m.sender_type,
  };
}

function formatWidgetConversation(c: Record<string, unknown>) {
  return {
    id: c.id,
    status: ['open', 'resolved', 'pending', 'snoozed'][c.status as number] ?? 'open',
    inbox_id: c.inbox_id,
    contact_last_seen_at: c.contact_last_seen_at,
    agent_last_seen_at: c.agent_last_seen_at,
    last_activity_at: (c.last_activity_at as Date)?.getTime(),
    created_at: (c.created_at as Date)?.getTime(),
    meta: c.additional_attributes,
    custom_attributes: c.custom_attributes,
  };
}

// ── Config ──

/** POST /public/api/v1/widget/config */
export async function widgetConfig(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as {
    website_token?: string;
    contact?: { name?: string; email?: string; phone_number?: string };
    custom_attributes?: Record<string, unknown>;
  };

  const websiteToken = body.website_token;
  if (!websiteToken) {
    return reply.status(422).send({ error: 'website_token is required' });
  }

  const webWidget = await prisma.channel_web_widgets.findFirst({
    where: { website_token: websiteToken },
  });

  if (!webWidget) {
    return reply.status(404).send({ error: 'Widget not found' });
  }

  const inbox = await prisma.inboxes.findFirst({ where: {
    channel_id: webWidget.id, channel_type: 'Channel::WebWidget', account_id: webWidget.account_id ?? -1,
  } });
  if (!inbox || !webWidget.hmac_token) return reply.status(503).send({ error: 'Widget is not configured' });
  const inboxId = inbox.id;
  const accountId = inbox.account_id;
  const hmacToken = webWidget.hmac_token as string;

  // An email supplied by a visitor is not proof of an existing contact's identity.
  let contact: Record<string, unknown> | null = null;
  const existing = await loadWidgetContext(request);
  if (existing.contact && existing.inbox?.id === inboxId) {
    contact = existing.contact;
  }

  if (!contact) {
    const data = {
      account_id: accountId,
      name: body.contact?.name ?? 'Anonymous',
      email: body.contact?.email ?? `${randomBytes(8).toString('hex')}@widget.local`,
      phone_number: body.contact?.phone_number ?? '',
      custom_attributes: (body.custom_attributes ?? {}) as object,
    };
    try {
      contact = await prisma.contacts.create({ data }) as unknown as Record<string, unknown>;
    } catch (error) {
      if (!isContactEmailConflict(error)) throw error;
      // A claimed email is not identity proof, including simultaneous signups.
      contact = await prisma.contacts.create({ data: { ...data, email: null,
        additional_attributes: { widget_unverified_email: data.email } } }) as unknown as Record<string, unknown>;
    }
  }

  // Find or create contact_inbox
  let contactInbox = await prisma.contact_inboxes.findFirst({
    where: {
      contact_id: contact.id as number,
      inbox_id: inboxId,
    },
  });

  if (!contactInbox) {
    const sourceId = randomBytes(16).toString('hex');
    contactInbox = await prisma.contact_inboxes.create({
      data: {
        contact_id: contact.id as number,
        inbox_id: inboxId,
        source_id: sourceId,
      },
    });

    const widgetToken = generateWidgetToken(sourceId, inboxId, hmacToken);

    return reply.status(200).send({
      widget_color: webWidget.widget_color,
      welcome_title: webWidget.welcome_title,
      welcome_tagline: webWidget.welcome_tagline,
      reply_time: webWidget.reply_time,
      pre_chat_form_enabled: webWidget.pre_chat_form_enabled,
      pre_chat_form_options: webWidget.pre_chat_form_options,
      feature_flags: webWidget.feature_flags,
      continuity_via_email: webWidget.continuity_via_email,
      hmac_mandatory: webWidget.hmac_mandatory,
      contact: { pubsub_token: widgetToken, id: contact.id, name: contact.name, email: contact.email },
    });
  }

  const widgetToken = generateWidgetToken(
    contactInbox.source_id as string,
    inboxId,
    hmacToken,
  );

  return reply.status(200).send({
    widget_color: webWidget.widget_color,
    welcome_title: webWidget.welcome_title,
    welcome_tagline: webWidget.welcome_tagline,
    reply_time: webWidget.reply_time,
    pre_chat_form_enabled: webWidget.pre_chat_form_enabled,
    pre_chat_form_options: webWidget.pre_chat_form_options,
    feature_flags: webWidget.feature_flags,
    continuity_via_email: webWidget.continuity_via_email,
    hmac_mandatory: webWidget.hmac_mandatory,
    contact: { pubsub_token: widgetToken, id: contact.id, name: contact.name, email: contact.email },
  });
}

// ── Conversations ──

/** GET /public/api/v1/widget/conversations */
export async function widgetConversations(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.contact || !ctx.inbox) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const conversations = await prisma.conversations.findMany({
    where: {
      account_id: ctx.inbox.account_id,
      inbox_id: ctx.inbox.id,
      contact_id: ctx.contact.id,
    },
    orderBy: { last_activity_at: 'desc' },
    take: 25,
  });

  return reply.status(200).send({
    payload: conversations.map((c) => formatWidgetConversation(c as unknown as Record<string, unknown>)),
  });
}

/** POST /public/api/v1/widget/conversations */
export async function widgetCreateConversation(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.contact || !ctx.inbox || !ctx.webWidget) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const body = request.body as {
    message?: { content?: string; type?: string };
    custom_attributes?: Record<string, unknown>;
  };

  // Prevent duplicate open conversations for lock_to_single_conversation
  const inbox = await prisma.inboxes.findUnique({
    where: { id: ctx.inbox.id },
    select: { lock_to_single_conversation: true },
  });

  if (inbox?.lock_to_single_conversation) {
    const existing = await prisma.conversations.findFirst({
      where: {
        account_id: ctx.inbox.account_id,
        inbox_id: ctx.inbox.id,
        contact_id: ctx.contact.id,
        status: 0, // open
      },
    });
    if (existing) {
      // #region agent log
      agentDbg('G', 'widget.controller.ts:create.reuse', 'reused open conversation', {
        conversationId: existing.id,
        contactId: ctx.contact.id,
      });
      // #endregion
      return reply.status(200).send(formatWidgetConversation(existing as unknown as Record<string, unknown>));
    }
  }

  const accId = ctx.inbox.account_id;
  const last = await prisma.conversations.findFirst({
    where: { account_id: accId },
    orderBy: { display_id: 'desc' },
    select: { display_id: true },
  });
  const displayId = (last?.display_id ?? 0) + 1;

  const conversation = await prisma.conversations.create({
    data: {
      account_id: accId,
      inbox_id: ctx.inbox.id,
      contact_id: ctx.contact.id,
      contact_inbox_id: ctx.contactInbox?.id as number,
      display_id: displayId,
      status: 0,
      additional_attributes: (body.custom_attributes ?? {}) as object,
      contact_last_seen_at: new Date(),
    },
  });

  // Create initial message if provided
  if (body.message?.content) {
    const msg = await prisma.messages.create({
      data: {
        account_id: accId,
        inbox_id: ctx.inbox.id,
        conversation_id: conversation.id,
        content: body.message.content,
        message_type: 0, // incoming
        content_type: 0, // text
        sender_type: 'Contact',
        sender_id: ctx.contact.id,
      },
    });

    // Emit real-time event
    request.server.emitToAccount(accId, 'message.created', {
      conversation_id: conversation.id,
      message_id: msg.id,
    });

    const { emitConversationUnreadChanged } = await import('../../shared/services/conversation-unread.js');
    emitConversationUnreadChanged(
      request.server.emitToAccount.bind(request.server),
      accId,
      conversation.id,
    ).catch(() => {});

    // Enqueue webhook
    request.server.enqueue('webhook', 'message_created', {
      account_id: accId,
      conversation_id: conversation.id,
      message_id: msg.id,
    }).catch(() => {});
    await enqueueKnowledgeReply(request, conversation, msg.id);
  }

  request.server.emitToAccount(accId, 'conversation.created',
    formatWidgetConversation(conversation as unknown as Record<string, unknown>));

  // 进线自动启 ITR；预填问候不当成菜单输入（否则会立刻「输入无效」）
  try {
    const { autoStartItrForConversation } = await import('../itr/itr-lifecycle.js');
    await autoStartItrForConversation({
      conversationId: conversation.id,
      contactId: ctx.contact!.id as number,
      inboxId: ctx.inbox!.id,
      channelType: 'Channel::WebWidget',
    });
  } catch {
    /* ITR optional */
  }

  // #region agent log
  agentDbg('G', 'widget.controller.ts:create.new', 'new conversation after autoStart', {
    conversationId: conversation.id,
    contactId: ctx.contact.id,
  });
  // #endregion

  return reply.status(200).send(formatWidgetConversation(conversation as unknown as Record<string, unknown>));
}

/** POST /public/api/v1/widget/conversations/:id/toggle_typing */
export async function widgetToggleTyping(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const owned = await ownedConversation(request, reply, id);
  if (!owned) return;
  const { typing_status } = (request.body as { typing_status?: string }) || {};

  request.server.io.to(`conversation:${owned.conv.id}`).emit(
    typing_status === 'on' ? 'typing.on' : 'typing.off',
    { conversation_id: owned.conv.id, user_type: 'contact' },
  );

  return reply.status(200).send({ success: true });
}

/** POST /public/api/v1/widget/conversations/:id/update_last_seen */
export async function widgetUpdateLastSeen(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const owned = await ownedConversation(request, reply, id);
  if (!owned) return;
  await prisma.conversations.update({
    where: { id: owned.conv.id, account_id: owned.ctx.inbox.account_id, contact_id: owned.ctx.contact.id, inbox_id: owned.ctx.inbox.id },
    data: { contact_last_seen_at: new Date() },
  });
  return reply.status(200).send({ success: true });
}

/** GET /public/api/v1/widget/conversations/:id/toggle_status */
export async function widgetToggleStatus(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const owned = await ownedConversation(request, reply, id);
  if (!owned) return;
  const { conv } = owned;

  const isOpen = conv?.status === 0;
  await prisma.conversations.update({
    where: { id: conv.id, account_id: owned.ctx.inbox.account_id, contact_id: owned.ctx.contact.id, inbox_id: owned.ctx.inbox.id },
    data: { status: isOpen ? 1 : 0 }, // toggle between open and resolved
  });

  return reply.status(200).send({ success: true, status: isOpen ? 'resolved' : 'open' });
}

/** POST /public/api/v1/widget/conversations/:id/transcript */
export async function widgetTranscript(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const owned = await ownedConversation(request, reply, id);
  if (!owned) return;
  const { email } = (request.body as { email?: string }) || {};

  const messages = await prisma.messages.findMany({
    where: { conversation_id: owned.conv.id, account_id: owned.ctx.inbox.account_id, inbox_id: owned.ctx.inbox.id, ...customerVisible },
    orderBy: { created_at: 'asc' },
    select: { content: true, created_at: true, message_type: true },
  });

  const transcript = messages
    .map((m) => `[${m.created_at.toISOString()}] ${m.message_type === 1 ? 'Agent' : 'You'}: ${m.content}`)
    .join('\n');

  // Send transcript via email if provided
  if (email) {
    request.server.enqueue('email', 'send_email', {
      to: email,
      subject: 'Conversation Transcript',
      html: `<pre>${transcript.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`,
    }).catch(() => {});
  }

  return reply.status(200).send({ transcript });
}

/** POST /public/api/v1/widget/conversations/:id/set_custom_attributes */
export async function widgetSetCustomAttributes(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const owned = await ownedConversation(request, reply, id);
  if (!owned) return;
  const body = request.body as { custom_attributes?: Record<string, unknown> };

  const changed = await prisma.conversations.updateMany({
    where: { id: owned.conv.id, account_id: owned.ctx.inbox.account_id, contact_id: owned.ctx.contact.id, inbox_id: owned.ctx.inbox.id,
      updated_at: owned.conv.updated_at },
    data: { custom_attributes: { ...(owned.conv.custom_attributes as object), widget: (body.custom_attributes ?? {}) as object } },
  });
  if (!changed.count) return reply.status(409).send({ error: 'Conversation changed; retry the update' });

  return reply.status(200).send({ success: true });
}

// ── Messages ──

/** GET /public/api/v1/widget/messages/:conversation_id */
export async function widgetMessages(request: FastifyRequest, reply: FastifyReply) {
  const { conversation_id } = request.params as { conversation_id: string };
  const owned = await ownedConversation(request, reply, conversation_id);
  if (!owned) return;
  const query = request.query as { before?: string; after?: string };

  const convId = parseInt(conversation_id, 10);
  const where: Record<string, unknown> = {
    conversation_id: convId,
    account_id: owned.ctx.inbox.account_id,
    inbox_id: owned.ctx.inbox.id,
    ...customerVisible,
    message_type: { not: 2 }, // exclude activity messages
  };

  if (query.before) {
    where.created_at = { lt: new Date(parseInt(query.before, 10)) };
  }
  if (query.after) {
    where.created_at = { gt: new Date(parseInt(query.after, 10)) };
  }

  const messages = await prisma.messages.findMany({
    where: where as object,
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  const payload = messages.reverse().map((m) => formatWidgetMessage(m as unknown as Record<string, unknown>));
  // #region agent log
  agentDbg('H', 'widget.controller.ts:widgetMessages', 'widget fetch payload', {
    conversationId: convId,
    before: query.before || '',
    count: payload.length,
    items: payload.map((m) => ({
      id: m.id,
      type: m.message_type,
      preview: String(m.content || '').slice(0, 40),
    })),
  });
  // #endregion

  return reply.status(200).send({
    payload,
  });
}

/** POST /public/api/v1/widget/messages */
export async function widgetCreateMessage(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.contact || !ctx.inbox) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const body = request.body as {
    content?: string;
    conversation_id?: number;
    message_type?: string;
    content_attributes?: Record<string, unknown>;
  };

  if (!body.content || !body.conversation_id) {
    return reply.status(422).send({ error: 'content and conversation_id are required' });
  }

  const owned = await ownedConversation(request, reply, body.conversation_id);
  if (!owned) return;
  const { conv } = owned;
  if (typeof body.content !== 'string' || (body.message_type && body.message_type !== 'incoming')) {
    return reply.status(422).send({ error: 'Only incoming text is allowed' });
  }

  // Resolved conversations can't receive new messages
  if (conv.status === 1) {
    return reply.status(422).send({ error: 'Conversation is resolved' });
  }

  const msg = await prisma.messages.create({
    data: {
      account_id: conv.account_id,
      inbox_id: conv.inbox_id,
      conversation_id: body.conversation_id,
      content: body.content,
      message_type: 0,
      content_type: 0,
      content_attributes: (body.content_attributes ?? {}) as object,
      sender_type: 'Contact',
      sender_id: ctx.contact.id,
    },
  });

  // Update conversation timestamp
  await prisma.conversations.update({
    where: { id: body.conversation_id },
    data: { last_activity_at: new Date(), contact_last_seen_at: new Date() },
  });

  // Broadcast
  request.server.emitToAccount(conv.account_id as number, 'message.created',
    formatWidgetMessage(msg as unknown as Record<string, unknown>));

  if (msg.message_type === 0) {
    const { emitConversationUnreadChanged } = await import('../../shared/services/conversation-unread.js');
    emitConversationUnreadChanged(
      request.server.emitToAccount.bind(request.server),
      conv.account_id as number,
      body.conversation_id,
    ).catch(() => {});
  }

  // Enqueue webhook
  request.server.enqueue('webhook', 'message_created', {
    account_id: conv.account_id as number,
    conversation_id: body.conversation_id,
    message_id: msg.id,
  }).catch(() => {});
  await enqueueKnowledgeReply(request, conv, msg.id);

  // ITR 托管中：访客消息推进流程
  if (msg.message_type === 0 && body.content) {
    void import('../itr/itr-lifecycle.js')
      .then(({ relayVisitorToItr }) => relayVisitorToItr(body.conversation_id!, body.content!))
      .catch(() => {});
  }

  return reply.status(200).send(formatWidgetMessage(msg as unknown as Record<string, unknown>));
}

/** PATCH /public/api/v1/widget/messages/:id */
export async function widgetUpdateMessage(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.contact || !ctx.inbox) return reply.status(401).send({ error: 'Unauthorized' });
  const { id } = request.params as { id: string };
  const body = request.body as {
    submitted_values?: Array<{ name: string; value: string }>;
    content?: string;
  };
  const messageId = Number(id);
  const existing = Number.isSafeInteger(messageId) && messageId > 0 ? await prisma.messages.findFirst({ where: {
    id: messageId, account_id: ctx.inbox.account_id, inbox_id: ctx.inbox.id, ...customerVisible,
    conversation: { account_id: ctx.inbox.account_id, inbox_id: ctx.inbox.id, contact_id: ctx.contact.id },
  } }) : null;
  if (!existing) return reply.status(404).send({ error: 'Message not found' });
  if (existing.knowledge_trigger_id != null || (body.content && (existing.message_type !== 0
    || !['Contact', 'contact'].includes(existing.sender_type ?? '') || existing.sender_id !== ctx.contact.id))) {
    return reply.status(403).send({ error: 'Message is immutable' });
  }
  if (body.submitted_values && ![1, 3].includes(existing.content_type)) {
    return reply.status(422).send({ error: 'Message is not a form' });
  }

  const data: Record<string, unknown> = {};
  if (body.content) data.content = body.content;
  if (body.submitted_values) {
    data.content_attributes = { ...(existing.content_attributes as object), submitted_values: body.submitted_values };
  }

  if (Object.keys(data).length === 0) {
    return reply.status(422).send({ error: 'No update data provided' });
  }

  const msg = await prisma.messages.update({
    where: { id: messageId, account_id: ctx.inbox.account_id, inbox_id: ctx.inbox.id },
    data: data as object,
  });

  return reply.status(200).send(formatWidgetMessage(msg as unknown as Record<string, unknown>));
}

// ── Contact ──

/** GET /public/api/v1/widget/contact */
export async function widgetContact(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.contact) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  return reply.status(200).send({
    id: ctx.contact.id,
    name: ctx.contact.name,
    email: ctx.contact.email,
  });
}

/** PATCH /public/api/v1/widget/contact */
export async function widgetUpdateContact(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.contact) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const body = request.body as {
    name?: string;
    email?: string;
    phone_number?: string;
    custom_attributes?: Record<string, unknown>;
  };

  const data: Record<string, unknown> = {};
  if (body.name) data.name = body.name;
  if (body.email) data.email = body.email;
  if (body.phone_number) data.phone_number = body.phone_number;
  if (body.custom_attributes) data.custom_attributes = body.custom_attributes as object;

  if (Object.keys(data).length === 0) {
    return reply.status(422).send({ error: 'No update data provided' });
  }

  try {
    await prisma.contacts.update({
      where: { id: ctx.contact.id },
      data: data as object,
    });
  } catch (error) {
    if (!isContactEmailConflict(error)) throw error;
    return reply.status(409).send({ error: 'Contact email cannot be updated' });
  }

  return reply.status(200).send({
    id: ctx.contact.id,
    name: body.name ?? ctx.contact.name,
    email: body.email ?? ctx.contact.email,
  });
}

// ── Campaigns ──

/** GET /public/api/v1/widget/campaigns */
export async function widgetCampaigns(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.inbox) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const now = new Date();
  const campaigns = await prisma.campaigns.findMany({
    where: {
      account_id: ctx.inbox.account_id,
      inbox_id: ctx.inbox.id,
      enabled: true,
      campaign_type: 0, // ongoing (website campaigns)
      OR: [
        { scheduled_at: { lte: now } },
        { scheduled_at: null },
      ],
    },
    orderBy: { created_at: 'desc' },
    take: 10,
  });

  return reply.status(200).send({
    payload: campaigns.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      message: c.message,
      trigger_rules: c.trigger_rules,
      sender_id: c.sender_id,
      display_id: c.display_id,
    })),
  });
}

// ── Events ──

/** POST /public/api/v1/widget/events */
export async function widgetEvents(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as {
    name?: string;
    event_info?: Record<string, unknown>;
  };

  // Track widget events (e.g., webwidget.triggered) for analytics
  if (body.name) {
    const ctx = await loadWidgetContext(request);
    try {
      await (prisma.reporting_events as any).create({
        data: {
          name: body.name,
          value: 1,
          account_id: ctx.inbox?.account_id ?? 0,
          event_start: new Date(),
          event_end: new Date(),
        },
      });
    } catch {
      // Non-critical — don't fail the request
    }
  }

  return reply.status(200).send({ success: true });
}

// ── Inbox Members ──

/** GET /public/api/v1/widget/inbox_members */
export async function widgetInboxMembers(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.inbox) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const members = await (prisma.inbox_members as any).findMany({
    where: { inbox_id: ctx.inbox.id },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return reply.status(200).send({
    payload: members
      .filter((m: any) => m.user)
      .map((m: any) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      })),
  });
}

// ── Direct Uploads ──

/** POST /public/api/v1/widget/direct_uploads */
export async function widgetDirectUploads(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await loadWidgetContext(request);
  if (!ctx.contact || !ctx.inbox) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  // Return presigned URL for direct S3 upload
  // For now, return a placeholder — real implementation uses S3 plugin
  return reply.status(200).send({
    success: true,
    message: 'Direct upload support requires S3 configuration',
  });
}
