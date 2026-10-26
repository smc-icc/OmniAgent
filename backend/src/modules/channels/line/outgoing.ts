import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { requireHttpsMediaUrl, type ChannelMedia } from '../../../shared/services/channel-media.js';

async function loadLineTarget(conversationId: number) {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.LINE) {
    return { error: 'not a line conversation' as const };
  }
  const channel = await prisma.channel_line.findUnique({ where: { id: conv.inbox.channel_id } });
  if (!channel) return { error: 'channel not found' as const };
  const ci = await prisma.contact_inboxes.findFirst({
    where: { inbox_id: conv.inbox_id, contact_id: conv.contact_id ?? 0 },
  });
  if (!ci?.source_id) return { error: 'contact source_id missing' as const };
  return { channel, to: ci.source_id };
}

async function pushLineMessages(
  token: string,
  to: string,
  messages: unknown[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, messages }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: err || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

export async function sendLineText(
  conversationId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadLineTarget(conversationId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  return pushLineMessages(ctx.channel.line_channel_token, ctx.to, [{ type: 'text', text: content }]);
}

function lineOutboundMessage(media: ChannelMedia, caption?: string): unknown[] | { error: string } {
  const url = media.file_url ? requireHttpsMediaUrl(media.file_url) : null;
  const text = (caption || media.caption || media.file_name || '').trim();
  if (!url) {
    return { error: 'LINE 出站媒体需要 PUBLIC_BASE_URL 为公网 HTTPS，对方服务器才能拉取文件' };
  }

  if (media.kind === 'image') {
    const msgs: unknown[] = [{
      type: 'image',
      originalContentUrl: url,
      previewImageUrl: url,
    }];
    if (text) msgs.push({ type: 'text', text });
    return msgs;
  }
  if (media.kind === 'voice') {
    return [{
      type: 'audio',
      originalContentUrl: url,
      duration: 60_000,
    }];
  }
  if (media.kind === 'video') {
    // LINE 视频必须另附 JPEG 预览；我们没有生成缩略图，改发可点开的公网链接
    return [{ type: 'text', text: text ? `${text}\n${url}` : url }];
  }
  return [{
    type: 'file',
    originalContentUrl: url,
    fileName: media.file_name || 'file',
  }];
}

export async function sendLineMedia(
  conversationId: number,
  media: ChannelMedia,
  caption?: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await loadLineTarget(conversationId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const built = lineOutboundMessage(media, caption);
  if ('error' in built) return { ok: false, error: built.error };
  return pushLineMessages(ctx.channel.line_channel_token, ctx.to, built);
}
