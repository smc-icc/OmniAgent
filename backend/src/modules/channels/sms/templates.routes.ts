import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../plugins/db.js';
import { sendSmsToNumber } from './outgoing.js';
import { requirePermission, getAccess } from '../../access/access.context.js';

/**
 * 短信模板 + 定向发送。
 *
 * 设计要点（合规）：
 *  - 模板由班长（administrator）维护，正文与签名对应运营商报备内容，坐席不可改写；
 *  - 坐席只能选用 status=approved 的模板，并填写模板里声明的变量；
 *  - provider_template_id 预留给正式网关（阿里云/腾讯云等）的报备模板 ID。
 */

const VARIABLE_SOURCES = [
  'manual',
  'contact.name',
  'contact.phone_number',
  'conversation.display_id',
  'agent.name',
  'date.today',
] as const;

const templateSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(['notice', 'followup', 'marketing']).default('notice'),
  signature: z.string().max(40).default(''),
  body: z.string().min(1).max(1000),
  variables: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        label: z.string().max(60).default(''),
        source: z.enum(VARIABLE_SOURCES).default('manual'),
        required: z.boolean().default(false),
        default: z.string().max(200).optional(),
      }),
    )
    .default([]),
  provider: z.string().max(40).optional().nullable(),
  provider_template_id: z.string().max(120).optional().nullable(),
  status: z.enum(['draft', 'pending', 'approved', 'disabled']).default('draft'),
});

const sendSchema = z.object({
  to: z.string().min(3).max(40),
  variables: z.record(z.string().max(200)).default({}),
  conversationId: z.number().int().positive().optional(),
});

type AccountCtx = { accountId: number; role: 'administrator' | 'agent'; userId: number };

/**
 * 解析当前账号与角色。
 * 注意：auth 插件只填充 currentUser（`accounts` 是空数组，并未查询），
 * 所以这里直接查 account_users：优先用 X-Account-Id，否则取该用户所属的第一个账号。
 * role 在库里是 Int：0=administrator，1=agent。
 */
async function resolveAccount(request: FastifyRequest): Promise<AccountCtx | null> {
  const userId = request.currentUser?.id;
  if (!userId) return null;
  const headerId = Number(request.headers['x-account-id'] ?? 0);
  const au = await prisma.account_users.findFirst({
    where: { user_id: userId, ...(headerId > 0 ? { account_id: headerId } : {}) },
    orderBy: { id: 'asc' },
  });
  if (!au?.account_id) return null;
  return {
    accountId: au.account_id,
    role: (await getAccess(request)).permissions.some(p => ['sms.create', 'sms.update', 'sms.delete'].includes(p)) ? 'administrator' : 'agent',
    userId,
  };
}

/** 渲染模板：{{key}} -> 变量值；未提供的变量按 default 回退 */
function renderTemplate(
  tpl: { signature: string; body: string; variables: unknown },
  values: Record<string, string>,
): string {
  let text = String(tpl.body ?? '');
  const defs = Array.isArray(tpl.variables) ? (tpl.variables as Array<Record<string, unknown>>) : [];
  for (const def of defs) {
    const key = String(def.key ?? '');
    if (!key) continue;
    const raw = values[key];
    const val = raw != null && String(raw).length ? String(raw) : String(def.default ?? '');
    text = text.replaceAll(`{{${key}}}`, val);
  }
  // 兜底：模板里残留的未声明占位符清空，避免把 {{xxx}} 直接发出去
  text = text.replace(/\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/g, '');
  const signature = String(tpl.signature ?? '').trim();
  return (signature ? `${signature}${text}` : text).trim();
}

function defaultValueOf(defs: Array<Record<string, unknown>>, key: string): unknown {
  const hit = defs.find((d) => String(d.key ?? '') === key);
  return hit?.default ?? '';
}

// ── CRUD ──

export async function listSmsTemplates(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await resolveAccount(request);
  if (!ctx) return reply.status(401).send({ error: 'account required' });

  // 坐席只看到可用模板；班长可看到全部（含草稿）
  const where =
    ctx.role === 'administrator'
      ? { account_id: ctx.accountId }
      : { account_id: ctx.accountId, status: 'approved' };

  const items = await prisma.sms_templates.findMany({
    where,
    orderBy: [{ status: 'asc' }, { updated_at: 'desc' }],
  });
  return reply.send({ items, role: ctx.role });
}

export async function createSmsTemplate(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await resolveAccount(request);
  if (!ctx) return reply.status(401).send({ error: 'account required' });
  await requirePermission(request, 'sms.create');

  const parsed = templateSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: '参数不合法', detail: parsed.error.issues });

  const created = await prisma.sms_templates.create({
    data: {
      account_id: ctx.accountId,
      ...parsed.data,
      variables: parsed.data.variables as object,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    },
  });
  return reply.send({ success: true, data: created });
}

