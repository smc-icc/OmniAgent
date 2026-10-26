import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';
import { smsWebhookUrl } from '../../../shared/channels/webhook-urls.js';

export async function syncTwilioSms(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const inboxName = String(data.inbox_name ?? data.name ?? 'Twilio SMS');
  const accountSid = String(data.account_sid ?? '');
  const authToken = String(data.auth_token ?? '');
  if (!accountSid || !authToken) throw new Error('account_sid and auth_token required');

  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  if (isUpdate) {
    channel = await prisma.channel_twilio_sms.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.auth_token !== undefined && { auth_token: authToken }),
        ...(data.phone_number !== undefined && { phone_number: data.phone_number ? String(data.phone_number) : null }),
        ...(data.messaging_service_sid !== undefined && {
          messaging_service_sid: data.messaging_service_sid ? String(data.messaging_service_sid) : null,
        }),
      },
    });
  } else {
    channel = await prisma.channel_twilio_sms.create({
      data: {
        account_id: accountId,
        account_sid: accountSid,
        auth_token: authToken,
        phone_number: data.phone_number ? String(data.phone_number) : null,
        messaging_service_sid: data.messaging_service_sid ? String(data.messaging_service_sid) : null,
      },
    });
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.TWILIO_SMS, channel.id, inboxName);
  const phone = channel.phone_number ?? channel.messaging_service_sid ?? String(channel.id);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: smsWebhookUrl(phone),
  };
}

export async function syncGenericSms(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const inboxName = String(data.inbox_name ?? data.name ?? 'SMS');
  const phoneNumber = String(data.phone_number ?? '');
  if (!phoneNumber) throw new Error('phone_number required');

  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  if (isUpdate) {
    channel = await prisma.channel_sms.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.provider !== undefined && { provider: String(data.provider) }),
        ...(data.provider_config !== undefined && { provider_config: data.provider_config as object }),
      },
    });
  } else {
    channel = await prisma.channel_sms.create({
      data: {
        account_id: accountId,
        phone_number: phoneNumber,
        provider: String(data.provider ?? 'default'),
        provider_config: (data.provider_config ?? {}) as object,
      },
    });
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.SMS, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: smsWebhookUrl(channel.phone_number),
  };
}

export async function deleteTwilioSms(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.TWILIO_SMS, omniChannelId);
  await prisma.channel_twilio_sms.delete({ where: { id: omniChannelId } });
}

export async function deleteGenericSms(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.SMS, omniChannelId);
  await prisma.channel_sms.delete({ where: { id: omniChannelId } });
}
