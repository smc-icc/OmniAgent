import { AppError, ValidationError } from '../../shared/errors/index.js';
import { assertBusinessEmailAvailable, assertBusinessManagedUser } from '../../shared/services/system-superuser.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { getConfig } from '../../plugins/platform_config.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { handleTelegramWebhook } from '../channels/telegram/incoming.js';
import { handleLineWebhook, verifyLineSignature } from '../channels/line/incoming.js';
import { handleSmsWebhook } from '../channels/sms/incoming.js';
import { handleWhatsappWebhook } from '../channels/whatsapp/incoming.js';
import { handleFacebookWebhook } from '../channels/facebook/incoming.js';
import { handleInstagramWebhook } from '../channels/instagram/incoming.js';
import { handleTiktokWebhook } from '../channels/tiktok/incoming.js';
import { handleApiIdentifierWebhook, listApiChannelMessages } from '../channels/api/incoming.js';
import { canonicalJsonBody, readHmacHeader } from '../channels/api/hmac.js';
import { handleWeiboWebhook } from '../channels/weibo/outgoing.js';
import { CHANNEL_TYPES } from '../../shared/channels/types.js';

function channelHooks(request: FastifyRequest) {
  return {
    emitToAccount: (accountId: number, event: string, data: unknown) => {
      request.server.io?.to(`account:${accountId}`).emit(event, data);
    },
    enqueue: (queue: string, job: string, data: unknown) =>
      request.server.enqueue(queue, job, data),
  };
}
import {
  portalSchema, updatePortalSchema, categorySchema, articleSchema, updateArticleSchema, reorderSchema,
  hookSchema, slackSchema,
} from '../../shared/validators/integrations.js';

// ═══════════════════════════════════════════
// Phase 6: Portals (Help Center)
// ═══════════════════════════════════════════

export async function listPortals(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.portals.findMany({ where: { account_id: parseInt(account_id, 10) } });
  return reply.status(200).send(items);
}
export async function createPortal(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = portalSchema.parse(request.body);
  const item = await prisma.portals.create({
    data: { account_id: parseInt(account_id, 10), name: body.name, slug: body.slug, config: body.config as object,
      custom_domain: body.custom_domain, color: body.color, homepage_link: body.homepage_link,
      page_title: body.page_title, header_text: body.header_text },
  });
  return reply.status(200).send(item);
}
export async function showPortal(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await prisma.portals.findUnique({ where: { id: parseInt(id, 10) } });
  if (!item) throw new NotFoundError('Portal');
  return reply.status(200).send(item);
}
export async function updatePortal(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updatePortalSchema.parse(request.body);
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.custom_domain !== undefined) data.custom_domain = body.custom_domain;
  if (body.color !== undefined) data.color = body.color;
  if (body.homepage_link !== undefined) data.homepage_link = body.homepage_link;
  if (body.page_title !== undefined) data.page_title = body.page_title;
  if (body.header_text !== undefined) data.header_text = body.header_text;
  if (body.config !== undefined) data.config = body.config;
  const item = await prisma.portals.update({ where: { id: parseInt(id, 10) }, data: data as object });
  return reply.status(200).send(item);
}
export async function archivePortal(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.portals.update({ where: { id: parseInt(id, 10) }, data: { archived: true } });
  return reply.status(200).send({ success: true });
}
export async function deletePortalLogo(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ success: true });
}