export async function updateSmsTemplate(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await resolveAccount(request);
  if (!ctx) return reply.status(401).send({ error: 'account required' });
  await requirePermission(request, 'sms.update');

  const { id } = request.params as { id: string };
  const parsed = templateSchema.partial().safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: '参数不合法', detail: parsed.error.issues });

  const exists = await prisma.sms_templates.findFirst({
    where: { id: Number(id), account_id: ctx.accountId },
  });
  if (!exists) return reply.status(404).send({ error: '模板不存在' });

  const { variables, ...rest } = parsed.data;
  const updated = await prisma.sms_templates.update({
    where: { id: Number(id) },
    data: {
      ...rest,
      ...(variables ? { variables: variables as object } : {}),
      updated_by: ctx.userId,
    },
  });
  return reply.send({ success: true, data: updated });
}

export async function deleteSmsTemplate(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await resolveAccount(request);
  if (!ctx) return reply.status(401).send({ error: 'account required' });
  await requirePermission(request, 'sms.delete');

  const { id } = request.params as { id: string };
  const exists = await prisma.sms_templates.findFirst({
    where: { id: Number(id), account_id: ctx.accountId },
  });
  if (!exists) return reply.status(404).send({ error: '模板不存在' });

  await prisma.sms_templates.delete({ where: { id: Number(id) } });
  return reply.send({ success: true });
}

// ── 发送 ──

export async function sendSmsTemplate(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await resolveAccount(request);
  if (!ctx) return reply.status(401).send({ error: 'account required' });

  const { id } = request.params as { id: string };
  const parsed = sendSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: '参数不合法', detail: parsed.error.issues });
  const { to, variables, conversationId } = parsed.data;

  const tpl = await prisma.sms_templates.findFirst({
    where: { id: Number(id), account_id: ctx.accountId },
  });
  if (!tpl) return reply.status(404).send({ error: '模板不存在' });
  // 合规：坐席只能用已审批模板，防止绕过报备内容
  if (tpl.status !== 'approved') return reply.status(400).send({ error: '模板未审批通过，不能发送' });

  // 必填变量校验
  const defs = Array.isArray(tpl.variables) ? (tpl.variables as Array<Record<string, unknown>>) : [];
  const missing = defs
    .filter((d) => d.required === true)
    .map((d) => String(d.key ?? ''))
    .filter((k) => k && !String(variables[k] ?? defaultValueOf(defs, k) ?? '').length);
  if (missing.length) {
    return reply.status(400).send({ error: `缺少必填变量：${missing.join('、')}` });
  }

  const text = renderTemplate(tpl, variables);
  const result = await sendSmsToNumber(ctx.accountId, to, text, {
    provider: tpl.provider,
    providerTemplateId: tpl.provider_template_id,
  });
  if (!result.ok) {
    // 未配置网关 / 网关报错都走这里：返回可读错误，不抛 500
    return reply.status(400).send({ error: result.error ?? '短信发送失败', text });
  }

  // 落到会话时间线（跨渠道触达记录），前端据此渲染"短信触达"气泡
  let messageId: number | null = null;
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
          sender_type: 'User',
          sender_id: ctx.userId,
          message_type: 1, // outgoing
          content: text,
          content_attributes: {
            kind: 'sms_outbound',
            template_id: tpl.id,
            template_name: tpl.name,
            to,
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

  return reply.send({ success: true, text, messageId });
}

/**
 * 发送弹窗所需的上下文：可选模板 + 客户联系方式 + 会话信息。
 * 前端只知道 conversationId，手机号/邮箱需要这里一并返回（前端目前没有 phone_number 字段）。
 */
export async function getSmsSendContext(request: FastifyRequest, reply: FastifyReply) {
  const ctx = await resolveAccount(request);
  if (!ctx) return reply.status(401).send({ error: 'account required' });

  const conversationId = Number((request.query as Record<string, unknown>)?.conversationId ?? 0);
  let contact: { id: number; name: string; phone_number: string | null; email: string | null } | null = null;
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
          select: { id: true, name: true, phone_number: true, email: true },
        });
        if (c) contact = c;
      }
    }
  }

  const templates = await prisma.sms_templates.findMany({
    where: {
      account_id: ctx.accountId,
      ...(ctx.role === 'administrator' ? {} : { status: 'approved' }),
    },
    orderBy: { name: 'asc' },
  });

  return reply.send({ templates, contact, conversation, role: ctx.role });
}

// ── Routes ──

export async function smsTemplateRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/sms-templates', auth, listSmsTemplates);
  fastify.get('/api/sms-templates/send-context', auth, getSmsSendContext);
  fastify.post('/api/sms-templates', auth, createSmsTemplate);
  fastify.put('/api/sms-templates/:id', auth, updateSmsTemplate);
  fastify.delete('/api/sms-templates/:id', auth, deleteSmsTemplate);
  fastify.post('/api/sms-templates/:id/send', auth, sendSmsTemplate);
}
