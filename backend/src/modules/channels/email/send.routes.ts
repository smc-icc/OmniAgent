import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../plugins/db.js';
import { sendEmailToAddress } from './outgoing.js';

/**
 * 跨渠道发邮件接口。
 *
 * 与短信侧 /api/sms-templates 对称：坐席在任意渠道的会话里，都能用账号的邮件渠道
 * 把邮件发给指定地址（客户在 Widget 聊过、坐席改用邮件跟进这种场景）。
 */

interface AccountCtx {
  accountId: number;
  role: 'administrator' | 'agent';
  userId: number;
}

/**
 * 取当前账号信息。
 * 注意：auth 插件只填 currentUser，`accounts` 数组从不填充，
 * 所以这里直接查 account_users（与 sms/templates.routes.ts 的做法一致）。
 */
async function resolveAccount(request: FastifyRequest): Promise<AccountCtx | null> {
  const user = (request as FastifyRequest & { currentUser?: { id?: number } }).currentUser;
  const headerAccount = Number(
    (request.headers['x-account-id'] as string | undefined) ?? 0,
  );
  const where: Record<string, unknown> = {};
  if (user?.id) where.user_id = user.id;
  if (Number.isFinite(headerAccount) && headerAccount > 0) where.account_id = headerAccount;

  const row = user?.id
    ? await prisma.account_users.findFirst({
      where,
      orderBy: { id: 'asc' },
    })
    : null;
  if (!row?.account_id || !row.user_id) return null;
  return {
    accountId: row.account_id,
    role: row.role === 0 ? 'administrator' : 'agent',
    userId: row.user_id,
  };
}

/** 发送弹窗所需的上下文：客户邮箱 + 会话信息 */
export async function getEmailSendContext(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await resolveAccount(request);
  if (!ctx) return reply.status(401).send({ error: 'account required' });

  const conversationId = Number((request.query as Record<string, unknown>)?.conversationId ?? 0);
  let contact: { id: number; name: string; email: string | null; phone_number: string | null } | null = null;
  let conversation: { id: number; display_id: number } | null = null;

  if (conversationId) {
    const conv = await prisma.conversations.findFirst({
      where: { id: conversationId, account_id: ctx.accountId },
      select: { id: true, display_id: true, contact_id: true },
    });
    if (conv) {
      conversation = { id: conv.id, display_id: conv.display_id };
      if (conv.contact_id) {
        const c = await prisma.contacts.findUnique({
          where: { id: conv.contact_id },
          select: { id: true, name: true, email: true, phone_number: true },
        });
        if (c) contact = c;
      }
    }
  }

  // 客户来源标识也可能是邮箱（邮件渠道的 contact_inbox.source_id）
  let sourceEmail: string | null = null;
  if (conversationId && !contact?.email) {
    const conv = await prisma.conversations.findFirst({
      where: { id: conversationId, account_id: ctx.accountId },
      select: { contact_id: true, inbox_id: true },
    });
    if (conv?.contact_id) {
      const ci = await prisma.contact_inboxes.findFirst({
        where: { inbox_id: conv.inbox_id, contact_id: conv.contact_id },
        select: { source_id: true },
      });
      const s = String(ci?.source_id ?? '').trim();
      if (s.includes('@')) sourceEmail = s;
    }
  }

  const channel = await prisma.channel_email.findFirst({ where: { account_id: ctx.accountId } });

  return reply.send({
    contact,
    conversation,
    from_email: channel?.email ?? null,
    smtp_enabled: Boolean(channel?.smtp_enabled && channel?.smtp_address && channel?.smtp_login),
    suggested_to: contact?.email || sourceEmail || '',
  });
}

interface SendBody {
  to?: string;
  subject?: string;
  content?: string;
  conversationId?: number;
}

export async function sendEmailFromAgent(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await resolveAccount(request);
  if (!ctx) return reply.status(401).send({ error: 'account required' });

  const body = (request.body ?? {}) as SendBody;
  const to = String(body.to ?? '').trim();
  const subject = String(body.subject ?? '').trim();
  const content = String(body.content ?? '').trim();

  if (!to) return reply.status(400).send({ error: '请填写收件人邮箱' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return reply.status(400).send({ error: '收件人邮箱格式不正确' });
  }
  if (!content) return reply.status(400).send({ error: '请填写邮件正文' });

  const result = await sendEmailToAddress(ctx.accountId, to, subject, content);
  if (!result.ok) {
    // 未配置 SMTP / 网关报错都返回可读错误，不抛 500
    return reply.status(400).send({ error: result.error ?? '邮件发送失败' });
  }

  // 落到会话时间线（跨渠道触达记录），前端据此渲染"邮件触达"气泡
  let messageId: number | null = null;
  const conversationId = Number(body.conversationId ?? 0);
  if (conversationId) {
    const conv = await prisma.conversations.findFirst({
      where: { id: conversationId, account_id: ctx.accountId },
      select: { id: true, inbox_id: true },
    });
    if (conv) {
      const msg = await prisma.messages.create({
        data: {
          account_id: ctx.accountId,
          inbox_id: conv.inbox_id,
          conversation_id: conv.id,
          content,
          message_type: 1,
          content_type: 0,
          content_attributes: {
            kind: 'email_outbound',
            to,
            subject: subject || null,
            status: 'sent',
          } as object,
        },
      });
      messageId = msg.id;
      await prisma.conversations.update({
        where: { id: conv.id },
        data: { last_activity_at: new Date() },
      });
    }
  }

  return reply.send({ success: true, to, subject, messageId });
}

export async function emailSendRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };
  fastify.get('/api/email/send-context', auth, getEmailSendContext);
  fastify.post('/api/email/send', auth, sendEmailFromAgent);
}
