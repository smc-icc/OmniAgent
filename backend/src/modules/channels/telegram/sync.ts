import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';
import { telegramWebhookUrl } from '../../../shared/channels/webhook-urls.js';
import { registerTelegramWebhook } from './telegram-api.js';

export async function syncTelegram(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const botToken = String(data.bot_token ?? '');
  if (!botToken) throw new Error('bot_token required');

  const inboxName = String(data.inbox_name ?? data.bot_name ?? 'Telegram');
  const isUpdate = omniChannelId != null && omniChannelId > 0;

  let channel;
  if (isUpdate) {
    channel = await prisma.channel_telegram.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.bot_token !== undefined && { bot_token: botToken }),
        ...(data.bot_name !== undefined && { bot_name: data.bot_name ? String(data.bot_name) : null }),
      },
    });
  } else {
    channel = await prisma.channel_telegram.create({
      data: {
        account_id: accountId,
        bot_token: botToken,
        bot_name: data.bot_name ? String(data.bot_name) : null,
      },
    });
  }

  const webhookUrl = telegramWebhookUrl(channel.bot_token);
  await registerTelegramWebhook(channel.bot_token, webhookUrl);

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.TELEGRAM, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    webhook_url: webhookUrl,
  };
}

export async function deleteTelegram(omniChannelId: number) {
  const ch = await prisma.channel_telegram.findUnique({ where: { id: omniChannelId } });
  if (ch) {
    await fetch(`https://api.telegram.org/bot${ch.bot_token}/deleteWebhook`).catch(() => {});
  }
  await deleteInboxForChannel(CHANNEL_TYPES.TELEGRAM, omniChannelId);
  await prisma.channel_telegram.delete({ where: { id: omniChannelId } });
}