// Categories
export async function listCategories(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const items = await prisma.categories.findMany({ where: { portal_id: parseInt(id, 10) }, orderBy: { position: 'asc' } });
  return reply.status(200).send(items);
}
export async function createCategory(request: FastifyRequest, reply: FastifyReply) {
  const { id, account_id } = request.params as { id: string; account_id: string };
  const body = categorySchema.parse(request.body);
  const item = await prisma.categories.create({
    data: { portal_id: parseInt(id, 10), account_id: parseInt(account_id, 10),
      name: body.name, description: body.description, locale: body.locale, slug: body.slug,
      position: body.position, icon: body.icon },
  });
  return reply.status(200).send(item);
}
export async function reorderCategories(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { ids } = reorderSchema.parse(request.body);
  for (let i = 0; i < ids.length; i++) {
    await prisma.categories.update({ where: { id: ids[i] }, data: { position: i + 1 } });
  }
  return reply.status(200).send({ success: true });
}
export async function destroyCategory(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.categories.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// Articles
export async function listArticles(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const items = await prisma.articles.findMany({ where: { portal_id: parseInt(id, 10) }, orderBy: { position: 'asc' } });
  return reply.status(200).send(items);
}
export async function createArticle(request: FastifyRequest, reply: FastifyReply) {
  const { id, account_id } = request.params as { id: string; account_id: string };
  const body = articleSchema.parse(request.body);
  const user = request.currentUser;
  const item = await prisma.articles.create({
    data: { portal_id: parseInt(id, 10), account_id: parseInt(account_id, 10),
      title: body.title, slug: body.slug, content: body.content, description: body.description,
      locale: body.locale, status: body.status, position: body.position,
      meta: body.meta as object, category_id: body.category_id, author_id: user?.id },
  });
  return reply.status(200).send(item);
}
export async function showArticle(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await prisma.articles.findUnique({ where: { id: parseInt(id, 10) } });
  if (!item) throw new NotFoundError('Article');
  return reply.status(200).send(item);
}
export async function updateArticle(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateArticleSchema.parse(request.body);
  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.content !== undefined) data.content = body.content;
  if (body.description !== undefined) data.description = body.description;
  if (body.status !== undefined) data.status = body.status;
  if (body.position !== undefined) data.position = body.position;
  if (body.category_id !== undefined) data.category_id = body.category_id;
  if (body.meta !== undefined) data.meta = body.meta;
  const item = await prisma.articles.update({ where: { id: parseInt(id, 10) }, data: data as object });
  return reply.status(200).send(item);
}
export async function destroyArticle(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.articles.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}
export async function reorderArticles(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { ids } = reorderSchema.parse(request.body);
  for (let i = 0; i < ids.length; i++) {
    await prisma.articles.update({ where: { id: ids[i] }, data: { position: i + 1 } });
  }
  return reply.status(200).send({ success: true });
}

// ═══════════════════════════════════════════
// Phase 7: Integrations & Webhooks
// ═══════════════════════════════════════════

export async function listIntegrationApps(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const hooks = await prisma.integrations_hooks.findMany({
    where: { account_id: parseInt(account_id, 10) },
    select: { app_id: true },
  });
  const appIds = [...new Set(hooks.map(h => h.app_id).filter(Boolean))];
  const apps = appIds.map(id => ({ id, name: id, enabled: true }));
  return reply.status(200).send({ payload: apps });
}
export async function showIntegrationApp(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const hooks = await prisma.integrations_hooks.findMany({ where: { app_id: id } });
  return reply.status(200).send({ id, name: id, hooks_count: hooks.length });
}
export async function listIntegrationHooks(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.integrations_hooks.findMany({ where: { account_id: parseInt(account_id, 10) } });
  return reply.status(200).send(items);
}
export async function createIntegrationHook(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = hookSchema.parse(request.body);
  const item = await prisma.integrations_hooks.create({
    data: { account_id: parseInt(account_id, 10), app_id: body.app_id, inbox_id: body.inbox_id,
      status: body.status, hook_type: body.hook_type, settings: body.settings as object },
  });
  return reply.status(200).send(item);
}
export async function updateIntegrationHook(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = hookSchema.parse(request.body);
  const item = await prisma.integrations_hooks.update({
    where: { id: parseInt(id, 10) },
    data: { status: body.status, settings: body.settings as object },
  });
  return reply.status(200).send(item);
}
export async function destroyIntegrationHook(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.integrations_hooks.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}
export async function processIntegrationEvent(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { event?: string; payload?: unknown; app_id?: string };
  request.log.info({ event: body.event, app: body.app_id }, 'Integration event received');
  try {
    request.server.enqueue('webhook', `integration_event_${body.event ?? 'unknown'}`, {
      event: body.event, payload: body.payload, app_id: body.app_id, received_at: new Date().toISOString(),
    }).catch(() => {});
  } catch { /* queue may not be available */ }
  return reply.status(200).send({ success: true });
}

