import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { NotFoundError, ValidationError } from '../../shared/errors/index.js';

/**
 * Campaign types:
 *   0 = ongoing (Website inboxes)
 *   1 = one_off (SMS, WhatsApp, Twilio SMS)
 *
 * Campaign statuses:
 *   0 = active
 *   1 = completed
 */

function formatCampaign(c: Record<string, unknown>) {
  return {
    id: c.id,
    display_id: c.display_id,
    title: c.title,
    description: c.description,
    message: c.message,
    campaign_type: (c.campaign_type as number) === 1 ? 'one_off' : 'ongoing',
    campaign_status: (c.campaign_status as number) === 1 ? 'completed' : 'active',
    enabled: c.enabled,
    trigger_only_during_business_hours: c.trigger_only_during_business_hours,
    inbox_id: c.inbox_id,
    sender_id: c.sender_id,
    scheduled_at: c.scheduled_at,
    audience: c.audience,
    trigger_rules: c.trigger_rules,
    template_params: c.template_params,
    account_id: c.account_id,
    created_at: (c.created_at as Date)?.getTime(),
    updated_at: (c.updated_at as Date)?.getTime(),
  };
}

// Supported inbox types for campaigns
const CAMPAIGN_INBOX_TYPES = ['Website', 'Twilio SMS', 'Sms', 'Whatsapp'];

async function nextDisplayId(accountId: number): Promise<number> {
  const last = await prisma.campaigns.findFirst({
    where: { account_id: accountId },
    orderBy: { display_id: 'desc' },
    select: { display_id: true },
  });
  return (last?.display_id ?? 0) + 1;
}

/** GET /api/v1/accounts/:account_id/campaigns */
export async function listCampaigns(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const campaigns = await prisma.campaigns.findMany({
    where: { account_id: parseInt(account_id, 10) },
    orderBy: { created_at: 'desc' },
  });
  return reply.status(200).send({
    payload: campaigns.map((c) => formatCampaign(c as unknown as Record<string, unknown>)),
  });
}

/** GET /api/v1/accounts/:account_id/campaigns/:id */
export async function showCampaign(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const campaign = await prisma.campaigns.findUnique({ where: { id: parseInt(id, 10) } });
  if (!campaign) throw new NotFoundError('Campaign');
  return reply.status(200).send(formatCampaign(campaign as unknown as Record<string, unknown>));
}

/** POST /api/v1/accounts/:account_id/campaigns */
export async function createCampaign(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as {
    title?: string; description?: string; message?: string;
    enabled?: boolean; trigger_only_during_business_hours?: boolean;
    inbox_id?: number; sender_id?: number; scheduled_at?: string;
    audience?: Array<{ type: string; id: number }>;
    trigger_rules?: Record<string, unknown>;
    template_params?: Record<string, unknown>;
  };

  if (!body.title?.trim() || !body.message?.trim() || !body.inbox_id) {
    throw new ValidationError(['title, message, and inbox_id are required']);
  }

  const accId = parseInt(account_id, 10);

  // Check inbox type
  const inbox = await prisma.inboxes.findUnique({
    where: { id: body.inbox_id },
    select: { channel_type: true },
  });
  if (!inbox) throw new ValidationError(['Inbox not found']);

  const channelType = inbox.channel_type as string;
  const isOngoing = channelType === 'Channel::WebWidget' || channelType === 'web_widget';

  if (!CAMPAIGN_INBOX_TYPES.includes(channelType)) {
    throw new ValidationError([`Campaigns are not supported for ${channelType} inboxes`]);
  }

  const displayId = await nextDisplayId(accId);

  const campaign = await prisma.campaigns.create({
    data: {
      account_id: accId,
      display_id: displayId,
      title: body.title.trim(),
      description: body.description ?? '',
      message: body.message.trim(),
      campaign_type: isOngoing ? 0 : 1,
      campaign_status: 0,
      enabled: body.enabled ?? true,
      trigger_only_during_business_hours: body.trigger_only_during_business_hours ?? false,
      inbox_id: body.inbox_id,
      sender_id: body.sender_id,
      scheduled_at: body.scheduled_at ? new Date(body.scheduled_at) : (isOngoing ? null : new Date()),
      audience: (body.audience ?? []) as unknown as object,
      trigger_rules: (body.trigger_rules ?? {}) as object,
      template_params: body.template_params as object,
    },
  });

  return reply.status(200).send(formatCampaign(campaign as unknown as Record<string, unknown>));
}

/** PUT /api/v1/accounts/:account_id/campaigns/:id */
export async function updateCampaign(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as {
    title?: string; description?: string; message?: string;
    enabled?: boolean; trigger_only_during_business_hours?: boolean;
    inbox_id?: number; sender_id?: number; scheduled_at?: string;
    campaign_status?: number;
    audience?: Array<{ type: string; id: number }>;
    trigger_rules?: Record<string, unknown>;
    template_params?: Record<string, unknown>;
  };

  const existing = await prisma.campaigns.findUnique({ where: { id: parseInt(id, 10) } });
  if (!existing) throw new NotFoundError('Campaign');

  // Completed campaigns cannot be updated unless changing status
  if (existing.campaign_status === 1 && body.campaign_status === undefined) {
    throw new ValidationError(['Cannot update a completed campaign']);
  }

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title.trim();
  if (body.description !== undefined) data.description = body.description;
  if (body.message !== undefined) data.message = body.message.trim();
  if (body.enabled !== undefined) data.enabled = body.enabled;
  if (body.trigger_only_during_business_hours !== undefined) data.trigger_only_during_business_hours = body.trigger_only_during_business_hours;
  if (body.sender_id !== undefined) data.sender_id = body.sender_id;
  if (body.scheduled_at !== undefined) data.scheduled_at = body.scheduled_at ? new Date(body.scheduled_at) : null;
  if (body.campaign_status !== undefined) data.campaign_status = body.campaign_status;
  if (body.audience !== undefined) data.audience = body.audience as object;
  if (body.trigger_rules !== undefined) data.trigger_rules = body.trigger_rules as object;
  if (body.template_params !== undefined) data.template_params = body.template_params as object;

  const campaign = await prisma.campaigns.update({
    where: { id: parseInt(id, 10) },
    data: data as object,
  });

  return reply.status(200).send(formatCampaign(campaign as unknown as Record<string, unknown>));
}

/** DELETE /api/v1/accounts/:account_id/campaigns/:id */
export async function destroyCampaign(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.campaigns.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}
