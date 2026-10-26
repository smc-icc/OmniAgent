import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';
import { lineWebhookUrl } from '../../../shared/channels/webhook-urls.js';

export async function syncLine(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const inboxName = String(data.inbox_name ?? data.name ?? 'LINE');
  const lineChannelId = String(data.line_channel_id ?? '');
  const lineChannelSecret = String(data.line_channel_secret ?? '');
  const lineChannelToken = String(data.line_channel_token ?? '');
  if (!lineChannelId || !lineChannelSecret || !lineChannelToken) {
    throw new Error('line_channel_id, line_channel_secret, line_channel_token required');
  }

  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  if (isUpdate) {
    channel = await prisma.channel_line.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.line_channel_secret !== undefined && { line_channel_secret: lineChannelSecret }),
        ...(data.line_channel_token !== undefined && { line_channel_token: lineChannelToken }),
      },
    });
  } else {
    channel = await prisma.channel_line.create({
      data: {
        account_id: accountId,
        line_channel_id: lineChannelId,
        line_channel_secret: lineChannelSecret,
        line_channel_token: lineChannelToken,
      },
    });
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.LINE, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: lineWebhookUrl(channel.line_channel_id),
  };
}

export async function deleteLine(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.LINE, omniChannelId);
  await prisma.channel_line.delete({ where: { id: omniChannelId } });
}