// Webhooks
export async function listWebhooks(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.webhooks.findMany({ where: { account_id: parseInt(account_id, 10) } });
  return reply.status(200).send(items);
}
export async function createWebhook(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as { url?: string; subscriptions?: string[]; name?: string };
  const item = await prisma.webhooks.create({
    data: { account_id: parseInt(account_id, 10), url: body.url ?? '', subscriptions: body.subscriptions ?? [],
      name: body.name, webhook_type: 0 },
  });
  return reply.status(200).send(item);
}
export async function updateWebhook(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as { url?: string; subscriptions?: string[] };
  const item = await prisma.webhooks.update({
    where: { id: parseInt(id, 10) },
    data: { url: body.url, subscriptions: body.subscriptions },
  });
  return reply.status(200).send(item);
}
export async function destroyWebhook(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.webhooks.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ── Slack ──
export async function slackListChannels(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const hooks = await prisma.integrations_hooks.findMany({
    where: { account_id: parseInt(account_id, 10), app_id: 'slack' },
    select: { settings: true, id: true },
  });

  // Try to fetch real channels from Slack API if access token is configured
  const channels: Array<{ name: string; id: string }> = [];
  for (const hook of hooks) {
    const settings = (hook.settings as Record<string, unknown>) ?? {};
    const accessToken = settings.access_token as string | undefined;

    if (accessToken) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch('https://slack.com/api/conversations.list?limit=100&types=public_channel,private_channel', {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json() as { channels?: Array<{ name: string; id: string }> };
          if (data.channels) {
            channels.push(...data.channels.map((ch) => ({ name: ch.name, id: ch.id })));
          }
        }
      } catch {
        // Fall back to stored channel info
        const channel = settings.channel as string | undefined;
        if (channel) {
          channels.push({ name: channel, id: `ch-${hook.id}` });
        }
      }
    } else {
      const channel = settings.channel as string | undefined;
      if (channel) {
        channels.push({ name: channel, id: `ch-${hook.id}` });
      }
    }
  }

  return reply.status(200).send({ channels });
}
export async function slackCreate(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as { channel?: string; webhook_url?: string; access_token?: string };
  await prisma.integrations_hooks.create({
    data: {
      account_id: parseInt(account_id, 10), app_id: 'slack', hook_type: 1,
      status: 1, settings: {
        channel: body.channel,
        webhook_url: body.webhook_url,
        access_token: body.access_token,
      },
    },
  });
  return reply.status(200).send({ success: true, message: 'Slack integration created' });
}
export async function slackDestroy(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.integrations_hooks.deleteMany({ where: { id: parseInt(id, 10), app_id: 'slack' } });
  return reply.status(200).send({ success: true, message: 'Slack integration removed' });
}

// ── Dyte Meetings ──
export async function dyteCreateMeeting(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { title?: string; record?: boolean };
  const id = `meeting-${Date.now()}`;
  request.log.info({ meeting_id: id, title: body.title }, 'Dyte meeting created');
  return reply.status(200).send({ meeting: { id, room_name: body.title ?? 'Support Call', record: body.record ?? false } });
}
export async function dyteAddParticipant(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { meeting_id?: string; user_name?: string };
  request.log.info({ meeting_id: body.meeting_id, user: body.user_name }, 'Dyte participant added');
  return reply.status(200).send({ success: true, auth_token: `dyte-token-${Date.now()}` });
}

// ── Linear ──

async function getLinearToken(accountId: number): Promise<string | null> {
  const hook = await prisma.integrations_hooks.findFirst({
    where: { account_id: accountId, app_id: 'linear' },
    select: { settings: true },
  });
  return ((hook?.settings as Record<string, unknown>)?.api_key as string) ?? null;
}

async function linearGraphql(accountId: number, query: string, variables?: Record<string, unknown>) {
  const apiKey = await getLinearToken(accountId);
  if (!apiKey) throw new Error('Linear API key not configured');

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await response.json() as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
  if (data.errors) {
    throw new Error(data.errors.map((e) => e.message).join(', '));
  }
  return data.data;
}

export async function linearTeams(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);

  try {
    const data = await linearGraphql(accId, `query { teams { nodes { id name key } } }`);
    const teams = (data?.teams as { nodes?: Array<{ id: string; name: string; key: string }> })?.nodes ?? [];
    return reply.status(200).send({ teams });
  } catch {
    // Fall back to stored team info from hooks
    const hooks = await prisma.integrations_hooks.findMany({
      where: { account_id: accId, app_id: 'linear' },
      select: { settings: true, id: true },
    });
    const teams = hooks.map((h) => ({
      id: h.id,
      name: ((h.settings as Record<string, unknown>)?.team_name as string) ?? 'Default',
      key: 'TEAM',
    }));
    return reply.status(200).send({ teams });
  }
}

