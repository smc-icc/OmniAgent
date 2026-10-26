import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';
import { facebookWebhookUrl } from '../../../shared/channels/webhook-urls.js';

export async function syncFacebook(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const inboxName = String(data.inbox_name ?? data.name ?? 'Facebook');
  const pageId = String(data.page_id ?? '');
  const pageAccessToken = String(data.page_access_token ?? '');
  const userAccessToken = String(data.user_access_token ?? pageAccessToken);
  if (!pageId || !pageAccessToken) throw new Error('page_id and page_access_token required');

  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  if (isUpdate) {
    channel = await prisma.channel_facebook_pages.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.page_access_token !== undefined && { page_access_token: pageAccessToken }),
        ...(data.user_access_token !== undefined && { user_access_token: userAccessToken }),
      },
    });
  } else {
    channel = await prisma.channel_facebook_pages.create({
      data: {
        account_id: accountId,
        page_id: pageId,
        page_access_token: pageAccessToken,
        user_access_token: userAccessToken,
        instagram_id: data.instagram_id ? String(data.instagram_id) : null,
      },
    });
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.FACEBOOK, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: facebookWebhookUrl(),
  };
}

export async function deleteFacebook(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.FACEBOOK, omniChannelId);
  await prisma.channel_facebook_pages.delete({ where: { id: omniChannelId } });
}
