import { prisma } from '../../plugins/db.js';

/** Durable access to an operator's unfinished work, independent of online routing. */
export async function ensureConversationParticipant(
  conversation: { id: number; account_id: number }, userId: number,
): Promise<void> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return;
  await prisma.conversation_participants.upsert({
    where: { user_id_conversation_id: { user_id: userId, conversation_id: conversation.id } },
    create: { account_id: conversation.account_id, user_id: userId, conversation_id: conversation.id },
    update: {},
  });
}