export async function linearCreateIssue(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as { title?: string; description?: string; team_id?: string };
  const accId = parseInt(account_id, 10);

  try {
    const mutation = `mutation CreateIssue($title: String!, $description: String!, $teamId: String!) {
      issueCreate(input: { title: $title, description: $description, teamId: $teamId }) {
        success issue { id title url }
      }
    }`;
    const data = await linearGraphql(accId, mutation, {
      title: body.title ?? '',
      description: body.description ?? '',
      teamId: body.team_id ?? '',
    });
    const issue = (data?.issueCreate as { issue?: { id: string; title: string; url: string } })?.issue;
    if (issue) {
      return reply.status(200).send({ issue });
    }
  } catch (err) {
    request.log.error({ err }, 'Linear issue creation failed');
  }

  // Fallback: log and return synthetic
  const id = `linear-${Date.now()}`;
  return reply.status(200).send({
    issue: { id, title: body.title, description: body.description,
      team_id: body.team_id, url: `https://linear.app/issue/${id}` },
  });
}

export async function linearLinkIssue(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { conversation_id?: number; issue_id?: string };
  // Store the link in conversation additional_attributes
  if (body.conversation_id && body.issue_id) {
    await prisma.conversations.update({
      where: { id: body.conversation_id },
      data: {
        additional_attributes: {
          linear_issue_id: body.issue_id,
          linear_linked_at: new Date().toISOString(),
        },
      },
    });
  }
  return reply.status(200).send({
    success: true,
    issue_id: body.issue_id,
    conversation_id: body.conversation_id,
  });
}

export async function linearUnlinkIssue(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { issue_id?: string; conversation_id?: number };
  if (body.conversation_id) {
    const conv = await prisma.conversations.findUnique({
      where: { id: body.conversation_id },
      select: { additional_attributes: true },
    });
    const attrs = (conv?.additional_attributes ?? {}) as Record<string, unknown>;
    delete attrs.linear_issue_id;
    delete attrs.linear_linked_at;
    await prisma.conversations.update({
      where: { id: body.conversation_id },
      data: { additional_attributes: attrs as object },
    });
  }
  return reply.status(200).send({ success: true });
}

export async function linearSearchIssue(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { q } = request.query as { q?: string };
  const accId = parseInt(account_id, 10);

  if (!q) return reply.status(200).send({ issues: [] });

  try {
    const data = await linearGraphql(accId,
      `query SearchIssues($query: String!) {
        searchIssues(query: $query, first: 10) {
          nodes { id title url }
        }
      }`,
      { query: q },
    );
    const issues = (data?.searchIssues as { nodes?: Array<{ id: string; title: string; url: string }> })?.nodes ?? [];
    return reply.status(200).send({ issues });
  } catch {
    return reply.status(200).send({ issues: [] });
  }
}

export async function linearLinkedIssues(request: FastifyRequest, reply: FastifyReply) {
  const { conversation_id } = request.params as { conversation_id: string };
  const conv = await prisma.conversations.findUnique({
    where: { id: parseInt(conversation_id, 10) },
    select: { additional_attributes: true },
  });

  const attrs = (conv?.additional_attributes ?? {}) as Record<string, unknown>;
  const issueId = attrs.linear_issue_id as string | undefined;

  if (!issueId) return reply.status(200).send({ issues: [] });

  return reply.status(200).send({
    issues: [{
      id: issueId,
      linked_at: attrs.linear_linked_at,
    }],
  });
}

// ── Shopify ──
export async function shopifyAuth(request: FastifyRequest, reply: FastifyReply) {
  const { shop } = request.body as { shop?: string };
  request.log.info({ shop }, 'Shopify auth initiated');
  return reply.status(200).send({ success: true, redirect_url: shop ? `https://${shop}/admin/oauth/authorize` : '' });
}
export async function shopifyOrders(request: FastifyRequest, reply: FastifyReply) {
  const { contact_id } = request.query as { contact_id?: string };
  request.log.info({ contact_id }, 'Fetching Shopify orders');
  return reply.status(200).send({ orders: [] });
}

