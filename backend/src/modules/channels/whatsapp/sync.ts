import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';
import { whatsappWebhookUrl } from '../../../shared/channels/webhook-urls.js';

export async function syncWhatsapp(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const inboxName = String(data.inbox_name ?? data.name ?? 'WhatsApp');
  const phoneNumber = String(data.phone_number ?? '');
  if (!phoneNumber) throw new Error('phone_number required');

  const providerConfig = (data.provider_config ?? {}) as Record<string, unknown>;
  if (data.access_token) providerConfig.access_token = data.access_token;

  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  if (isUpdate) {
    channel = await prisma.channel_whatsapp.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.provider !== undefined && { provider: String(data.provider) }),
        ...(Object.keys(providerConfig).length && { provider_config: providerConfig as object }),
      },
    });
  } else {
    channel = await prisma.channel_whatsapp.create({
      data: {
        account_id: accountId,
        phone_number: phoneNumber,
        provider: String(data.provider ?? 'whatsapp_cloud'),
        provider_config: providerConfig as object,
      },
    });
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.WHATSAPP, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: whatsappWebhookUrl(channel.phone_number),
  };
}

export async function deleteWhatsapp(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.WHATSAPP, omniChannelId);
  await prisma.channel_whatsapp.delete({ where: { id: omniChannelId } });
}
