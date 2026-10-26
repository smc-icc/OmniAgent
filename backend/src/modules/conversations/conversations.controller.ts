import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import {
  createConversationSchema, updateConversationSchema, conversationFilterSchema,
  createMessageSchema, updateMessageSchema,
  assignmentSchema, conversationLabelSchema, participantSchema,
  draftMessageSchema, customAttributesSchema, togglePrioritySchema,
  type CreateConversationInput, type CreateMessageInput,
} from '../../shared/validators/conversations.js';
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from '../../shared/errors/index.js';
import { fileExtension } from '../../shared/services/message-kind.js';
import { emitConversationUnreadChanged } from '../../shared/services/conversation-unread.js';
import { accessScope } from '../access/access.scope.js';

// ── Helpers ──

function formatConversation(c: Record<string, unknown>) {
  return {
    id: c.id, account_id: c.account_id, inbox_id: c.inbox_id,
    status: ['open', 'resolved', 'pending', 'snoozed'][c.status as number] || 'open',
    assignee_id: c.assignee_id, contact_id: c.contact_id, display_id: c.display_id,
    uuid: c.uuid, identifier: c.identifier,
    contact_last_seen_at: c.contact_last_seen_at,
    agent_last_seen_at: c.agent_last_seen_at,
    additional_attributes: c.additional_attributes, custom_attributes: c.custom_attributes,
    team_id: c.team_id, campaign_id: c.campaign_id,
    priority: c.priority != null ? ['low', 'medium', 'high', 'urgent'][c.priority as number] : null,
    snoozed_until: c.snoozed_until,
    first_reply_created_at: c.first_reply_created_at,
    waiting_since: c.waiting_since,
    created_at: (c.created_at as Date)?.getTime(),
    last_activity_at: (c.last_activity_at as Date)?.getTime(),
  };
}

function formatMessage(m: Record<string, unknown>) {
  return {
    id: m.id, content: m.content, message_type: ['incoming', 'outgoing', 'activity', 'template'][m.message_type as number] || 'outgoing',
    content_type: ['text', 'input_select', 'cards', 'form'][m.content_type as number] || 'text',
    content_attributes: m.content_attributes, private: m.private,
    sender_type: m.sender_type, sender_id: m.sender_id,
    source_id: m.source_id, status: m.status,
    conversation_id: m.conversation_id, account_id: m.account_id,
    created_at: (m.created_at as Date)?.getTime(),
  };
}

async function nextDisplayId(accountId: number): Promise<number> {
  const last = await accessScope.exit(() => prisma.conversations.findFirst({
    where: { account_id: accountId },
    orderBy: { display_id: 'desc' },
    select: { display_id: true },
  }));
  return (last?.display_id ?? 0) + 1;
}

// ── Conversations ──