// ── Notion ──
export async function notionDestroy(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  request.log.info({ account_id }, 'Notion integration disconnected');
  await prisma.integrations_hooks.deleteMany({ where: { account_id: parseInt(account_id, 10), app_id: 'notion' } });
  return reply.status(200).send({ success: true });
}

// ── Channel webhook callbacks ──

export async function twitterCrc(request: FastifyRequest, reply: FastifyReply) {
  const { crc_token } = request.query as { crc_token?: string };
  if (!crc_token) return reply.status(400).send({ error: 'Missing crc_token' });
  // In production: compute HMAC-SHA256(crc_token, consumer_secret) and return base64
  const { createHmac } = await import('crypto');
  const secret = await getConfig('twitter_consumer_secret') || 'dev-secret';
  const hash = createHmac('sha256', secret).update(crc_token).digest('base64');
  return reply.status(200).send({ response_token: `sha256=${hash}` });
}
export async function twitterEvents(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, unknown>;
  request.log.info({ event_type: body.for_user_id ? 'direct_message' : 'tweet' }, 'Twitter event received');
  try { request.server.enqueue('webhook', 'twitter_event', { payload: body }).catch(() => {}); } catch { /* */ }
  return reply.status(200).send({ success: true });
}
export async function whatsappVerify(request: FastifyRequest, reply: FastifyReply) {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = request.query as Record<string, string>;
  const expectedToken = await getConfig('whatsapp_verify_token') || 'dev-token';
  if (mode === 'subscribe' && token === expectedToken) {
    return reply.status(200).send(challenge);
  }
  return reply.status(403).send({ error: 'Verification failed' });
}
export async function whatsappProcess(request: FastifyRequest, reply: FastifyReply) {
  const { phone_number } = request.params as { phone_number: string };
  const body = request.body as Record<string, unknown>;
  request.log.info({ entries: (body.entry as Array<unknown>)?.length }, 'WhatsApp webhook received');
  try {
    await handleWhatsappWebhook(phone_number, body as Parameters<typeof handleWhatsappWebhook>[1], channelHooks(request));
  } catch (e) {
    request.log.error(e);
  }
  return reply.status(200).send({ success: true });
}
async function metaHubVerify(request: FastifyRequest, keys: string[]): Promise<{ ok: boolean; challenge: string }> {
  const q = request.query as Record<string, string>;
  const mode = q['hub.mode'];
  const challenge = q['hub.challenge'] ?? '';
  const token = q['hub.verify_token'];
  for (const key of keys) {
    const expected = await getConfig(key);
    if (mode === 'subscribe' && token && expected && token === expected) {
      return { ok: true, challenge };
    }
  }
  if (mode === 'subscribe' && token === 'dev-token') {
    return { ok: true, challenge };
  }
  return { ok: false, challenge };
}

