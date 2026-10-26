import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { resolveInbox, processIncomingMessage, type ChannelIncomingHooks } from '../../../shared/services/channel-incoming.js';
import {
  messengerPlaceholder,
  nextMessengerWindowUntil,
  persistMessengerAttachment,
  type MessengerMessage,
} from './attachments.js';

interface FbPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender: { id: string };
      message?: MessengerMessage;
    }>;
  }>;
}

export async function handleFacebookWebhook(
  payload: FbPayload,
  hooks: ChannelIncomingHooks,
): Promise<void> {
  if (payload.object !== 'page') return;

  for (const entry of payload.entry ?? []) {
    const pageId = entry.id;
    if (!pageId) continue;

    const channel = await prisma.channel_facebook_pages.findFirst({ where: { page_id: pageId } });
    if (!channel) continue;

    const inbox = await resolveInbox(CHANNEL_TYPES.FACEBOOK, channel.id);
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
          contactName: `FB ${ev.sender.id.slice(-6)}`,
          content,
          media,
          externalMessageId: ev.message?.mid,
          contactPrefix: 'facebook',
          conversationAttributes: {
            messenger_window_until: nextMessengerWindowUntil(),
          },
        },
        hooks,
      );
    }
  }
}
