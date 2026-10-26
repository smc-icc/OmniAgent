import { prisma } from '../../plugins/db.js';
import { CHANNEL_TYPES } from '../channels/types.js';
import { sendWechatMpMedia, sendWechatMpText } from '../../modules/wechat/wechat-mp.outgoing.js';
import { sendWecomKfMedia, sendWecomKfText } from '../../modules/wechat/wecom-kf.outgoing.js';
import { sendWecomContactText } from '../../modules/wechat/wecom-contact.outgoing.js';
import { sendTelegramMedia, sendTelegramText } from '../../modules/channels/telegram/outgoing.js';
import { sendLineMedia, sendLineText } from '../../modules/channels/line/outgoing.js';
import { sendSmsText } from '../../modules/channels/sms/outgoing.js';
import { sendWhatsappMedia, sendWhatsappText } from '../../modules/channels/whatsapp/outgoing.js';
import { sendFacebookMedia, sendFacebookText } from '../../modules/channels/facebook/outgoing.js';
import { sendInstagramMedia, sendInstagramText } from '../../modules/channels/instagram/outgoing.js';
import { sendTiktokText } from '../../modules/channels/tiktok/outgoing.js';
import { sendEmailMedia, sendEmailReply } from '../../modules/channels/email/outgoing.js';
import { sendApiChannelWebhook } from '../../modules/channels/api/outgoing.js';
import { sendWeiboText } from '../../modules/channels/weibo/outgoing.js';
import { mapContentAttributesToKind } from './message-kind.js';
import { mediaFromContentAttributes, resolveOutgoingAction } from './channel-media.js';

async function markSendError(messageId: number, error: string): Promise<void> {
  const msg = await prisma.messages.findUnique({
    where: { id: messageId },
    select: { content_attributes: true },
  });
  const attrs = (msg?.content_attributes ?? {}) as Record<string, unknown>;
  await prisma.messages.update({
    where: { id: messageId },
    data: {
      content_attributes: {
        ...attrs,
        send_error: error,
      } as object,
    },
  });
}

export async function dispatchOutgoingMessage(
  conversationId: number,
  messageId: number,
  content: string | null | undefined,
): Promise<void> {
  const stored = await prisma.messages.findUnique({
    where: { id: messageId },
    select: { content: true, content_attributes: true, message_type: true },
  });
  const attrs = (stored?.content_attributes ?? {}) as Record<string, unknown>;
  const kind = mapContentAttributesToKind(attrs, stored?.message_type ?? 1);
  const text = (content ?? stored?.content ?? '').trim();

  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox?.channel_type) {
    await markSendError(messageId, 'outbound channel not found');
    return;
  }

  const channelType = conv.inbox.channel_type;
  const decision = resolveOutgoingAction(channelType, kind);

  if (decision.action === 'skip') return;

  if (decision.action === 'unsupported') {
    await markSendError(messageId, decision.error);
    return;
  }

  if (decision.action === 'send_media') {
    const media = mediaFromContentAttributes(attrs);
    if (!media?.file_url) {
      await markSendError(messageId, 'media file_url missing');
      return;
    }
    let mediaResult: { ok: boolean; error?: string };
    switch (channelType) {
      case CHANNEL_TYPES.WECHAT_MP:
        mediaResult = await sendWechatMpMedia(conversationId, messageId, media, text);
        break;
      case CHANNEL_TYPES.WECOM_KF:
        mediaResult = await sendWecomKfMedia(conversationId, messageId, media);
        break;
      case CHANNEL_TYPES.EMAIL:
        mediaResult = await sendEmailMedia(conversationId, messageId, media, text);
        break;
      case CHANNEL_TYPES.TELEGRAM:
        mediaResult = await sendTelegramMedia(conversationId, media, text);
        break;
      case CHANNEL_TYPES.LINE:
        mediaResult = await sendLineMedia(conversationId, media, text);
        break;
      case CHANNEL_TYPES.WHATSAPP:
        mediaResult = await sendWhatsappMedia(conversationId, media, text);
        break;
      case CHANNEL_TYPES.FACEBOOK:
        mediaResult = await sendFacebookMedia(conversationId, media);
        break;
      case CHANNEL_TYPES.INSTAGRAM:
        mediaResult = await sendInstagramMedia(conversationId, media);
        break;
      default:
        mediaResult = {
          ok: false,
          error: `channel ${channelType} does not support outbound ${decision.mediaKind} yet`,
        };
    }
    if (!mediaResult.ok && mediaResult.error) {
      await markSendError(messageId, mediaResult.error);
    }
    return;
  }

  if (!text) return;

  let result: { ok: boolean; error?: string };

  switch (channelType) {
    case CHANNEL_TYPES.WECHAT_MP:
      result = await sendWechatMpText(conversationId, messageId, text);
      break;
    case CHANNEL_TYPES.WECOM_KF:
      result = await sendWecomKfText(conversationId, messageId, text);
      break;
    case CHANNEL_TYPES.WECOM_CONTACT:
      result = await sendWecomContactText(conversationId, messageId, text);
      break;
    case CHANNEL_TYPES.TELEGRAM:
      result = await sendTelegramText(conversationId, text);
      break;
    case CHANNEL_TYPES.LINE:
      result = await sendLineText(conversationId, text);
      break;
    case CHANNEL_TYPES.TWILIO_SMS:
    case CHANNEL_TYPES.SMS:
      result = await sendSmsText(conversationId, text);
      break;
    case CHANNEL_TYPES.WHATSAPP:
      result = await sendWhatsappText(conversationId, text);
      break;
    case CHANNEL_TYPES.FACEBOOK:
      result = await sendFacebookText(conversationId, text);
      break;
    case CHANNEL_TYPES.INSTAGRAM:
      result = await sendInstagramText(conversationId, text);
      break;
    case CHANNEL_TYPES.TIKTOK:
      result = await sendTiktokText(conversationId, text);
      break;
    case CHANNEL_TYPES.EMAIL:
      result = await sendEmailReply(conversationId, text);
      break;
    case CHANNEL_TYPES.API:
      result = await sendApiChannelWebhook(conversationId, messageId, text);
      break;
    case CHANNEL_TYPES.MINIPROGRAM:
      result = await sendApiChannelWebhook(
        conversationId,
        messageId,
        text,
        CHANNEL_TYPES.MINIPROGRAM,
        'miniprogram_send',
      );
      break;
    case CHANNEL_TYPES.WEIBO:
      result = await sendWeiboText(conversationId, messageId, text);
      break;
    case CHANNEL_TYPES.WEB_WIDGET:
      return;
    default:
      await markSendError(messageId, `unsupported outbound channel ${channelType}`);
      return;
  }

  if (!result.ok) {
    await markSendError(messageId, result.error || 'outbound delivery failed');
  }
}