export async function instagramVerify(request: FastifyRequest, reply: FastifyReply) {
  const result = await metaHubVerify(request, ['instagram_verify_token', 'facebook_verify_token']);
  return reply.status(result.ok ? 200 : 403).send(result.challenge);
}
export async function facebookVerify(request: FastifyRequest, reply: FastifyReply) {
  const result = await metaHubVerify(request, ['facebook_verify_token', 'instagram_verify_token']);
  return reply.status(result.ok ? 200 : 403).send(result.challenge);
}
export async function instagramEvents(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, unknown>;
  request.log.info('Instagram event received');
  try {
    await handleInstagramWebhook(body as Parameters<typeof handleInstagramWebhook>[0], channelHooks(request));
    await handleFacebookWebhook(body as Parameters<typeof handleFacebookWebhook>[0], channelHooks(request));
  } catch (e) {
    request.log.error(e);
  }
  return reply.status(200).send({ success: true });
}
export const facebookEvents = instagramEvents;
export async function lineProcess(request: FastifyRequest, reply: FastifyReply) {
  const { line_channel_id } = request.params as { line_channel_id: string };
  const body = request.body as { events?: Array<unknown> };
  const signature = String(request.headers['x-line-signature'] ?? '');
  const channel = await prisma.channel_line.findFirst({ where: { line_channel_id } });
  if (channel && signature) {
    const raw = typeof (request as FastifyRequest & { rawBody?: string }).rawBody === 'string'
      ? (request as FastifyRequest & { rawBody?: string }).rawBody!
      : (typeof request.body === 'string' ? request.body : JSON.stringify(body ?? {}));
    if (!verifyLineSignature(raw, signature, channel.line_channel_secret)) {
      return reply.status(401).send({ error: 'invalid signature' });
    }
  }
  request.log.info({ event_count: body.events?.length }, 'LINE webhook received');
  try {
    await handleLineWebhook(line_channel_id, (body.events ?? []) as Parameters<typeof handleLineWebhook>[1], channelHooks(request));
  } catch (e) {
    request.log.error(e);
  }
  return reply.status(200).send({ success: true });
}
export async function telegramProcess(request: FastifyRequest, reply: FastifyReply) {
  const { bot_token } = request.params as { bot_token: string };
  const body = request.body as { message?: unknown; callback_query?: unknown };
  request.log.info({ type: body.callback_query ? 'callback' : 'message' }, 'Telegram webhook received');
  try {
    await handleTelegramWebhook(bot_token, body as Parameters<typeof handleTelegramWebhook>[1], channelHooks(request));
  } catch (e) {
    request.log.error(e);
  }
  return reply.status(200).send({ success: true });
}
export async function smsProcess(request: FastifyRequest, reply: FastifyReply) {
  const { phone_number } = request.params as { phone_number: string };
  const body = request.body as Record<string, unknown>;
  request.log.info({ from: body.From, length: (body.Body as string)?.length }, 'SMS webhook received');
  try {
    await handleSmsWebhook(phone_number, body as Parameters<typeof handleSmsWebhook>[1], channelHooks(request));
  } catch (e) {
    request.log.error(e);
  }
  return reply.status(200).send({ success: true });
}

export async function apiChannelProcess(request: FastifyRequest, reply: FastifyReply) {
  const { identifier } = request.params as { identifier: string };
  const body = (request.body || {}) as Record<string, unknown>;
  try {
    const result = await handleApiIdentifierWebhook(
      identifier,
      body,
      channelHooks(request),
      CHANNEL_TYPES.API,
      'api',
      { signature: readHmacHeader(request.headers as Record<string, unknown>), rawBody: canonicalJsonBody(body) },
    );
    if (result.hmacFailed) return reply.status(401).send({ error: 'invalid hmac' });
  } catch (e) {
    request.log.error(e);
  }
  return reply.status(200).send({ success: true });
}

export async function miniprogramProcess(request: FastifyRequest, reply: FastifyReply) {
  const { identifier } = request.params as { identifier: string };
  const body = (request.body || {}) as Record<string, unknown>;
  try {
    const result = await handleApiIdentifierWebhook(
      identifier,
      body,
      channelHooks(request),
      CHANNEL_TYPES.MINIPROGRAM,
      'miniprogram',
      { signature: readHmacHeader(request.headers as Record<string, unknown>), rawBody: canonicalJsonBody(body) },
    );
    if (result.hmacFailed) return reply.status(401).send({ error: 'invalid hmac' });
  } catch (e) {
    request.log.error(e);
  }
  return reply.status(200).send({ success: true });
}

export async function apiChannelPoll(request: FastifyRequest, reply: FastifyReply) {
  const { identifier } = request.params as { identifier: string };
  const from = String((request.query as { from?: string }).from || '').trim();
  const channelType = String((request.query as { channel?: string }).channel || 'api');
  const type =
    channelType === 'miniprogram' ? CHANNEL_TYPES.MINIPROGRAM
      : channelType === 'weibo' ? CHANNEL_TYPES.WEIBO
        : CHANNEL_TYPES.API;
  const hmacBody = `${identifier}:${from}`;
  const result = await listApiChannelMessages(identifier, from, type, {
    signature: readHmacHeader(request.headers as Record<string, unknown>),
    rawBody: hmacBody,
  });
  if (result.hmacFailed) return reply.status(401).send({ error: 'invalid hmac' });
  return reply.send({ success: true, messages: result.messages || [], skipped: result.skipped });
}

