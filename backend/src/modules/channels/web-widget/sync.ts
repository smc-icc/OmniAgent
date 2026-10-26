import { randomBytes } from 'crypto';
import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';
import { widgetScriptUrl } from '../../../shared/channels/webhook-urls.js';

function genToken(): string {
  return randomBytes(16).toString('hex');
}

export async function syncWebWidget(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const inboxName = String(data.inbox_name ?? data.name ?? '网站 Widget');
  const isUpdate = omniChannelId != null && omniChannelId > 0;

  let channel;
  if (isUpdate) {
    channel = await prisma.channel_web_widgets.update({
      where: { id: omniChannelId! },
      data: {
        ...(data.website_url !== undefined && { website_url: String(data.website_url) }),
        ...(data.widget_color !== undefined && { widget_color: String(data.widget_color) }),
        ...(data.welcome_title !== undefined && { welcome_title: data.welcome_title ? String(data.welcome_title) : null }),
        ...(data.welcome_tagline !== undefined && { welcome_tagline: data.welcome_tagline ? String(data.welcome_tagline) : null }),
        ...(data.allowed_domains !== undefined && { allowed_domains: String(data.allowed_domains) }),
      },
    });
  } else {
    channel = await prisma.channel_web_widgets.create({
      data: {
        account_id: accountId,
        website_url: data.website_url ? String(data.website_url) : null,
        website_token: genToken(),
        widget_color: String(data.widget_color ?? '#1f93ff'),
        welcome_title: data.welcome_title ? String(data.welcome_title) : null,
        welcome_tagline: data.welcome_tagline ? String(data.welcome_tagline) : null,
        allowed_domains: String(data.allowed_domains ?? ''),
        hmac_token: genToken(),
      },
    });
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.WEB_WIDGET, channel.id, inboxName);
  const token = channel.website_token ?? '';

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
    website_token: token,
    widget_script_url: token ? widgetScriptUrl(token) : undefined,
  };
}

export async function deleteWebWidget(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.WEB_WIDGET, omniChannelId);
  await prisma.channel_web_widgets.delete({ where: { id: omniChannelId } });
}
