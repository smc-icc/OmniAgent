import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';
import { tiktokWebhookUrl } from '../../../shared/channels/webhook-urls.js';

export async function syncTiktok(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const inboxName = String(data.inbox_name ?? data.name ?? 'TikTok');
  const businessId = String(data.business_id ?? '');
  const accessToken = String(data.access_token ?? '');
  const refreshToken = String(data.refresh_token ?? '');
  if (!businessId || !accessToken) throw new Error('business_id and access_token required');

  const expiresAt = data.expires_at ? new Date(String(data.expires_at)) : new Date(Date.now() + 3600 * 1000);
  const refreshExpiresAt = data.refresh_token_expires_at
    ? new Date(String(data.refresh_token_expires_at))
    : new Date(Date.now() + 30 * 24 * 3600 * 1000);

  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  if (isUpdate) {
    channel = await prisma.channel_tiktok.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.access_token !== undefined && { access_token: accessToken }),
        ...(data.refresh_token !== undefined && { refresh_token: refreshToken }),
        ...(data.expires_at !== undefined && { expires_at: expiresAt }),
      },
    });
  } else {
    channel = await prisma.channel_tiktok.create({
      data: {
        account_id: accountId,
        business_id: businessId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        refresh_token_expires_at: refreshExpiresAt,
      },
    });
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.TIKTOK, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: tiktokWebhookUrl(),
  };
}

export async function deleteTiktok(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.TIKTOK, omniChannelId);
  await prisma.channel_tiktok.delete({ where: { id: omniChannelId } });
}
