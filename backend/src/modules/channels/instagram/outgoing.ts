import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { requireHttpsMediaUrl, type ChannelMedia } from '../../../shared/services/channel-media.js';
import { isMessengerWindowOpen } from '../facebook/attachments.js';

async function loadInstagramTarget(conversationId: number) {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.INSTAGRAM) {
    return { error: 'not instagram' as const };
  }
  const channel = await prisma.channel_instagram.findUnique({ where: { id: conv.inbox.channel_id } });
  if (!channel) return { error: 'channel not found' as const };
  const ci = await prisma.contact_inboxes.findFirst({
    where: { inbox_id: conv.inbox_id, contact_id: conv.contact_id ?? 0 },
  });
  if (!ci?.source_id) return { error: 'contact source_id missing' as const };
  const attrs = (conv.additional_attributes ?? {}) as Record<string, unknown>;
  return {
    token: channel.access_token,
    to: ci.source_id,
    windowUntil: attrs.messenger_window_until,
  };
}

async function sendIgPayload(
  token: string,
  to: string,
  message: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: to }, message }),
      },
    );
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

export async function sendInstagramText(
  conversationId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadInstagramTarget(conversationId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!isMessengerWindowOpen(ctx.windowUntil)) {
    return { ok: false, error: 'Instagram 24h 消息窗已关闭，需客户先发言' };
  }
  return sendIgPayload(ctx.token, ctx.to, { text: content });
}

function igAttachmentType(kind: string): 'image' | 'audio' | 'video' | 'file' {
  if (kind === 'image') return 'image';
  if (kind === 'voice') return 'audio';
  if (kind === 'video') return 'video';
  return 'file';
}

export async function sendInstagramMedia(
  conversationId: number,
  media: ChannelMedia,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadInstagramTarget(conversationId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!isMessengerWindowOpen(ctx.windowUntil)) {
    return { ok: false, error: 'Instagram 24h 消息窗已关闭，需客户先发言' };
  }
  if (media.kind === 'file') {
    const url = media.file_url ? requireHttpsMediaUrl(media.file_url) : '';
    return sendIgPayload(ctx.token, ctx.to, {
      text: url ? `${media.file_name || '[文件]'}\n${url}` : (media.file_name || '[文件]'),
    });
  }
  const url = media.file_url ? requireHttpsMediaUrl(media.file_url) : null;
  if (!url) {
    return { ok: false, error: 'Instagram 出站媒体需要 PUBLIC_BASE_URL 为公网 HTTPS' };
  }
  return sendIgPayload(ctx.token, ctx.to, {
    attachment: {
      type: igAttachmentType(media.kind),
      payload: { url, is_reusable: true },
    },
  });
}
