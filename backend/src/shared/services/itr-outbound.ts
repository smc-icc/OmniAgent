import { prisma } from '../../plugins/db.js';
import { dispatchOutgoingMessage } from './channel-outgoing.js';
import { sendSmsText, sendSmsToNumber } from '../../modules/channels/sms/outgoing.js';
import { sendWechatMpNews, sendWechatMpText } from '../../modules/wechat/wechat-mp.outgoing.js';
import { sendWeiboText } from '../../modules/channels/weibo/outgoing.js';
import { CHANNEL_TYPES } from '../channels/types.js';

export async function dispatchItrOutbound(
  conversationId: number,
  messageId: number,
  content: string,
  contentType: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const kind = String(contentType || 'text').toLowerCase();
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  const channelType = conv?.inbox?.channel_type || '';

  if (kind === 'sms') {
    const to = String(meta.to || meta.phone || '').trim();
    if (to && conv) {
      const r = await sendSmsToNumber(conv.account_id, to, content);
      if (!r.ok && (channelType === CHANNEL_TYPES.SMS || channelType === CHANNEL_TYPES.TWILIO_SMS)) {
        await sendSmsText(conversationId, content);
      }
      return;
    }
    if (channelType === CHANNEL_TYPES.SMS || channelType === CHANNEL_TYPES.TWILIO_SMS) {
      await sendSmsText(conversationId, content);
      return;
    }
  }

  if (kind === 'news') {
    const articles = Array.isArray(meta.articles) ? (meta.articles as { title?: string; description?: string; url?: string; picUrl?: string }[]) : [];
    if (channelType === CHANNEL_TYPES.WECHAT_MP && articles.length) {
      const r = await sendWechatMpNews(conversationId, messageId, articles);
      if (r.ok) return;
    }
    await dispatchOutgoingMessage(conversationId, messageId, content);
    return;
  }

  if (kind === 'weibo') {
    if (channelType === CHANNEL_TYPES.WEIBO) {
      await sendWeiboText(conversationId, messageId, content);
      return;
    }
  }

  if (channelType === CHANNEL_TYPES.WECHAT_MP && kind !== 'tts') {
    await sendWechatMpText(conversationId, messageId, content);
    return;
  }

  await dispatchOutgoingMessage(conversationId, messageId, content);
}
