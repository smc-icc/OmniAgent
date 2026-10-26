import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { resolveInbox, processIncomingMessage, type ChannelIncomingHooks } from '../../../shared/services/channel-incoming.js';
import { persistRemoteMediaUrl, type ChannelMedia } from '../../../shared/services/channel-media.js';
import { getTelegramFileUrl } from './telegram-api.js';
import { extractTelegramInbound, type TelegramInboundHint, type TelegramMessage } from './parse.js';

export { extractTelegramInbound } from './parse.js';
export type { TelegramInboundHint, TelegramMessage } from './parse.js';

interface TelegramUpdate {
  message?: TelegramMessage;
}

async function persistTelegramMedia(botToken: string, hint: TelegramInboundHint): Promise<ChannelMedia | undefined> {
  const url = await getTelegramFileUrl(botToken, hint.fileId);
  if (!url) return undefined;
  try {
    const saved = await persistRemoteMediaUrl(url, {
      fileName: hint.fileName,
      contentType: hint.contentType,
    });
    return {
      ...saved,
      kind: hint.kind,
      caption: hint.caption,
      external_media_id: hint.fileId,
    };
  } catch {
    return undefined;
  }
}

export async function handleTelegramWebhook(
  botToken: string,
  payload: TelegramUpdate,
  hooks: ChannelIncomingHooks,
): Promise<void> {
  const msg = payload.message;
  if (!msg) return;
  const inbound = extractTelegramInbound(msg);
  if (!inbound) return;

  const channel = await prisma.channel_telegram.findFirst({ where: { bot_token: botToken } });
  if (!channel) return;

  const inbox = await resolveInbox(CHANNEL_TYPES.TELEGRAM, channel.id);
  if (!inbox) return;

  const sourceId = String(msg.chat.id);
  const name = msg.from?.first_name ?? msg.from?.username ?? `TG ${sourceId}`;
  const media = inbound.hint ? await persistTelegramMedia(botToken, inbound.hint) : undefined;

  await processIncomingMessage(
    {
      accountId: channel.account_id,
      inboxId: inbox.id,
      sourceId,
      contactName: name,
      content: inbound.content,
      media,
      externalMessageId: String(msg.message_id),
      contactPrefix: 'telegram',
    },
    hooks,
  );
}
