import { prisma } from '../../plugins/db.js';
import { mergeAttrs, readLifecycle } from './conversation-attrs.js';
import { recordSessionEnded } from './omni-session-log.js';

export { asAttrMap, mergeAttrs, readLifecycle } from './conversation-attrs.js';
export type { OmniLifecycle } from './conversation-attrs.js';

export async function writeSystemMessage(
  conversation: { id: number; account_id: number; inbox_id: number },
  content: string,
  kind: string,
  sourceId?: string,
): Promise<void> {
  if (sourceId) {
    const dup = await prisma.messages.findFirst({
      where: { conversation_id: conversation.id, source_id: sourceId },
      select: { id: true },
    });
    if (dup) return;
  }
  await prisma.messages.create({
    data: {
      account_id: conversation.account_id,
      inbox_id: conversation.inbox_id,
      conversation_id: conversation.id,
      content,
      message_type: 2,
      content_type: 0,
      content_attributes: { kind },
      source_id: sourceId,
      private: false,
    },
  });
}

export async function markConversationEnded(
  conversationId: number,
  extra?: Record<string, unknown>,
  systemText = '本次沟通已结束',
) {
  const conv = await prisma.conversations.findUnique({ where: { id: conversationId } });
  if (!conv || conv.status !== 0) return conv;
  if (readLifecycle(conv.additional_attributes) === 'ended' && !extra) return conv;

  const extraIn = extra ?? {};
  const causeRaw = typeof extraIn.omni_release_cause === 'string' ? extraIn.omni_release_cause : '';
  const actorUserId = Number(extraIn.actor_user_id || 0) || undefined;
  const restExtra = { ...extraIn };
  delete restExtra.omni_release_cause;
  delete restExtra.actor_user_id;

  const attrs = mergeAttrs(conv.additional_attributes, {
    omni_lifecycle: 'ended',
    session_ended_at: new Date().toISOString(),
    ...restExtra,
  });

  const updated = await prisma.conversations.update({
    where: { id: conversationId },
    data: {
      additional_attributes: attrs as object,
      last_activity_at: new Date(),
    },
  });

  if (systemText) {
    await writeSystemMessage(conv, systemText, 'session_ended');
  }
  const cause =
    causeRaw === 'force_end' || causeRaw === 'visitor_end' || causeRaw === 'timeout' || causeRaw === 'queue_abandon'
      ? causeRaw
      : 'agent_end';
  recordSessionEnded({ conversationId, cause, actorUserId });
  // 通知 ITR「这通会话结束了」，让它清掉该会话的跨会话全局变量（限流计数等）。
  // 用动态 import 规避 shared → integrations 的循环依赖；失败不影响会话结束本身。
  try {
    const { itrEnd } = await import('../../integrations/itr/itr-client.js');
    await itrEnd(String(conversationId));
  } catch (e) {
    console.warn('[lifecycle] itr end notify failed', e);
  }

  // 坐席点「结束会话」→ 按渠道配置走满意度路由（on_agent_end）。
  //
  // 放在 itrEnd 之后是必须的：满意度通常就是一个 ITR 流程，得先清掉旧会话再起新的，
  // 否则新流程会被这次 itrEnd 一起清掉。不 await：路由失败不该影响会话结束本身。
  if (cause === 'agent_end') {
    void import('../../modules/itr/itr-lifecycle.js')
      .then(({ runChannelRoutes }) => runChannelRoutes(conversationId, 'on_agent_end'))
      .catch((e) => console.warn('[lifecycle] on_agent_end route failed', e));
  }
  return updated;
}

export async function reopenConversationIfEnded(conversationId: number) {
  const conv = await prisma.conversations.findUnique({ where: { id: conversationId } });
  if (!conv || conv.status !== 0) return conv;
  if (readLifecycle(conv.additional_attributes) !== 'ended') return conv;

  const attrs = mergeAttrs(conv.additional_attributes, {
    omni_lifecycle: 'active',
    session_ended_at: null,
  });
  return prisma.conversations.update({
    where: { id: conversationId },
    data: {
      additional_attributes: attrs as object,
      last_activity_at: new Date(),
    },
  });
}