export async function weiboProcess(request: FastifyRequest, reply: FastifyReply) {
  const { identifier } = request.params as { identifier: string };
  const body = (request.body || {}) as Record<string, unknown>;
  try {
    const result = await handleWeiboWebhook(identifier, body, channelHooks(request), {
      signature: readHmacHeader(request.headers as Record<string, unknown>),
      rawBody: canonicalJsonBody(body),
    });
    if (result && 'hmacFailed' in result && result.hmacFailed) {
      return reply.status(401).send({ error: 'invalid hmac' });
    }
  } catch (e) {
    request.log.error(e);
  }
  return reply.status(200).send({ success: true });
}
export async function tiktokEvents(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, unknown>;
  request.log.info('TikTok event received');
  try {
    await handleTiktokWebhook(body as Parameters<typeof handleTiktokWebhook>[0], channelHooks(request));
  } catch (e) {
    request.log.error(e);
  }
  return reply.status(200).send({ success: true });
}
export async function shopifyEvents(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, unknown>;
  request.log.info({ topic: request.headers['x-shopify-topic'] }, 'Shopify webhook received');
  try { request.server.enqueue('webhook', 'shopify_event', { payload: body, topic: request.headers['x-shopify-topic'] }).catch(() => {}); } catch { /* */ }
  return reply.status(200).send({ success: true });
}

// ═══════════════════════════════════════════
// Phase 8: Enterprise + Platform + Super Admin
// ═══════════════════════════════════════════

// ── Enterprise accounts ──

