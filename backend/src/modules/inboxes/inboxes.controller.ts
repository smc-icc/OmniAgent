import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../../plugins/db.js';
import {
  createInboxSchema, updateInboxSchema,
  createInboxMemberSchema, updateInboxMemberSchema,
  setAgentBotSchema,
  createWebWidgetSchema, updateWebWidgetSchema,
  createChannelEmailSchema,
  type CreateInboxInput, type UpdateInboxInput,
} from '../../shared/validators/inboxes.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../shared/errors/index.js';

// ── Inboxes ──

/** GET /api/v1/accounts/:account_id/inboxes */
export async function listInboxes(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const inboxes = await prisma.inboxes.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });

  return reply.status(200).send({ payload: inboxes.map(formatInbox) });
}

/** POST /api/v1/accounts/:account_id/inboxes */
export async function createInbox(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createInboxSchema.parse(request.body) as CreateInboxInput;

  const accId = parseInt(account_id, 10);
  const channelId = body.channel_id ?? 0;

  const inbox = await prisma.inboxes.create({
    data: {
      name: body.name,
      channel_id: channelId,
      channel_type: body.channel_type,
      account_id: accId,
      enable_auto_assignment: body.enable_auto_assignment,
      greeting_enabled: body.greeting_enabled,
      greeting_message: body.greeting_message,
      email_address: body.email_address,
      working_hours_enabled: body.working_hours_enabled,
      out_of_office_message: body.out_of_office_message,
      timezone: body.timezone,
      enable_email_collect: body.enable_email_collect,
      csat_survey_enabled: body.csat_survey_enabled,
      allow_messages_after_resolved: body.allow_messages_after_resolved,
      lock_to_single_conversation: body.lock_to_single_conversation,
      sender_name_type: body.sender_name_type,
      business_name: body.business_name,
    },
  });

  return reply.status(200).send(formatInbox(inbox));
}

/** GET /api/v1/accounts/:account_id/inboxes/:id */
export async function showInbox(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const inbox = await prisma.inboxes.findUnique({ where: { id: parseInt(id, 10) } });
  if (!inbox) throw new NotFoundError('Inbox');
  return reply.status(200).send(formatInbox(inbox));
}

function mergeInboxItrConfig(
  existing: unknown,
  body: { auto_assignment_config?: Record<string, unknown>; itr_flow_id?: number | null; itr_enabled?: boolean },
): object | undefined {
  if (body.auto_assignment_config === undefined && body.itr_flow_id === undefined && body.itr_enabled === undefined) {
    return undefined;
  }
  const cur = existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
  if (body.auto_assignment_config) Object.assign(cur, body.auto_assignment_config);
  if (body.itr_flow_id !== undefined) {
    if (body.itr_flow_id === null || body.itr_flow_id <= 0) delete cur.itr_flow_id;
    else cur.itr_flow_id = body.itr_flow_id;
  }
  if (body.itr_enabled !== undefined) cur.itr_enabled = body.itr_enabled;
  return cur;
}

/** PUT /api/v1/accounts/:account_id/inboxes/:id */
export async function updateInbox(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateInboxSchema.parse(request.body) as UpdateInboxInput;

  const current = await prisma.inboxes.findUnique({
    where: { id: parseInt(id, 10) },
    select: { auto_assignment_config: true },
  });
  if (!current) throw new NotFoundError('Inbox');
  const nextCfg = mergeInboxItrConfig(current.auto_assignment_config, body);

  const inbox = await prisma.inboxes.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.enable_auto_assignment !== undefined && { enable_auto_assignment: body.enable_auto_assignment }),
      ...(body.greeting_enabled !== undefined && { greeting_enabled: body.greeting_enabled }),
      ...(body.greeting_message !== undefined && { greeting_message: body.greeting_message }),
      ...(body.working_hours_enabled !== undefined && { working_hours_enabled: body.working_hours_enabled }),
      ...(body.out_of_office_message !== undefined && { out_of_office_message: body.out_of_office_message }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.enable_email_collect !== undefined && { enable_email_collect: body.enable_email_collect }),
      ...(body.csat_survey_enabled !== undefined && { csat_survey_enabled: body.csat_survey_enabled }),
      ...(body.allow_messages_after_resolved !== undefined && { allow_messages_after_resolved: body.allow_messages_after_resolved }),
      ...(body.lock_to_single_conversation !== undefined && { lock_to_single_conversation: body.lock_to_single_conversation }),
      ...(body.business_name !== undefined && { business_name: body.business_name }),
      ...(nextCfg !== undefined && { auto_assignment_config: nextCfg }),
      ...(body.csat_config !== undefined && { csat_config: body.csat_config as object }),
    },
  });

  return reply.status(200).send(formatInbox(inbox));
}

