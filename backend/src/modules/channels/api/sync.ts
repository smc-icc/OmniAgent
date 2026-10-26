import { randomBytes } from 'crypto';
import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';
import { apiWebhookUrl, weiboWebhookUrl, miniprogramWebhookUrl } from '../../../shared/channels/webhook-urls.js';

export async function syncApiChannel(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
  channelType: string = CHANNEL_TYPES.API,
  defaultName = 'API 渠道',
) {
  const inboxName = String(data.inbox_name ?? data.name ?? defaultName);
  const isUpdate = omniChannelId != null && omniChannelId > 0;

  const extraAttrs =
    data.additional_attributes && typeof data.additional_attributes === 'object'
      ? (data.additional_attributes as object)
      : {
          ...(data.app_key ? { app_key: String(data.app_key) } : {}),
          ...(data.app_secret ? { app_secret: String(data.app_secret) } : {}),
          ...(data.kind ? { kind: String(data.kind) } : {}),
        };

  let channel;
  if (isUpdate) {
    channel = await prisma.channel_api.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.webhook_url !== undefined && { webhook_url: data.webhook_url ? String(data.webhook_url) : null }),
        ...(data.hmac_mandatory !== undefined && { hmac_mandatory: Boolean(data.hmac_mandatory) }),
        ...(Object.keys(extraAttrs).length ? { additional_attributes: extraAttrs } : {}),
      },
    });
  } else {
    channel = await prisma.channel_api.create({
      data: {
        account_id: accountId,
        identifier: randomBytes(8).toString('hex'),
        hmac_token: randomBytes(16).toString('hex'),
        webhook_url: data.webhook_url ? String(data.webhook_url) : null,
        hmac_mandatory: Boolean(data.hmac_mandatory),
        additional_attributes: extraAttrs,
      },
    });
  }

  const inbox = await ensureInbox(accountId, channelType, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    identifier: channel.identifier,
    hmac_token: channel.hmac_token,
    webhook_url:
      channelType === CHANNEL_TYPES.WEIBO
        ? weiboWebhookUrl(channel.identifier || '')
        : channelType === CHANNEL_TYPES.MINIPROGRAM
          ? miniprogramWebhookUrl(channel.identifier || '')
          : apiWebhookUrl(channel.identifier || ''),
  };
}

export async function syncWeiboChannel(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  return syncApiChannel(accountId, omniChannelId, { ...data, kind: 'weibo' }, CHANNEL_TYPES.WEIBO, '微博');
}

export async function syncMiniprogramChannel(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  return syncApiChannel(accountId, omniChannelId, { ...data, kind: 'miniprogram' }, CHANNEL_TYPES.MINIPROGRAM, '微信小程序');
}

export async function deleteApiChannel(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.API, omniChannelId);
  await prisma.channel_api.delete({ where: { id: omniChannelId } });
}

export async function deleteWeiboChannel(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.WEIBO, omniChannelId);
  await prisma.channel_api.delete({ where: { id: omniChannelId } });
}

export async function deleteMiniprogramChannel(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.MINIPROGRAM, omniChannelId);
  await prisma.channel_api.delete({ where: { id: omniChannelId } });
}
