import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { readPersistedMedia, type ChannelMedia } from '../../../shared/services/channel-media.js';
import { sendTelegramFile, sendTelegramMessage } from './telegram-api.js';

async function loadTelegramTarget(conversationId: number) {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.TELEGRAM) {
    return { error: 'not a telegram conversation' as const };
  }
  const channel = await prisma.channel_telegram.findUnique({
    where: { id: conv.inbox.channel_id },
  });
  if (!channel) return { error: 'channel not found' as const };
  const ci = await prisma.contact_inboxes.findFirst({
    where: { inbox_id: conv.inbox_id, contact_id: conv.contact_id ?? 0 },
  });
  if (!ci?.source_id) return { error: 'contact source_id missing' as const };
  return { channel, chatId: ci.source_id };
}

export async function sendTelegramText(
  conversationId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadTelegramTarget(conversationId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  return sendTelegramMessage(ctx.channel.bot_token, ctx.chatId, content);
}

function telegramSendSpec(kind: string): {
  method: 'sendPhoto' | 'sendVoice' | 'sendVideo' | 'sendDocument';
  field: 'photo' | 'voice' | 'video' | 'document';
} {
  if (kind === 'image') return { method: 'sendPhoto', field: 'photo' };
  if (kind === 'voice') return { method: 'sendVoice', field: 'voice' };
  if (kind === 'video') return { method: 'sendVideo', field: 'video' };
  return { method: 'sendDocument', field: 'document' };
}

export async function sendTelegramMedia(
  conversationId: number,
  media: ChannelMedia,
  caption?: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadTelegramTarget(conversationId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!media.file_url) return { ok: false, error: 'media file_url missing' };

  const buf = await readPersistedMedia(media.file_url);
  if (!buf) return { ok: false, error: 'media file not found' };

  const spec = telegramSendSpec(media.kind);
  const text = (caption || media.caption || '').trim();
  return sendTelegramFile(ctx.channel.bot_token, ctx.chatId, spec.method, spec.field, buf, {
    fileName: media.file_name || spec.field,
    contentType: media.content_type,
    caption: text || undefined,
  });
}