/** DELETE /api/v1/accounts/:account_id/inboxes/:id */
export async function destroyInbox(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.inboxes.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/inboxes/:id/assignable_agents */
export async function inboxAssignableAgents(request: FastifyRequest, reply: FastifyReply) {
  const { id, account_id } = request.params as { id: string; account_id: string };

  const members = await prisma.inbox_members.findMany({
    where: { inbox_id: parseInt(id, 10) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return reply.status(200).send(
    members.map((m) => ({
      id: m.user?.id, name: m.user?.name, email: m.user?.email,
    })),
  );
}

/** GET /api/v1/accounts/:account_id/inboxes/:id/campaigns */
export async function inboxCampaigns(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const campaigns = await prisma.campaigns.findMany({
    where: { inbox_id: parseInt(id, 10) },
  });
  return reply.status(200).send(campaigns);
}

/** GET /api/v1/accounts/:account_id/inboxes/:id/agent_bot */
export async function inboxAgentBot(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const botInbox = await prisma.agent_bot_inboxes.findFirst({
    where: { inbox_id: parseInt(id, 10) },
    include: { agent_bot: true },
  });
  return reply.status(200).send(botInbox?.agent_bot ?? null);
}

/** POST /api/v1/accounts/:account_id/inboxes/:id/set_agent_bot */
export async function inboxSetAgentBot(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { agent_bot_id } = setAgentBotSchema.parse(request.body);
  const inboxId = parseInt(id, 10);

  // Remove existing bot
  await prisma.agent_bot_inboxes.deleteMany({ where: { inbox_id: inboxId } });

  // Set new bot
  await prisma.agent_bot_inboxes.create({
    data: { inbox_id: inboxId, agent_bot_id, status: 0 },
  });

  return reply.status(200).send({ success: true });
}

/** DELETE /api/v1/accounts/:account_id/inboxes/:id/avatar */
export async function inboxDeleteAvatar(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/inboxes/:id/health */
export async function inboxHealth(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const inbox = await prisma.inboxes.findUnique({ where: { id: parseInt(id, 10) } });

  return reply.status(200).send({
    status: inbox ? 'ok' : 'not_found',
    inbox_id: id,
    channel_type: inbox?.channel_type ?? 'unknown',
  });
}

/** POST /api/v1/accounts/:account_id/inboxes/:id/sync_templates */
export async function inboxSyncTemplates(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ success: true, message: 'Templates synced' });
}

/** POST /api/v1/accounts/:account_id/inboxes/:id/register_webhook */
export async function inboxRegisterWebhook(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ success: true, message: 'Webhook registered' });
}

// ── Inbox Members ──

/** POST /api/v1/accounts/:account_id/inbox_members — Create/Show with param inbox_id */
export async function createInboxMembers(request: FastifyRequest, reply: FastifyReply) {
  const { user_ids } = createInboxMemberSchema.parse(request.body);

  for (const uid of user_ids) {
    const exists = await prisma.inbox_members.findFirst({
      where: { inbox_id: user_ids[0], user_id: uid },
    });
    if (!exists) {
      // Use the inbox_id from the body
      const { inbox_id } = request.body as { inbox_id: number };
      await prisma.inbox_members.create({ data: { inbox_id, user_id: uid } });
    }
  }

  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/inbox_members/:inbox_id */
export async function showInboxMembers(request: FastifyRequest, reply: FastifyReply) {
  const { inbox_id } = request.params as { inbox_id: string };
  const members = await prisma.inbox_members.findMany({
    where: { inbox_id: parseInt(inbox_id, 10) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  return reply.status(200).send({
    payload: members.map((m) => ({
      id: m.user?.id, name: m.user?.name, email: m.user?.email,
    })),
  });
}

/** PATCH /api/v1/accounts/:account_id/inbox_members — Update members */
export async function updateInboxMembers(request: FastifyRequest, reply: FastifyReply) {
  const { inbox_id, user_ids } = updateInboxMemberSchema.parse(request.body);

  await prisma.inbox_members.deleteMany({ where: { inbox_id } });
  for (const uid of user_ids) {
    await prisma.inbox_members.create({ data: { inbox_id, user_id: uid } });
  }

  return reply.status(200).send({ success: true });
}

/** DELETE /api/v1/accounts/:account_id/inbox_members — Destroy members */
export async function destroyInboxMembers(request: FastifyRequest, reply: FastifyReply) {
  const { inbox_id, user_ids } = request.body as { inbox_id: number; user_ids: number[] };
  if (user_ids?.length) {
    await prisma.inbox_members.deleteMany({
      where: { inbox_id, user_id: { in: user_ids } },
    });
  }
  return reply.status(200).send({ success: true });
}

// ── Web Widget Channel ──

/** GET /api/v1/accounts/:account_id/channel_web_widgets */
export async function getWebWidget(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const widget = await prisma.channel_web_widgets.findFirst({
    where: { account_id: parseInt(account_id, 10) },
  });
  if (!widget) throw new NotFoundError('Web Widget');
  return reply.status(200).send(formatWidget(widget));
}

/** POST /api/v1/accounts/:account_id/channel_web_widgets */
export async function createWebWidget(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createWebWidgetSchema.parse(request.body);

  const token = crypto.randomBytes(12).toString('hex');
  const hmacToken = crypto.randomBytes(12).toString('hex');

  const widget = await prisma.channel_web_widgets.create({
    data: {
      account_id: parseInt(account_id, 10),
      website_url: body.website_url,
      widget_color: body.widget_color,
      welcome_title: body.welcome_title,
      welcome_tagline: body.welcome_tagline,
      reply_time: body.reply_time,
      website_token: token,
      hmac_token: hmacToken,
      pre_chat_form_enabled: body.pre_chat_form_enabled,
      pre_chat_form_options: body.pre_chat_form_options as object,
      continuity_via_email: body.continuity_via_email,
      allowed_domains: body.allowed_domains,
    },
  });

  return reply.status(200).send(formatWidget(widget));
}

/** PUT /api/v1/accounts/:account_id/channel_web_widgets */
export async function updateWebWidget(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = updateWebWidgetSchema.parse(request.body);

  const existing = await prisma.channel_web_widgets.findFirst({
    where: { account_id: parseInt(account_id, 10) },
  });
  if (!existing) throw new NotFoundError('Web Widget');

  const widget = await prisma.channel_web_widgets.update({
    where: { id: existing.id },
    data: {
      ...(body.website_url !== undefined && { website_url: body.website_url }),
      ...(body.widget_color !== undefined && { widget_color: body.widget_color }),
      ...(body.welcome_title !== undefined && { welcome_title: body.welcome_title }),
      ...(body.welcome_tagline !== undefined && { welcome_tagline: body.welcome_tagline }),
      ...(body.reply_time !== undefined && { reply_time: body.reply_time }),
      ...(body.pre_chat_form_enabled !== undefined && { pre_chat_form_enabled: body.pre_chat_form_enabled }),
      ...(body.pre_chat_form_options !== undefined && { pre_chat_form_options: body.pre_chat_form_options as object }),
      ...(body.continuity_via_email !== undefined && { continuity_via_email: body.continuity_via_email }),
      ...(body.allowed_domains !== undefined && { allowed_domains: body.allowed_domains }),
    },
  });

  return reply.status(200).send(formatWidget(widget));
}

// ── Email Channel ──

/** POST /api/v1/accounts/:account_id/channel_email */
export async function createChannelEmail(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createChannelEmailSchema.parse(request.body);

  const channel = await prisma.channel_email.create({
    data: {
      account_id: parseInt(account_id, 10),
      email: body.email,
      forward_to_email: body.forward_to_email,
      imap_enabled: body.imap_enabled,
      imap_address: body.imap_address,
      imap_port: body.imap_port,
      imap_login: body.imap_login,
      imap_password: body.imap_password,
      imap_enable_ssl: body.imap_enable_ssl,
      smtp_enabled: body.smtp_enabled,
      smtp_address: body.smtp_address,
      smtp_port: body.smtp_port,
      smtp_login: body.smtp_login,
      smtp_password: body.smtp_password,
      smtp_domain: body.smtp_domain,
    },
  });

  return reply.status(200).send(channel);
}

// ── Twilio Channel (simplified) ──

/** POST /api/v1/accounts/:account_id/channels/twilio_channel */
export async function createTwilioChannel(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as {
    phone_number: string; account_sid: string; auth_token: string; medium?: number;
  };

  const channel = await prisma.channel_twilio_sms.create({
    data: {
      account_id: parseInt(account_id, 10),
      phone_number: body.phone_number,
      account_sid: body.account_sid,
      auth_token: body.auth_token,
      medium: body.medium ?? 0,
    },
  });

  return reply.status(200).send(channel);
}

// ── Helpers ──

function formatInbox(inbox: Record<string, unknown>) {
  const cfg =
    inbox.auto_assignment_config && typeof inbox.auto_assignment_config === 'object'
      ? (inbox.auto_assignment_config as Record<string, unknown>)
      : {};
  const flowId = Number(cfg.itr_flow_id ?? cfg.itrFlowId ?? 0) || null;
  return {
    id: inbox.id,
    name: inbox.name,
    channel_id: inbox.channel_id,
    channel_type: inbox.channel_type,
    account_id: inbox.account_id,
    enable_auto_assignment: inbox.enable_auto_assignment,
    greeting_enabled: inbox.greeting_enabled,
    greeting_message: inbox.greeting_message,
    email_address: inbox.email_address,
    working_hours_enabled: inbox.working_hours_enabled,
    out_of_office_message: inbox.out_of_office_message,
    timezone: inbox.timezone,
    enable_email_collect: inbox.enable_email_collect,
    csat_survey_enabled: inbox.csat_survey_enabled,
    allow_messages_after_resolved: inbox.allow_messages_after_resolved,
    lock_to_single_conversation: inbox.lock_to_single_conversation,
    portal_id: inbox.portal_id,
    business_name: inbox.business_name,
    auto_assignment_config: cfg,
    itr_flow_id: flowId,
    itr_enabled: cfg.itr_enabled !== false,
  };
}

function formatWidget(w: Record<string, unknown>) {
  return {
    id: w.id, website_url: w.website_url, website_token: w.website_token,
    widget_color: w.widget_color, welcome_title: w.welcome_title,
    welcome_tagline: w.welcome_tagline, reply_time: w.reply_time,
    hmac_token: w.hmac_token, pre_chat_form_enabled: w.pre_chat_form_enabled,
    pre_chat_form_options: w.pre_chat_form_options,
    continuity_via_email: w.continuity_via_email,
    allowed_domains: w.allowed_domains, feature_flags: w.feature_flags,
  };
}