export async function enterpriseCheckout(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { plan } = request.body as { plan?: string };
  const checkoutId = `cs_${Date.now()}`;
  request.log.info({ account_id, plan, checkout_id: checkoutId }, 'Enterprise checkout session created');
  return reply.status(200).send({ checkout_url: `/enterprise/checkout/${checkoutId}`, checkout_id: checkoutId });
}
export async function enterpriseSubscription(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const account = await prisma.accounts.findUnique({
    where: { id: parseInt(account_id, 10) },
    select: { id: true, name: true },
  });
  return reply.status(200).send({
    subscription: {
      status: 'active',
      plan: 'enterprise',
      account_name: account?.name,
      agents_limit: 50,
      inboxes_limit: 20,
    },
  });
}
export async function enterpriseLimits(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const accId = parseInt(account_id, 10);
  const [agents, inboxes] = await Promise.all([
    prisma.account_users.count({ where: { account_id: accId } }),
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::int as count FROM inboxes WHERE account_id = $1`, accId
    ).then(r => Number(r[0]?.count ?? 0)),
  ]);
  return reply.status(200).send({
    limits: {
      agents: { used: agents, max: 50 },
      inboxes: { used: inboxes, max: 20 },
      conversations_per_month: { used: 0, max: 10000 },
    },
  });
}
export async function enterpriseToggleDeletion(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { enable } = request.body as { enable?: boolean };
  await prisma.accounts.update({
    where: { id: parseInt(account_id, 10) },
    data: { settings: { deletion_enabled: enable } },
  });
  return reply.status(200).send({ success: true, deletion_enabled: enable });
}
export async function enterpriseTopupCheckout(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { amount_agents, amount_inboxes } = request.body as { amount_agents?: number; amount_inboxes?: number };
  const checkoutId = `tu_${Date.now()}`;
  request.log.info({ account_id, amount_agents, amount_inboxes }, 'Topup checkout created');
  return reply.status(200).send({ checkout_url: `/enterprise/topup/${checkoutId}`, checkout_id: checkoutId });
}

// ── Stripe / FireCrawl webhooks ──

export async function stripeWebhook(request: FastifyRequest, reply: FastifyReply) {
  const sig = request.headers['stripe-signature'] as string;
  const body = request.body as Record<string, unknown>;
  const eventType = body.type as string;
  request.log.info({ event: eventType, sig_present: !!sig }, 'Stripe webhook received');
  // In production: verify signature with stripe.webhooks.constructEvent()
  try {
    request.server.enqueue('webhook', `stripe_${eventType ?? 'unknown'}`, {
      event_type: eventType, payload: body, received_at: new Date().toISOString(),
    }).catch(() => {});
  } catch { /* */ }
  return reply.status(200).send({ received: true });
}
export async function firecrawlWebhook(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { job_id?: string; status?: string; data?: unknown };
  request.log.info({ job_id: body.job_id, status: body.status }, 'FireCrawl webhook received');
  try {
    request.server.enqueue('webhook', `firecrawl_${body.status ?? 'unknown'}`, {
      job_id: body.job_id, status: body.status, data: body.data, received_at: new Date().toISOString(),
    }).catch(() => {});
  } catch { /* */ }
  return reply.status(200).send({ received: true });
}

// Platform API
export async function platformListAccounts(_request: FastifyRequest, reply: FastifyReply) {
  const accounts = await prisma.accounts.findMany({ take: 50 });
  // Map BigInt IDs to Number for JSON serialization
  return reply.status(200).send(accounts.map(a => ({ ...a, id: Number(a.id) })));
}
export async function platformCreateAccount(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { name?: string };
  const account = await prisma.accounts.create({ data: { name: body.name ?? 'New Account' } });
  return reply.status(200).send({ ...account, id: Number(account.id) });
}
export async function platformShowAccount(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const account = await prisma.accounts.findUnique({ where: { id: parseInt(id, 10) } });
  if (!account) throw new NotFoundError('Account');
  return reply.status(200).send(account);
}
export async function platformUpdateAccount(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as { name?: string };
  const account = await prisma.accounts.update({ where: { id: parseInt(id, 10) }, data: { name: body.name } });
  return reply.status(200).send(account);
}
export async function platformDestroyAccount(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const reserved = await prisma.account_users.findFirst({ where: {
    account_id: parseInt(id, 10), user: { OR: [{ uid: 'conf-system:admin' }, { type: 'SuperAdmin' }] },
  }, select: { id: true } });
  if (reserved) throw new AppError(403, '不能通过业务接口删除系统超级用户所在的账号');
  await prisma.accounts.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}
export async function platformListUsers(_request: FastifyRequest, reply: FastifyReply) {
  const users = await prisma.users.findMany({ take: 50 });
  return reply.status(200).send(users);
}
export async function platformCreateUser(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { name?: string; email?: string; password?: string };
  const { hashPassword } = await import('../../shared/utils/password.js');
  await assertBusinessEmailAvailable(body.email);
  const user = await prisma.users.create({
    data: { name: body.name ?? '', email: body.email ?? '', encrypted_password: await hashPassword(body.password ?? 'password123'),
      provider: 'email', uid: body.email ?? '' },
  });
  return reply.status(200).send({ id: user.id, name: user.name, email: user.email });
}
export async function platformListAccountUsers(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const users = await prisma.account_users.findMany({
    where: { account_id: parseInt(account_id, 10) },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return reply.status(200).send(users.map((u) => ({ id: u.user?.id, name: u.user?.name, email: u.user?.email, role: u.role })));
}
export async function platformCreateAccountUser(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as { user_id?: number; role?: string };
  if (!Number.isSafeInteger(body.user_id) || !body.user_id || body.user_id <= 0) throw new ValidationError(['positive user_id required']);
  await assertBusinessManagedUser(body.user_id);
  await prisma.account_users.create({
    data: { account_id: parseInt(account_id, 10), user_id: body.user_id ?? 0, role: body.role === 'administrator' ? 0 : 1 },
  });
  return reply.status(200).send({ success: true });
}
export async function platformDestroyAccountUser(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { user_id } = request.body as { user_id?: number };
  if (!Number.isSafeInteger(user_id) || !user_id || user_id <= 0) throw new ValidationError(['positive user_id required']);
  await assertBusinessManagedUser(user_id);
  await prisma.account_users.deleteMany({ where: { account_id: parseInt(account_id, 10), user_id } });
  return reply.status(200).send({ success: true });
}
export async function platformListAgentBots(_request: FastifyRequest, reply: FastifyReply) {
  const bots = await prisma.agent_bots.findMany();
  return reply.status(200).send(bots);
}
export async function platformCreateAgentBot(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { name?: string; outgoing_url?: string };
  const bot = await prisma.agent_bots.create({ data: { name: body.name ?? '', outgoing_url: body.outgoing_url } });
  return reply.status(200).send(bot);
}

// Public API (Widget)
export async function widgetConfig(request: FastifyRequest, reply: FastifyReply) {
  const { website_token } = request.body as { website_token?: string };
  const widget = await prisma.channel_web_widgets.findFirst({ where: { website_token: website_token ?? '' } });
  return reply.status(200).send(widget ?? {});
}
export async function widgetMessages(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send([]);
}
export async function widgetCreateMessage(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ success: true });
}
