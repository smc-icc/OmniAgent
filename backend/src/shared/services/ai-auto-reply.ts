import { prisma } from '../../plugins/db.js';
import { ioRef } from '../../processors/socket-ref.js';
import { accessScope } from '../../modules/access/access.scope.js';
import { askConversationKnowledge, revalidateConversationKnowledge } from '../../modules/knowledge/knowledge.service.js';
import { dispatchOutgoingMessage } from './channel-outgoing.js';

type Job = { account_id: number; conversation_id: number; message_id?: number; assistant_id?: number | null };
type Result = { ok: boolean; reply?: string; reason?: string };
const attrsOf = (value: unknown) => (value ?? {}) as Record<string, any>;
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

async function eligible(data: Job, ignoreMessageId?: number) {
  const conv = await prisma.conversations.findFirst({ where: { id: data.conversation_id, account_id: data.account_id }, include: { inbox: true } });
  if (!conv || !conv.assignee_id || ![0, 2].includes(conv.status) || conv.inbox.account_id !== conv.account_id
    || attrsOf(conv.custom_attributes).ai_auto_reply !== true) return null;
  const trigger = await prisma.messages.findFirst({ where: { id: data.message_id, account_id: conv.account_id, conversation_id: conv.id,
    inbox_id: conv.inbox_id, message_type: 0, private: false, content_type: 0, sender_type: 'Contact', sender_id: conv.contact_id } });
  if (!trigger?.content?.trim() || trigger.content.length > 1000) return null;
  const latest = await prisma.messages.findFirst({ where: { account_id: conv.account_id, conversation_id: conv.id, private: false,
    message_type: { in: [0, 1] }, ...(ignoreMessageId ? { id: { not: ignoreMessageId } } : {}) }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
  if (latest?.id !== trigger.id) return null;
  return { conv, trigger };
}

async function execute(data: Job): Promise<Result> {
  if (![data.account_id, data.conversation_id, data.message_id].every(validId)) return { ok: false, reason: 'invalid_trigger' };
  let message = await prisma.messages.findUnique({ where: { knowledge_trigger_id: data.message_id } });
  if (message && (message.account_id !== data.account_id || message.conversation_id !== data.conversation_id)) return { ok: false, reason: 'tenant_mismatch' };
  if (message && attrsOf(message.content_attributes).delivery_state !== 'pending') {
    // A crash after the network call is ambiguous. Do not blindly send twice.
    return { ok: attrsOf(message.content_attributes).delivery_state === 'delivered', reason: 'already_processed' };
  }
  const initial = await eligible(data, message?.id);
  if (!initial) return { ok: false, reason: 'ineligible_or_superseded' };
  const { conv, trigger } = initial;
  if (!message) {
    const answer = await askConversationKnowledge(conv.account_id, conv.id, conv.assignee_id!, trigger.content!);
    if (!answer.answered) return { ok: false, reason: 'no_authorized_answer' };
    const p = await revalidateConversationKnowledge(conv.account_id, conv.id, conv.assignee_id!, answer.sources);
    const latest = await eligible(data);
    if (!latest || latest.conv.assignee_id !== conv.assignee_id) return { ok: false, reason: 'conversation_changed' };
    try {
      message = await prisma.$transaction(async tx => {
        const changed = await tx.conversations.updateMany({ where: { id: conv.id, account_id: conv.account_id,
          assignee_id: conv.assignee_id, updated_at: latest.conv.updated_at }, data: { last_activity_at: new Date(), status: 0 } });
        if (!changed.count) return null;
        const created = await tx.messages.create({ data: { account_id: conv.account_id, inbox_id: conv.inbox_id, conversation_id: conv.id,
          knowledge_trigger_id: trigger.id, content: answer.answer, message_type: 1, content_type: 0, private: false,
          sender_type: 'User', sender_id: conv.assignee_id, content_attributes: { kind: 'ai_auto', mode: 'knowledge_extractive',
            vdn_id: p.vdnId, sources: answer.sources, delivery_state: 'pending' } } });
        await tx.knowledge_audit_events.create({ data: { account_id: p.accountId, vdn_id: p.vdnId, actor_kind: 'user', actor_id: String(p.userId),
          action: 'conversation.knowledge_reply', resource_id: String(conv.id), request_id: `auto:${trigger.id}`, outcome: 'created' } });
        return created;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      message = await prisma.messages.findUnique({ where: { knowledge_trigger_id: trigger.id } });
    }
  }
  if (!message) return { ok: false, reason: 'conversation_changed' };
  if (message.account_id !== data.account_id || message.conversation_id !== data.conversation_id) return { ok: false, reason: 'tenant_mismatch' };
  const attrs = attrsOf(message.content_attributes);
  if (attrs.delivery_state !== 'pending') return { ok: false, reason: 'already_processed' };
  try {
    const latest = await eligible(data, message.id);
    if (!latest || latest.conv.assignee_id !== message.sender_id) throw new Error('conversation_changed');
    await revalidateConversationKnowledge(message.account_id, message.conversation_id, message.sender_id!, attrs.sources ?? []);
  } catch {
    await prisma.messages.updateMany({ where: { id: message.id, content_attributes: { path: ['delivery_state'], equals: 'pending' } },
      data: { private: true, content_attributes: { ...attrs, delivery_state: 'suppressed', send_error: 'knowledge_authorization_changed' } } });
    return { ok: false, reason: 'authorization_changed' };
  }
  const claimed = await prisma.messages.updateMany({ where: { id: message.id, account_id: data.account_id,
    content_attributes: { path: ['delivery_state'], equals: 'pending' } }, data: { content_attributes: { ...attrs, delivery_state: 'sending' } } });
  if (!claimed.count) return { ok: false, reason: 'already_processed' };
  try {
    await dispatchOutgoingMessage(message.conversation_id, message.id, message.content);
    const sent = await prisma.messages.findUniqueOrThrow({ where: { id: message.id } });
    const delivered = !attrsOf(sent.content_attributes).send_error;
    const saved = await prisma.messages.update({ where: { id: message.id }, data: { content_attributes: {
      ...attrsOf(sent.content_attributes), delivery_state: delivered ? 'delivered' : 'failed' } } });
    ioRef.get()?.to(`account:${saved.account_id}`).emit('message.created', { ...saved, message_type: 'outgoing', content_type: 'text', created_at: saved.created_at.getTime() });
    return { ok: delivered, reply: saved.content ?? undefined, ...(delivered ? {} : { reason: 'channel_failed' }) };
  } catch {
    await prisma.messages.update({ where: { id: message.id }, data: { content_attributes: { ...attrs, delivery_state: 'uncertain', send_error: 'delivery_uncertain_manual_review' } } });
    return { ok: false, reason: 'delivery_uncertain' };
  }
}

export async function runAiAutoReplyJob(data: Job): Promise<Result> {
  // Queue callbacks may inherit a request ALS store in inline mode. No inherited
  // tenant scope or cached permission is permitted for a background reply.
  return accessScope.exit(async () => {
    try { return await execute(data); }
    catch (error) {
      if ([401, 403, 404].includes(Number((error as { statusCode?: number }).statusCode))) return { ok: false, reason: 'identity_or_source_denied' };
      throw error;
    }
  });
}
