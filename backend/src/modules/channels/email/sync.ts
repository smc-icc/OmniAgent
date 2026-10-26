import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { ensureInbox, deleteInboxForChannel } from '../../../shared/channels/ensure-inbox.js';

export async function syncEmail(
  accountId: number,
  omniChannelId: number | null | undefined,
  data: Record<string, unknown>,
) {
  const inboxName = String(data.inbox_name ?? data.name ?? 'Email');
  const email = String(data.email ?? '');
  const forwardTo = String(data.forward_to_email ?? email);
  if (!email) throw new Error('email required');

  const isUpdate = omniChannelId != null && omniChannelId > 0;
  let channel;
  if (isUpdate) {
    channel = await prisma.channel_email.update({
      where: { id: omniChannelId! },
      data: buildEmailUpdate(data),
    });
  } else {
    channel = await prisma.channel_email.create({
      data: {
        account_id: accountId,
        email,
        forward_to_email: forwardTo,
        ...buildEmailCreate(data),
      },
    });
  }

  const inbox = await ensureInbox(accountId, CHANNEL_TYPES.EMAIL, channel.id, inboxName);

  return {
    omni_channel_id: channel.id,
    omni_inbox_id: inbox.id,
  };
}

function buildEmailCreate(data: Record<string, unknown>) {
  return {
    imap_enabled: Boolean(data.imap_enabled),
    imap_address: String(data.imap_address ?? ''),
    imap_port: Number(data.imap_port ?? 993),
    imap_login: String(data.imap_login ?? ''),
    imap_password: String(data.imap_password ?? ''),
    imap_enable_ssl: data.imap_enable_ssl !== false,
    smtp_enabled: Boolean(data.smtp_enabled),
    smtp_address: String(data.smtp_address ?? ''),
    smtp_port: Number(data.smtp_port ?? 587),
    smtp_login: String(data.smtp_login ?? ''),
    smtp_password: String(data.smtp_password ?? ''),
    smtp_domain: String(data.smtp_domain ?? ''),
    smtp_enable_starttls_auto: data.smtp_enable_starttls_auto !== false,
    smtp_authentication: String(data.smtp_authentication ?? 'login'),
    provider: data.provider ? String(data.provider) : null,
  };
}

function buildEmailUpdate(data: Record<string, unknown>) {
  const u: Record<string, unknown> = {};
  const keys = [
    'email', 'forward_to_email', 'imap_enabled', 'imap_address', 'imap_port', 'imap_login',
    'imap_password', 'imap_enable_ssl', 'smtp_enabled', 'smtp_address', 'smtp_port',
    'smtp_login', 'smtp_password', 'smtp_domain', 'smtp_enable_starttls_auto',
    'smtp_authentication', 'provider',
  ];
  for (const k of keys) {
    if (data[k] !== undefined) u[k] = data[k];
  }
  return u;
}

export async function deleteEmail(omniChannelId: number) {
  await deleteInboxForChannel(CHANNEL_TYPES.EMAIL, omniChannelId);
  await prisma.channel_email.delete({ where: { id: omniChannelId } });
}
