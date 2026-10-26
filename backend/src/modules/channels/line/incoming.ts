import { createHmac } from 'crypto';
import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { resolveInbox, processIncomingMessage, type ChannelIncomingHooks } from '../../../shared/services/channel-incoming.js';
import { persistRemoteMediaUrl, type ChannelMedia, type ChannelMediaKind } from '../../../shared/services/channel-media.js';
import { lineMessageContent, lineMessageKind, type LineEvent } from './parse.js';

export { lineMessageContent, lineMessageKind } from './parse.js';
export type { LineEvent } from './parse.js';

export function verifyLineSignature(body: string, signature: string, secret: string): boolean {
  const hash = createHmac('SHA256', secret).update(body).digest('base64');
  return hash === signature;
}

async function persistLineMedia(
  token: string,
  messageId: string,
  kind: ChannelMediaKind,
  fileName?: string,
): Promise<ChannelMedia | undefined> {
  const name = fileName
    || (kind === 'image' ? 'line-image.jpg'
      : kind === 'voice' ? 'line-audio.m4a'
        : kind === 'video' ? 'line-video.mp4'
          : 'line-file');
  const contentType = kind === 'image' ? 'image/jpeg'
    : kind === 'voice' ? 'audio/mp4'
      : kind === 'video' ? 'video/mp4'
        : undefined;
  try {
    const saved = await persistRemoteMediaUrl(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
      {
        fileName: name,
        contentType,
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return { ...saved, kind, external_media_id: messageId };
  } catch {
    return undefined;
  }
}

export async function handleLineWebhook(
  lineChannelId: string,
  events: LineEvent[],
  hooks: ChannelIncomingHooks,
): Promise<void> {
  const channel = await prisma.channel_line.findFirst({ where: { line_channel_id: lineChannelId } });
  if (!channel) return;

  const inbox = await resolveInbox(CHANNEL_TYPES.LINE, channel.id);
  if (!inbox) return;

  for (const ev of events) {
    if (ev.type !== 'message' || !ev.message) continue;
    const sourceId = ev.source?.userId;
    if (!sourceId) continue;

    const kind = lineMessageKind(ev.message.type);
    if (kind === 'skip') continue;
    const content = lineMessageContent(ev);
    if (!content) continue;

    let media: ChannelMedia | undefined;
    if (kind !== 'text' && ev.message.id) {
      media = await persistLineMedia(
        channel.line_channel_token,
        ev.message.id,
        kind,
        ev.message.fileName,
      );
    }

    await processIncomingMessage(
      {
        accountId: channel.account_id,
        inboxId: inbox.id,
        sourceId,
        contactName: `LINE ${sourceId.slice(-6)}`,
        content,
        media,
        externalMessageId: ev.message.id,
        contactPrefix: 'line',
        conversationAttributes: { line_reply_token: ev.replyToken },
      },
      hooks,
    );
  }
}
