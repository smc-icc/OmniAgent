import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { resolveInbox, processIncomingMessage, type ChannelIncomingHooks } from '../../../shared/services/channel-incoming.js';

interface TiktokPayload {
  event?: string;
  business_id?: string;
  content?: { text?: string; message_id?: string };
  user?: { user_id?: string; display_name?: string };
}

export async function handleTiktokWebhook(
  payload: TiktokPayload,
  hooks: ChannelIncomingHooks,
): Promise<void> {
  if (payload.event !== 'im_receive_message' || !payload.business_id) return;

  const channel = await prisma.channel_tiktok.findFirst({ where: { business_id: payload.business_id } });
  if (!channel) return;

  const inbox = await resolveInbox(CHANNEL_TYPES.TIKTOK, channel.id);
  if (!inbox) return;

  const text = payload.content?.text;
  const userId = payload.user?.user_id;
  if (!text || !userId) return;

  await processIncomingMessage(
    {
      accountId: channel.account_id,
      inboxId: inbox.id,
      sourceId: userId,
      contactName: payload.user?.display_name ?? `TT ${userId.slice(-6)}`,
      content: text,
      externalMessageId: payload.content?.message_id,
      contactPrefix: 'tiktok',
    },
    hooks,
  );
}
