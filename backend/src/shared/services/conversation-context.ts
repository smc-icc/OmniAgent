import { prisma } from '../../plugins/db.js';
import type { ConversationContext } from '../../plugins/llm.js';

export async function buildConversationContext(
  conversationId: number,
  latestContent?: string,
): Promise<ConversationContext> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: {
      inbox: { select: { name: true } },
      contact: { select: { name: true } },
      messages: {
        orderBy: { created_at: 'asc' },
        take: 20,
        select: { content: true, message_type: true, sender_type: true, created_at: true },
      },
    },
  });

  if (!conv) {
    return { messages: [{ role: 'customer', content: latestContent ?? '' }] };
  }

  const messages: ConversationContext['messages'] = conv.messages.map((m) => ({
    role: (m.message_type === 1 ? 'agent' : 'customer') as 'agent' | 'customer',
    content: m.content ?? '',
    timestamp: m.created_at.toISOString(),
  }));

  if (latestContent) {
    const last = messages[messages.length - 1];
    if (!last || last.content !== latestContent) {
      messages.push({ role: 'customer', content: latestContent });
    }
  }

  return {
    messages,
    inbox_name: conv.inbox?.name ?? undefined,
    contact_name: conv.contact?.name ?? undefined,
  };
}
