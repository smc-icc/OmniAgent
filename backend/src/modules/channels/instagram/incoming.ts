import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { resolveInbox, processIncomingMessage, type ChannelIncomingHooks } from '../../../shared/services/channel-incoming.js';
import {
  messengerPlaceholder,
  nextMessengerWindowUntil,
  persistMessengerAttachment,
  type MessengerMessage,
} from '../facebook/attachments.js';

interface IgPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender: { id: string };
      message?: MessengerMessage;
    }>;
  }>;
}

export async function handleInstagramWebhook(
  payload: IgPayload,
  hooks: ChannelIncomingHooks,
): Promise<void> {
  if (payload.object !== 'instagram') return;

  for (const entry of payload.entry ?? []) {
    const igId = entry.id;
    if (!igId) continue;

    const channel = await prisma.channel_instagram.findFirst({ where: { instagram_id: igId } });
    if (!channel) continue;

    const inbox = await resolveInbox(CHANNEL_TYPES.INSTAGRAM, channel.id);
    if (!inbox) continue;

    for (const ev of entry.messaging ?? []) {
      const text = String(ev.message?.text ?? '').trim();
      const atts = ev.message?.attachments ?? [];
      if (!text && !atts.length) continue;

      const first = atts[0];
      const media = first ? await persistMessengerAttachment(first) : undefined;
      const content = text
        || (media ? messengerPlaceholder(media.kind) : first?.payload?.title)
        || '[附件]';

      await processIncomingMessage(
        {
          accountId: channel.account_id,
          inboxId: inbox.id,
          sourceId: ev.sender.id,
          contactName: `IG ${ev.sender.id.slice(-6)}`,
          content,
          media,
          externalMessageId: ev.message?.mid,
          contactPrefix: 'instagram',
          conversationAttributes: {
            messenger_window_until: nextMessengerWindowUntil(),
          },
        },
        hooks,
      );
    }
  }
}
