import nodemailer from 'nodemailer';
import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { readPersistedMedia, type ChannelMedia } from '../../../shared/services/channel-media.js';

export async function sendEmailReply(
  conversationId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.EMAIL) {
    return { ok: false, error: 'not email' };
  }

  const channel = await prisma.channel_email.findUnique({ where: { id: conv.inbox.channel_id } });
  if (!channel?.smtp_enabled) return { ok: false, error: 'smtp not enabled' };

  const ci = await prisma.contact_inboxes.findFirst({
    where: { inbox_id: conv.inbox_id, contact_id: conv.contact_id ?? 0 },
  });
  if (!ci?.source_id) return { ok: false, error: 'recipient missing' };

  try {
    const transport = nodemailer.createTransport({
      host: channel.smtp_address,
      port: channel.smtp_port,
      secure: channel.smtp_enable_ssl_tls,
      auth: channel.smtp_login
        ? { user: channel.smtp_login, pass: channel.smtp_password }
        : undefined,
    });

    await transport.sendMail({
      from: channel.email,
      to: ci.source_id,
      subject: `Re: ${conv.display_id}`,
      text: content,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

export async function sendEmailMedia(
  conversationId: number,
  _messageId: number,
  media: ChannelMedia,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox || conv.inbox.channel_type !== CHANNEL_TYPES.EMAIL) {
    return { ok: false, error: 'not email' };
  }
  const channel = await prisma.channel_email.findUnique({ where: { id: conv.inbox.channel_id } });
  if (!channel?.smtp_enabled) return { ok: false, error: 'smtp not enabled' };
  const ci = await prisma.contact_inboxes.findFirst({
    where: { inbox_id: conv.inbox_id, contact_id: conv.contact_id ?? 0 },
  });
  if (!ci?.source_id) return { ok: false, error: 'recipient missing' };

  const buf = media.file_url ? await readPersistedMedia(media.file_url) : null;
  if (!buf) return { ok: false, error: 'media file not found' };

  try {
    const implicitTls = channel.smtp_port === 465;
    const transport = nodemailer.createTransport({
      host: channel.smtp_address,
      port: channel.smtp_port,
      secure: implicitTls,
      requireTLS: !implicitTls,
      auth: channel.smtp_login
        ? { user: channel.smtp_login, pass: channel.smtp_password }
        : undefined,
    });
    const html = content
      ? `<p>${escapeHtml(content).replace(/\n/g, '<br/>')}</p>`
      : undefined;
    await transport.sendMail({
      from: channel.email,
      to: ci.source_id,
      subject: `Re: ${conv.display_id}`,
      text: content || media.file_name || '[附件]',
      html,
      attachments: [{
        filename: media.file_name || 'file',
        content: buf,
        contentType: media.content_type,
      }],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 定向发邮件：用账号下的邮件渠道 SMTP 发给**任意地址**，不要求会话属于邮件渠道。
 *
 * 与 sendEmailReply 的区别：后者只能在邮件会话内回复；本函数支持跨渠道触达
 * （客户在 Widget 聊过、坐席改用邮件跟进），与短信的 sendSmsToNumber 对称。
 */
export async function sendEmailToAddress(
  accountId: number,
  to: string,
  subject: string,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const email = String(to || '').trim();
  if (!email) return { ok: false, error: 'to required' };

  const channel = await prisma.channel_email.findFirst({ where: { account_id: accountId } });
  if (!channel) return { ok: false, error: 'no email channel configured' };
  if (!channel.smtp_address || !channel.smtp_login) {
    return { ok: false, error: 'smtp not configured' };
  }

  try {
    // 465 用隐式 TLS；587 等用 STARTTLS（secure=false + requireTLS），
    // 注意不能直接用 smtp_enable_ssl_tls 字段——QQ 邮箱 587 必须走 STARTTLS。
    const implicitTls = channel.smtp_port === 465;
    const transport = nodemailer.createTransport({
      host: channel.smtp_address,
      port: channel.smtp_port,
      secure: implicitTls,
      requireTLS: !implicitTls,
      auth: { user: channel.smtp_login, pass: channel.smtp_password },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });

    await transport.sendMail({
      from: channel.email,
      to: email,
      subject: subject.trim() || '(无主题)',
      text: content,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