/** GET /api/v1/accounts/:account_id/conversations */
export async function listConversations(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const query = request.query as { page?: string; per_page?: string; status?: string; assignee_id?: string };
  const page = parseInt(query.page ?? '1', 10);
  const perPage = Math.min(parseInt(query.per_page ?? '25', 10), 100);
  const accId = parseInt(account_id, 10);

  const where: Record<string, unknown> = { account_id: accId };
  if (query.status) where.status = { open: 0, resolved: 1, pending: 2, snoozed: 3 }[query.status] ?? 0;
  if (query.assignee_id) where.assignee_id = parseInt(query.assignee_id, 10);

  const [total, conversations] = await Promise.all([
    prisma.conversations.count({ where: where as object }),
    prisma.conversations.findMany({
      where: where as object,
      orderBy: { last_activity_at: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return reply.status(200).send({
    payload: conversations.map(formatConversation),
    meta: { current_page: page, total_count: total, per_page: perPage },
  });
}

/** POST /api/v1/accounts/:account_id/conversations */
export async function createConversation(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createConversationSchema.parse(request.body) as CreateConversationInput;
  const accId = parseInt(account_id, 10);

  const displayId = await nextDisplayId(accId);

  const conversation = await prisma.conversations.create({
    data: {
      account_id: accId,
      inbox_id: body.inbox_id,
      status: { open: 0, resolved: 1, pending: 2, snoozed: 3 }[body.status],
      assignee_id: body.assignee_id,
      contact_id: body.contact_id,
      team_id: body.team_id,
      display_id: displayId,
      priority: body.priority ? ({ low: 0, medium: 1, high: 2, urgent: 3 })[body.priority] : undefined,
      additional_attributes: body.additional_attributes as object,
    },
  });

  request.server.emitToAccount(accId, 'conversation.created', formatConversation(conversation as unknown as Record<string, unknown>));

  return reply.status(200).send(formatConversation(conversation as unknown as Record<string, unknown>));
}

/** GET /api/v1/accounts/:account_id/conversations/:id */
export async function showConversation(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const conv = await prisma.conversations.findUnique({ where: { id: parseInt(id, 10) } });
  if (!conv) throw new NotFoundError('Conversation');
  return reply.status(200).send(formatConversation(conv as unknown as Record<string, unknown>));
}

/** PUT /api/v1/accounts/:account_id/conversations/:id */
export async function updateConversation(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateConversationSchema.parse(request.body);

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = { open: 0, resolved: 1, pending: 2, snoozed: 3 }[body.status];
  if (body.assignee_id !== undefined) data.assignee_id = body.assignee_id;
  if (body.team_id !== undefined) data.team_id = body.team_id;
  if (body.priority !== undefined) data.priority = ({ low: 0, medium: 1, high: 2, urgent: 3 })[body.priority];
  if (body.additional_attributes !== undefined) data.additional_attributes = body.additional_attributes;
  if (body.custom_attributes !== undefined) data.custom_attributes = body.custom_attributes;

  const conv = await prisma.conversations.update({
    where: { id: parseInt(id, 10) },
    data: data as object,
  });

  return reply.status(200).send(formatConversation(conv as unknown as Record<string, unknown>));
}

/** DELETE /api/v1/accounts/:account_id/conversations/:id */
export async function destroyConversation(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.conversations.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/conversations/meta */
export async function conversationsMeta(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);

  const [openCount, resolvedCount, pendingCount] = await Promise.all([
    prisma.conversations.count({ where: { account_id: accId, status: 0 } }),
    prisma.conversations.count({ where: { account_id: accId, status: 1 } }),
    prisma.conversations.count({ where: { account_id: accId, status: 2 } }),
  ]);

  return reply.status(200).send({
    meta: { open_count: openCount, resolved_count: resolvedCount, pending_count: pendingCount },
  });
}

/** GET /api/v1/accounts/:account_id/conversations/search */
export async function searchConversations(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { q } = request.query as { q?: string };

  if (!q) return reply.status(200).send({ payload: [] });

  // Simple text search on messages content (PG full-text search would be better)
  const messages = await prisma.messages.findMany({
    where: {
      account_id: parseInt(account_id, 10),
      content: { contains: q, mode: 'insensitive' },
    },
    select: { conversation_id: true },
    distinct: ['conversation_id'],
    take: 50,
  });

  const conversationIds = messages.map((m) => m.conversation_id);
  const conversations = conversationIds.length > 0
    ? await prisma.conversations.findMany({ where: { id: { in: conversationIds } } })
    : [];

  return reply.status(200).send({ payload: conversations.map(formatConversation) });
}

/** POST /api/v1/accounts/:account_id/conversations/filter */
export async function filterConversations(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = conversationFilterSchema.parse(request.body);
  const accId = parseInt(account_id, 10);

  const where: Record<string, unknown> = { account_id: accId };
  if (body.status && body.status !== 'all') {
    where.status = { open: 0, resolved: 1, pending: 2, snoozed: 3 }[body.status];
  }
  if (body.assignee_id) where.assignee_id = body.assignee_id;
  if (body.inbox_id) where.inbox_id = body.inbox_id;
  if (body.team_id) where.team_id = body.team_id;

  const [total, conversations] = await Promise.all([
    prisma.conversations.count({ where: where as object }),
    prisma.conversations.findMany({
      where: where as object,
      orderBy: { last_activity_at: 'desc' },
      skip: (body.page - 1) * body.per_page,
      take: body.per_page,
    }),
  ]);

  return reply.status(200).send({
    payload: conversations.map(formatConversation),
    meta: { current_page: body.page, total_count: total },
  });
}

// ── Messages ──

/** GET /api/v1/accounts/:account_id/conversations/:id/messages */
export async function listMessages(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const query = request.query as { before?: string; after?: string };
  const convId = parseInt(id, 10);

  const where: Record<string, unknown> = { conversation_id: convId };
  if (query.before) where.created_at = { lt: new Date(parseInt(query.before, 10)) };

  const messages = await prisma.messages.findMany({
    where: where as object,
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  return reply.status(200).send({ payload: messages.reverse().map(formatMessage) });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/messages */
export async function createMessage(request: FastifyRequest, reply: FastifyReply) {
  const { account_id, id } = request.params as { account_id: string; id: string };
  const body = createMessageSchema.parse(request.body) as CreateMessageInput;
  const accId = parseInt(account_id, 10);
  const convId = parseInt(id, 10);

  const conv = await prisma.conversations.findUnique({
    where: { id: convId },
    select: { inbox_id: true, custom_attributes: true },
  });
  if (!conv) throw new NotFoundError('Conversation');

  const { filterMessageContent } = await import('../../shared/services/omni-ops.js');
  const filteredOutgoing = body.content ? await filterMessageContent(body.content) : null;
  const persistedContent = filteredOutgoing ? filteredOutgoing.text : body.content;

  const msg = await prisma.messages.create({
    data: {
      account_id: accId,
      inbox_id: conv.inbox_id,
      conversation_id: convId,
      content: persistedContent,
      message_type: { incoming: 0, outgoing: 1 }[body.message_type],
      content_type: { text: 0, input_select: 1, cards: 2, form: 3 }[body.content_type],
      content_attributes: {
        ...((body.content_attributes as Record<string, unknown>) || {}),
        ...(filteredOutgoing?.hit
          ? { sensitive_hit: true, sensitive_blocked: filteredOutgoing.blocked, sensitive_words: filteredOutgoing.words }
          : {}),
      } as object,
      private: body.private,
      source_id: body.source_id,
      sender_type: body.sender_type,
      ...(body.sender_id > 0 ? { sender_id: body.sender_id } : {}),
    },
  });

  const attrs = body.content_attributes as Record<string, unknown>;
  if (attrs?.file_url) {
    const fileName = String(attrs.file_name ?? 'file');
    await prisma.attachments.create({
      data: {
        message_id: msg.id,
        account_id: accId,
        external_url: String(attrs.file_url),
        fallback_title: fileName,
        extension: fileExtension(fileName),
        file_type: attrs.kind === 'image' ? 0 : 1,
        meta: {
          content_type: attrs.content_type,
          byte_size: attrs.byte_size,
        } as object,
      },
    });
  }

  // 坐席回复了 → 通知 ITR 把「连续超时」计数清零（坐席回过话就不算"连续未回复"了）。
  // 不 await：清计数是优化，不该拖慢或影响坐席这条消息本身。
  if (msg.message_type === 1) {
    void import('../../integrations/itr/itr-client.js')
      .then(({ itrResetTimeoutCount }) => itrResetTimeoutCount(String(convId)))
      .catch(() => {});
  }

  await prisma.conversations.update({
    where: { id: convId },
    data: { last_activity_at: new Date(), status: 0 },
  });

  request.server.emitToAccount(accId, 'message.created', formatMessage(msg as unknown as Record<string, unknown>));

  if (msg.message_type === 0) {
    emitConversationUnreadChanged(
      request.server.emitToAccount.bind(request.server),
      accId,
      convId,
    ).catch(() => {});
  }

  // Enqueue background jobs (fire-and-forget)
  request.server.enqueue('webhook', 'message_created', {
    account_id: accId, conversation_id: convId, message_id: msg.id,
  }).catch(() => {});

  // Notify assigned agent and conversation participants
  const participants = await prisma.conversation_participants.findMany({
    where: { conversation_id: convId },
    select: { user_id: true },
  });
  const assignedConv = await prisma.conversations.findUnique({
    where: { id: convId },
    select: { assignee_id: true },
  });
  const notifyUserIds = participants.map((p) => p.user_id);
  if (assignedConv?.assignee_id && !notifyUserIds.includes(assignedConv.assignee_id)) {
    notifyUserIds.push(assignedConv.assignee_id);
  }

  if (body.message_type === 'incoming' && notifyUserIds.length > 0) {
    request.server.enqueue('notification', 'message_created', {
      account_id: accId,
      user_ids: notifyUserIds,
      notification_type: 'message_created',
      meta: {
        conversation_id: convId,
        message_id: msg.id,
        primary_actor_type: 'Message',
        primary_actor_id: msg.id,
      },
    }).catch(() => {});
  }

  if (body.message_type === 'incoming') {
    const ca = (conv.custom_attributes ?? {}) as Record<string, unknown>;
    if (ca.ai_auto_reply) {
      request.server.enqueue('conversation', 'ai_auto_reply', {
        account_id: accId,
        conversation_id: convId,
        message_id: msg.id,
        assistant_id: (ca.ai_assistant_id as number | undefined) ?? null,
      }).catch(() => {});
    }
  }

  if (body.message_type === 'incoming' && body.content) {
    void import('../itr/itr-lifecycle.js')
      .then(({ relayVisitorToItr }) => relayVisitorToItr(convId, body.content))
      .catch(() => {});
  }

  if (body.message_type === 'outgoing' && !body.private) {
    import('../../shared/services/channel-outgoing.js').then(({ dispatchOutgoingMessage }) => {
      dispatchOutgoingMessage(convId, msg.id, persistedContent).catch(() => {});
    }).catch(() => {});
  }

  return reply.status(200).send(formatMessage(msg as unknown as Record<string, unknown>));
}

/** PUT /api/v1/accounts/:account_id/conversations/:id/messages/:msg_id */
export async function updateMessage(request: FastifyRequest, reply: FastifyReply) {
  const { msg_id } = request.params as { msg_id: string };
  const body = updateMessageSchema.parse(request.body);
  await requireMutableMessage(parseInt(msg_id, 10));

  const msg = await prisma.messages.update({
    where: { id: parseInt(msg_id, 10) },
    data: {
      ...(body.content !== undefined && { content: body.content }),
      ...(body.content_attributes !== undefined && { content_attributes: body.content_attributes as object }),
    },
  });

  return reply.status(200).send(formatMessage(msg as unknown as Record<string, unknown>));
}

/** DELETE /api/v1/accounts/:account_id/conversations/:id/messages/:msg_id */
export async function destroyMessage(request: FastifyRequest, reply: FastifyReply) {
  const { msg_id } = request.params as { msg_id: string };
  await requireMutableMessage(parseInt(msg_id, 10));
  await prisma.messages.delete({ where: { id: parseInt(msg_id, 10) } });
  return reply.status(200).send({ success: true });
}

async function requireMutableMessage(id: number) {
  const message = await prisma.messages.findUnique({ where: { id }, select: { knowledge_trigger_id: true } });
  if (message?.knowledge_trigger_id != null) throw new AppError(409, '知识库自动回复及投递记录不可修改、删除或重试');
}

/** POST /api/v1/accounts/:account_id/conversations/:id/messages/:msg_id/translate */
export async function translateMessage(request: FastifyRequest, reply: FastifyReply) {
  const { msg_id } = request.params as { msg_id: string };
  const body = request.body as { target_language?: string };

  const message = await prisma.messages.findUnique({
    where: { id: parseInt(msg_id, 10) },
    select: { content: true, content_type: true },
  });

  if (!message?.content) {
    return reply.status(200).send({ translated: false, message: 'No content to translate' });
  }

  const targetLang = body.target_language ?? 'en';

  // Try OpenAI translation if available
  const llm = (request.server as any).openai as
    | { translations?: { create: (params: { model: string; input: string }) => Promise<{ text: string }> } }
    | undefined;

  if (llm) {
    try {
      const prompt = `Translate the following text to ${targetLang}. Return only the translation, nothing else:\n\n${message.content}`;
      // Use chat completions for translation
      const openaiClient = (request.server as any).openaiClient as
        | { chat?: { completions?: { create: (params: unknown) => Promise<{ choices?: Array<{ message?: { content?: string } }> }> } } }
        | undefined;

      if (openaiClient?.chat?.completions) {
        const completion = await openaiClient.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1000,
        });
        const translated = completion.choices?.[0]?.message?.content;
        if (translated) {
          return reply.status(200).send({
            id: msg_id,
            content: translated,
            translated: true,
            source_language: 'auto',
            target_language: targetLang,
          });
        }
      }
    } catch {
      // Fall through to simple response if LLM fails
    }
  }

  // Fallback: return original content
  return reply.status(200).send({
    id: msg_id,
    content: message.content,
    translated: false,
    message: `Translation to ${targetLang} not available (LLM not configured)`,
  });
}

/** POST /api/v1/accounts/:account_id/translate-text */
export async function translateText(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { text?: string; target_language?: string };
  const text = body.text?.trim() ?? '';
  if (!text) {
    return reply.status(400).send({ translated: false, text: '', message: 'text is required' });
  }

  const targetLang = body.target_language ?? 'zh';
  const openaiClient = (request.server as { openaiClient?: {
    chat?: { completions?: { create: (params: unknown) => Promise<{ choices?: Array<{ message?: { content?: string } }> }> } };
  } }).openaiClient;

  if (openaiClient?.chat?.completions) {
    try {
      const prompt = `Translate the following text to ${targetLang}. Return only the translation, nothing else:\n\n${text}`;
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      });
      const translated = completion.choices?.[0]?.message?.content?.trim();
      if (translated) {
        return reply.status(200).send({
          text: translated,
          translated: true,
          target_language: targetLang,
        });
      }
    } catch {
      // fall through
    }
  }

  return reply.status(200).send({
    text,
    translated: false,
    target_language: targetLang,
    message: `Translation to ${targetLang} not available (LLM not configured)`,
  });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/messages/:msg_id/retry */
export async function retryMessage(request: FastifyRequest, reply: FastifyReply) {
  const { msg_id } = request.params as { msg_id: string };
  await requireMutableMessage(parseInt(msg_id, 10));
  await prisma.messages.update({
    where: { id: parseInt(msg_id, 10) },
    data: { status: 0 },
  });
  return reply.status(200).send({ success: true });
}

// ── Assignments ──

/** POST /api/v1/accounts/:account_id/conversations/:id/assignments */
export async function assignConversation(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { assignee_id } = assignmentSchema.parse(request.body);

  const conv = await prisma.conversations.update({
    where: { id: parseInt(id, 10) },
    data: { assignee_id, assignee_last_seen_at: new Date(), status: 0 },
  });

  request.server.emitToAccount(conv.account_id, 'conversation.assigned', { conversation_id: conv.id, assignee_id });
  // Also notify the assigned user directly
  request.server.emitToUser(assignee_id, 'conversation.assigned', { conversation_id: conv.id, assignee_id });

  return reply.status(200).send({ success: true, assignee_id });
}

// ── Labels ──

/** POST /api/v1/accounts/:account_id/conversations/:id/labels */
export async function addConversationLabels(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { labels: labelNames } = conversationLabelSchema.parse(request.body);
  const convId = parseInt(id, 10);

  // Labels are tag-based in Chatwoot — simplified: store as cached_label_list
  const conv = await prisma.conversations.findUnique({ where: { id: convId }, select: { cached_label_list: true } });
  const existing = conv?.cached_label_list ? conv.cached_label_list.split(',').map((s: string) => s.trim()) : [];
  const merged = [...new Set([...existing, ...labelNames])];

  await prisma.conversations.update({
    where: { id: convId },
    data: { cached_label_list: merged.join(', ') },
  });

  return reply.status(200).send({ payload: merged });
}

/** GET /api/v1/accounts/:account_id/conversations/:id/labels */
export async function listConversationLabels(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const conv = await prisma.conversations.findUnique({
    where: { id: parseInt(id, 10) },
    select: { cached_label_list: true },
  });
  const labels = conv?.cached_label_list ? conv.cached_label_list.split(',').map((s: string) => s.trim()) : [];
  return reply.status(200).send({ payload: labels });
}

// ── Participants ──

/** GET /api/v1/accounts/:account_id/conversations/:id/participants */
export async function showParticipants(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const participants = await prisma.conversation_participants.findMany({
    where: { conversation_id: parseInt(id, 10) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return reply.status(200).send({
    payload: participants.map((p) => ({ id: p.user?.id, name: p.user?.name, email: p.user?.email })),
  });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/participants */
export async function addParticipants(request: FastifyRequest, reply: FastifyReply) {
  const { account_id, id } = request.params as { account_id: string; id: string };
  const { user_ids } = participantSchema.parse(request.body);
  const accId = parseInt(account_id, 10);
  const convId = parseInt(id, 10);

  for (const uid of user_ids) {
    const exists = await prisma.conversation_participants.findFirst({
      where: { conversation_id: convId, user_id: uid },
    });
    if (!exists) {
      await prisma.conversation_participants.create({
        data: { account_id: accId, user_id: uid, conversation_id: convId },
      });
    }
  }

  return reply.status(200).send({ success: true });
}

/** PUT /api/v1/accounts/:account_id/conversations/:id/participants */
export async function updateParticipants(request: FastifyRequest, reply: FastifyReply) {
  const { account_id, id } = request.params as { account_id: string; id: string };
  const { user_ids } = participantSchema.parse(request.body);
  const accId = parseInt(account_id, 10);
  const convId = parseInt(id, 10);

  await prisma.conversation_participants.deleteMany({ where: { conversation_id: convId } });
  for (const uid of user_ids) {
    await prisma.conversation_participants.create({
      data: { account_id: accId, user_id: uid, conversation_id: convId },
    });
  }

  return reply.status(200).send({ success: true });
}

/** DELETE /api/v1/accounts/:account_id/conversations/:id/participants */
export async function removeParticipants(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { user_ids } = request.body as { user_ids?: number[] };
  if (user_ids?.length) {
    await prisma.conversation_participants.deleteMany({
      where: { conversation_id: parseInt(id, 10), user_id: { in: user_ids } },
    });
  }
  return reply.status(200).send({ success: true });
}

// ── Draft Messages ──
// Per-user per-conversation drafts stored in-memory (use Redis for production)

const draftStore = new Map<string, { content: string; updated_at: number }>();

function draftKey(userId: number, conversationId: number): string {
  return `${userId}:${conversationId}`;
}

/** GET /api/v1/accounts/:account_id/conversations/:id/draft_messages */
export async function showDraftMessage(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = request.currentUser as { id: number } | null;
  if (!user) return reply.status(200).send({ content: '', conversation_id: parseInt(id, 10) });

  const key = draftKey(user.id, parseInt(id, 10));
  const draft = draftStore.get(key);
  return reply.status(200).send({
    content: draft?.content ?? '',
    conversation_id: parseInt(id, 10),
    updated_at: draft?.updated_at ?? null,
  });
}

/** PUT /api/v1/accounts/:account_id/conversations/:id/draft_messages */
export async function updateDraftMessage(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = draftMessageSchema.parse(request.body);
  const user = request.currentUser as { id: number } | null;
  if (!user) return reply.status(200).send({ content: body.content ?? '', conversation_id: parseInt(id, 10) });

  const key = draftKey(user.id, parseInt(id, 10));
  if (body.content) {
    draftStore.set(key, { content: body.content, updated_at: Date.now() });
  } else {
    draftStore.delete(key);
  }
  return reply.status(200).send({
    content: body.content ?? '',
    conversation_id: parseInt(id, 10),
    updated_at: Date.now(),
  });
}

/** DELETE /api/v1/accounts/:account_id/conversations/:id/draft_messages */
export async function destroyDraftMessage(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = request.currentUser as { id: number } | null;
  if (user) {
    draftStore.delete(draftKey(user.id, parseInt(id, 10)));
  }
  return reply.status(200).send({ success: true });
}

// ── Direct Uploads ──

/** POST /api/v1/accounts/:account_id/conversations/:id/direct_uploads */
export async function directUpload(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ success: true, message: 'Upload endpoint ready' });
}

// ── Conversation Actions ──

/** POST /api/v1/accounts/:account_id/conversations/:id/mute */
export async function muteConversation(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.conversations.update({
    where: { id: parseInt(id, 10) },
    data: { snoozed_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
  });
  return reply.status(200).send({ success: true });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/unmute */
export async function unmuteConversation(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.conversations.update({
    where: { id: parseInt(id, 10) },
    data: { snoozed_until: null },
  });
  return reply.status(200).send({ success: true });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/transcript */
export async function transcriptConversation(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const messages = await prisma.messages.findMany({
    where: { conversation_id: parseInt(id, 10) },
    orderBy: { created_at: 'asc' },
    select: { content: true, created_at: true, message_type: true },
  });
  const transcript = messages.map((m) => `[${m.created_at.toISOString()}] ${m.message_type === 1 ? 'Agent' : 'Customer'}: ${m.content}`).join('\n');
  return reply.status(200).send({ transcript });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/toggle_status */
export async function toggleStatus(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { status } = (request.body as { status?: string }) || {};
  const statusMap: Record<string, number> = { open: 0, resolved: 1, pending: 2, snoozed: 3 };
  const newStatus = statusMap[status ?? 'open'];

  const conv = await prisma.conversations.update({
    where: { id: parseInt(id, 10) },
    data: { status: newStatus },
  });

  request.server.emitToAccount(conv.account_id, 'conversation.status_changed', {
    conversation_id: conv.id, status: status ?? 'open',
  });

  return reply.status(200).send({ success: true, status: status ?? 'open' });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/toggle_priority */
export async function togglePriority(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { priority } = togglePrioritySchema.parse(request.body);
  const priorityMap = { low: 0, medium: 1, high: 2, urgent: 3 };

  await prisma.conversations.update({
    where: { id: parseInt(id, 10) },
    data: { priority: priorityMap[priority] },
  });

  return reply.status(200).send({ success: true, priority });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/toggle_typing_status */
export async function toggleTypingStatus(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { typing_status, user_type } = (request.body as { typing_status?: string; user_type?: string }) || {};
  const convId = parseInt(id, 10);

  // Broadcast typing status to the conversation room via Socket.io
  const io = request.server.io;
  io.to(`conversation:${convId}`).emit(
    typing_status === 'on' ? 'typing.on' : 'typing.off',
    {
      conversation_id: convId,
      user_type: user_type ?? 'user',
      user_id: (request.currentUser as { id: number } | null)?.id ?? null,
    },
  );

  return reply.status(200).send({
    success: true,
    conversation_id: convId,
    typing_status: typing_status ?? 'off',
  });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/update_last_seen */
export async function updateLastSeen(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = request.currentUser;

  const data: Record<string, unknown> = {
    ...(user ? { agent_last_seen_at: new Date() } : { contact_last_seen_at: new Date() }),
  };

  const convId = parseInt(id, 10);
  const conv = await prisma.conversations.update({
    where: { id: convId },
    data: data as object,
  });

  emitConversationUnreadChanged(
    request.server.emitToAccount.bind(request.server),
    conv.account_id,
    convId,
  ).catch(() => {});

  return reply.status(200).send({ success: true });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/unread */
export async function markUnread(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const convId = parseInt(id, 10);
  const lastIncoming = await prisma.messages.findFirst({
    where: { conversation_id: convId, message_type: 0 },
    orderBy: { created_at: 'desc' },
  });

  const conv = await prisma.conversations.update({
    where: { id: convId },
    data: {
      status: 0,
      agent_last_seen_at: lastIncoming
        ? new Date(lastIncoming.created_at.getTime() - 1000)
        : null,
    },
  });

  emitConversationUnreadChanged(
    request.server.emitToAccount.bind(request.server),
    conv.account_id,
    convId,
  ).catch(() => {});

  return reply.status(200).send({ success: true });
}

/** POST /api/v1/accounts/:account_id/conversations/:id/custom_attributes */
export async function setCustomAttributes(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { custom_attributes } = customAttributesSchema.parse(request.body);

  await prisma.conversations.update({
    where: { id: parseInt(id, 10) },
    data: { custom_attributes: custom_attributes as object },
  });

  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/conversations/:id/attachments */
export async function listAttachments(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const messages = await prisma.messages.findMany({
    where: { conversation_id: parseInt(id, 10) },
    select: { id: true },
  });
  const msgIds = messages.map((m) => m.id);

  const attachments = msgIds.length > 0
    ? await prisma.attachments.findMany({ where: { message_id: { in: msgIds } } })
    : [];

  return reply.status(200).send({ payload: attachments });
}

/** GET /api/v1/accounts/:account_id/conversations/:id/inbox_assistant */
export async function inboxAssistant(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ assistant_enabled: false });
}
