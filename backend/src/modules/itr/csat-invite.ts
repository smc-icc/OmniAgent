/**
 * CSAT invite + visitor rating capture (1/0 or 1–5).
 */
import { prisma } from '../../plugins/db.js';
import { ioRef } from '../../processors/socket-ref.js';
import { dispatchItrOutbound } from '../../shared/services/itr-outbound.js';
import { pushVisitorMessageToChannel, writeVisitorChatMessage } from './itr-queue.js';

function attrsOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function parseRating(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^(满意|好评|赞)$/.test(t)) return 5;
  if (/^(不满意|差评|踩)$/.test(t)) return 1;
  if (/^[0-5]$/.test(t)) {
    const n = Number(t);
    if (n === 0) return 1;
    return n;
  }
  return null;
}

export async function inviteCsatSurvey(conversationId: number): Promise<{ messageId: number; prompt: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      account_id: true,
      inbox_id: true,
      additional_attributes: true,
      inbox: { select: { csat_config: true, csat_survey_enabled: true } },
    },
  });
  if (!conv) throw new Error('conversation not found');

  const cfg = attrsOf(conv.inbox?.csat_config);
  const questions = Array.isArray(cfg.questions) ? (cfg.questions as unknown[]) : [];
  let firstQ = '';
  const q0 = questions[0];
  if (typeof q0 === 'string') firstQ = q0;
  else if (q0 && typeof q0 === 'object') {
    firstQ = String((q0 as { question?: string }).question || '');
  }
  const prompt =
    firstQ ||
    '请为本次服务评分：回复 5-非常满意 / 4 / 3 / 2 / 1-不满意（也可回复 满意 / 不满意）';

  const msg = await prisma.messages.create({
    data: {
      account_id: conv.account_id,
      inbox_id: conv.inbox_id,
      conversation_id: conv.id,
      content: prompt,
      message_type: 1,
      content_type: 0,
      content_attributes: { csat_invite: true },
      private: false,
    },
  });

  await prisma.conversations.update({
    where: { id: conv.id },
    data: {
      additional_attributes: {
        ...attrsOf(conv.additional_attributes),
        csat_pending: true,
        csat_invite_message_id: msg.id,
      } as object,
      last_activity_at: new Date(),
    },
  });

  const payload = {
    id: msg.id,
    content: msg.content,
    message_type: 'outgoing',
    content_type: 'text',
    content_attributes: msg.content_attributes,
    private: false,
    conversation_id: msg.conversation_id,
    account_id: msg.account_id,
    created_at: msg.created_at.getTime(),
  };
  const io = ioRef.get();
  io?.to(`account:${conv.account_id}`).emit('message.created', payload);
  io?.to(`conversation_${conv.id}`).emit('message.created', payload);
  void dispatchItrOutbound(conv.id, msg.id, prompt, 'text', { csat_invite: true }).catch(() => {});

  return { messageId: msg.id, prompt };
}

/**
 * 满意度流程启动后点亮 csat_pending。
 *
 * 坐席结束会话时，渠道配置的满意度 ITR 流程负责「发邀请」，Omni 负责「打开收货开关」：
 * 不点亮 csat_pending，客户回复的评分会被 tryConsumeCsatRating() 的第一道门直接丢弃
 * （既不入库、也不会回「感谢您的评价」）。
 *
 * 为什么不复用 inviteCsatSurvey()：那条路会自己再发一条固定文案的邀请，
 * 而这里的邀请属于渠道配置的流程，Omni 不该重复发。
 */
export async function markCsatPending(conversationId: number): Promise<void> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: { id: true, additional_attributes: true },
  });
  if (!conv) return;
  await prisma.conversations.update({
    where: { id: conv.id },
    data: {
      additional_attributes: {
        ...attrsOf(conv.additional_attributes),
        csat_pending: true,
      } as object,
    },
  });
}

export async function tryConsumeCsatRating(
  conversationId: number,
  content: string,
  incomingMessageId?: number,
): Promise<boolean> {
  const rating = parseRating(content);
  if (rating == null) return false;

  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      account_id: true,
      contact_id: true,
      assignee_id: true,
      additional_attributes: true,
    },
  });
  if (!conv) return false;
  const a = attrsOf(conv.additional_attributes);
  if (!a.csat_pending) return false;

  const inviteMessageId = Number(a.csat_invite_message_id || 0);
  // 满意度邀请由渠道配置的 ITR 流程发出，Omni 侧没有记录它的消息 id；
  // 回退到该会话最近一条 outgoing 消息（就是那条邀请），
  // 否则 csat_survey_responses 的 upsert 没有可用的唯一定位键。
  let messageId = incomingMessageId || inviteMessageId;
  if (!messageId) {
    const lastOutgoing = await prisma.messages.findFirst({
      where: { conversation_id: conversationId, message_type: 1 },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    messageId = lastOutgoing?.id ?? 0;
  }
  if (!messageId || !conv.contact_id) {
    return false;
  }

  try {
    await prisma.csat_survey_responses.upsert({
      where: { message_id: messageId },
      create: {
        account_id: conv.account_id,
        conversation_id: conv.id,
        message_id: messageId,
        rating,
        feedback_message: content,
        contact_id: conv.contact_id,
        assigned_agent_id: conv.assignee_id,
      },
      update: { rating, feedback_message: content },
    });
  } catch (e) {
    console.warn('[csat] persist failed', e);
    return false;
  }

  await prisma.conversations.update({
    where: { id: conv.id },
    data: {
      additional_attributes: {
        ...a,
        csat_pending: false,
        csat_rating: rating,
        csat_rated_at: new Date().toISOString(),
      } as object,
    },
  });
  const thanksMsg = await writeVisitorChatMessage(conversationId, '感谢您的评价。');
  await pushVisitorMessageToChannel(conversationId, thanksMsg?.id ?? 0, '感谢您的评价。');
  return true;
}
