import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';
import { instagramWebhookUrl } from '../../../shared/channels/webhook-urls.js';

export async function syncInstagram(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const inboxName = String(data.inbox_name ?? data.name ?? 'Instagram');
  const instagramId = String(data.instagram_id ?? '');
  const accessToken = String(data.access_token ?? '');
  if (!instagramId || !accessToken) throw new Error('instagram_id and access_token required');

  const expiresAt = data.expires_at
    ? new Date(String(data.expires_at))
    : new Date(Date.now() + 60 * 24 * 3600 * 1000);

  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  if (isUpdate) {
    channel = await prisma.channel_instagram.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.access_token !== undefined && { access_token: accessToken }),
        ...(data.expires_at !== undefined && { expires_at: expiresAt }),
      },
    });
  } else {
    channel = await prisma.channel_instagram.create({
      data: {
        account_id: accountId,
        instagram_id: instagramId,
        access_token: accessToken,
        expires_at: expiresAt,
      },
    });
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.INSTAGRAM, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: instagramWebhookUrl(),
  };
}

export async function deleteInstagram(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.INSTAGRAM, omniChannelId);
  await prisma.channel_instagram.delete({ where: { id: omniChannelId } });
}
