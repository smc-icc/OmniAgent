import { prisma } from '../../plugins/db.js';

export const CONVERSATION_UNREAD_CHANGED = 'conversation.unread_changed';

export async function countAgentUnread(
  conversationId: number,
  agentLastSeenAt?: Date | null,
): Promise<number> {
  return prisma.messages.count({
    where: {
      conversation_id: conversationId,
      message_type: 0,
      ...(agentLastSeenAt ? { created_at: { gt: agentLastSeenAt } } : {}),
    },
  });
}

export async function emitConversationUnreadChanged(
  emitToAccount: (accountId: number, event: string, data: unknown) => void,
  accountId: number,
  conversationId: number,
): Promise<void> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: { agent_last_seen_at: true, last_activity_at: true },
  });
  if (!conv) return;

  const unread = await countAgentUnread(conversationId, conv.agent_last_seen_at);
  emitToAccount(accountId, CONVERSATION_UNREAD_CHANGED, {
    conversation_id: conversationId,
    unread,
    last_activity_at: conv.last_activity_at?.getTime() ?? null,
  });
}
