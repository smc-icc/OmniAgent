import { prisma } from '../../plugins/db.js';
import { AppError } from '../errors/index.js';
import { confTenancyEnabled } from './conf-tenancy.js';
/** Inbox selectors do not confer ownership, including in callback/background work. */
export async function assertItrConversationInbox(
  conversation: { account_id?: number | null; inbox_id?: number | null } | null,
  requestedInboxId?: number,
) {
  if (!confTenancyEnabled()) return;
  if (!conversation?.account_id || !conversation.inbox_id) throw new AppError(403, 'ITR 会话没有可靠租户/收件箱归属');
  if (requestedInboxId != null && requestedInboxId !== conversation.inbox_id) throw new AppError(403, 'ITR 收件箱必须来自当前会话');
  const inbox = await prisma.inboxes.findUnique({ where: { id: conversation.inbox_id }, select: { account_id: true } });
  if (!inbox || inbox.account_id !== conversation.account_id) throw new AppError(403, 'ITR 会话与收件箱租户不一致');
}
