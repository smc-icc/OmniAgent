import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import {
  listPortals, createPortal, showPortal, updatePortal, archivePortal, deletePortalLogo,
  listCategories, createCategory, reorderCategories, destroyCategory,
  listArticles, createArticle, showArticle, updateArticle, destroyArticle, reorderArticles,
  listIntegrationApps, showIntegrationApp,
  listIntegrationHooks, createIntegrationHook, updateIntegrationHook, destroyIntegrationHook, processIntegrationEvent,
  listWebhooks, createWebhook, updateWebhook, destroyWebhook,
  slackListChannels, slackCreate, slackDestroy,
  dyteCreateMeeting, dyteAddParticipant,
  linearTeams, linearCreateIssue, linearLinkIssue, linearUnlinkIssue, linearSearchIssue, linearLinkedIssues,
  shopifyAuth, shopifyOrders, notionDestroy,
  twitterCrc, twitterEvents, whatsappVerify, whatsappProcess,
  instagramVerify, instagramEvents, facebookVerify, facebookEvents, lineProcess, telegramProcess, smsProcess,
  apiChannelProcess, weiboProcess, miniprogramProcess, apiChannelPoll, tiktokEvents, shopifyEvents,
  enterpriseCheckout, enterpriseSubscription, enterpriseLimits, enterpriseToggleDeletion, enterpriseTopupCheckout,
  stripeWebhook, firecrawlWebhook,
  platformListAccounts, platformCreateAccount, platformShowAccount, platformUpdateAccount, platformDestroyAccount,
  platformListUsers, platformCreateUser,
  platformListAccountUsers, platformCreateAccountUser, platformDestroyAccountUser,
  platformListAgentBots, platformCreateAgentBot,
} from './integrations.controller.js';

export async function integrationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };
  const base = '/api/v1/accounts/:account_id';

  // ── Phase 6: Portals ──
  fastify.get(`${base}/portals`, auth, listPortals);
  fastify.post(`${base}/portals`, auth, createPortal);
  fastify.get(`${base}/portals/:id`, auth, showPortal);
  fastify.put(`${base}/portals/:id`, auth, updatePortal);
  fastify.patch(`${base}/portals/:id/archive`, auth, archivePortal);
  fastify.delete(`${base}/portals/:id/logo`, auth, deletePortalLogo);

  // Categories
  fastify.get(`${base}/portals/:id/categories`, auth, listCategories);
  fastify.post(`${base}/portals/:id/categories`, auth, createCategory);
  fastify.post(`${base}/portals/:id/categories/reorder`, auth, reorderCategories);
  fastify.delete(`${base}/portals/:id/categories/:category_id`, auth, destroyCategory);

  // Articles
  fastify.get(`${base}/portals/:id/articles`, auth, listArticles);
  fastify.post(`${base}/portals/:id/articles`, auth, createArticle);
  fastify.get(`${base}/portals/:id/articles/:article_id`, auth, showArticle);
  fastify.put(`${base}/portals/:id/articles/:article_id`, auth, updateArticle);
  fastify.delete(`${base}/portals/:id/articles/:article_id`, auth, destroyArticle);
  fastify.post(`${base}/portals/:id/articles/reorder`, auth, reorderArticles);

  // ── Phase 7: Integrations & Webhooks ──
  fastify.get(`${base}/integrations/apps`, auth, listIntegrationApps);
  fastify.get(`${base}/integrations/apps/:id`, auth, showIntegrationApp);
  fastify.get(`${base}/integrations/hooks`, auth, listIntegrationHooks);
  fastify.post(`${base}/integrations/hooks`, auth, createIntegrationHook);
  fastify.put(`${base}/integrations/hooks/:id`, auth, updateIntegrationHook);
  fastify.delete(`${base}/integrations/hooks/:id`, auth, destroyIntegrationHook);
  fastify.post(`${base}/integrations/hooks/:id/process_event`, auth, processIntegrationEvent);

  // Slack
  fastify.get(`${base}/integrations/slack/list_all_channels`, auth, slackListChannels);
  fastify.post(`${base}/integrations/slack`, auth, slackCreate);
  fastify.delete(`${base}/integrations/slack`, auth, slackDestroy);

  // Dyte
  fastify.post(`${base}/integrations/dyte/create_a_meeting`, auth, dyteCreateMeeting);
  fastify.post(`${base}/integrations/dyte/add_participant_to_meeting`, auth, dyteAddParticipant);

  // Linear
  fastify.get(`${base}/integrations/linear/teams`, auth, linearTeams);
  fastify.post(`${base}/integrations/linear/create_issue`, auth, linearCreateIssue);
  fastify.post(`${base}/integrations/linear/link_issue`, auth, linearLinkIssue);
  fastify.post(`${base}/integrations/linear/unlink_issue`, auth, linearUnlinkIssue);
  fastify.get(`${base}/integrations/linear/search_issue`, auth, linearSearchIssue);
  fastify.get(`${base}/integrations/linear/linked_issues`, auth, linearLinkedIssues);

  // Shopify
  fastify.post(`${base}/integrations/shopify/auth`, auth, shopifyAuth);
  fastify.get(`${base}/integrations/shopify/orders`, auth, shopifyOrders);

  // Notion
  fastify.delete(`${base}/integrations/notion`, auth, notionDestroy);

  // Webhooks
  fastify.get(`${base}/webhooks`, auth, listWebhooks);
  fastify.post(`${base}/webhooks`, auth, createWebhook);
  fastify.put(`${base}/webhooks/:id`, auth, updateWebhook);
  fastify.delete(`${base}/webhooks/:id`, auth, destroyWebhook);

  // ── Channel Webhook Callbacks (no auth) ──
  fastify.get('/webhooks/twitter', twitterCrc);
  fastify.post('/webhooks/twitter', twitterEvents);
  fastify.get('/webhooks/whatsapp/:phone_number', whatsappVerify);
  fastify.post('/webhooks/whatsapp/:phone_number', whatsappProcess);
  fastify.get('/webhooks/instagram', instagramVerify);
  fastify.post('/webhooks/instagram', instagramEvents);
  fastify.get('/webhooks/facebook', facebookVerify);
  fastify.post('/webhooks/facebook', facebookEvents);

  fastify.addHook('preParsing', async (request: FastifyRequest, _reply, payload) => {
    if (!request.url.includes('/webhooks/line/')) return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);
    (request as FastifyRequest & { rawBody?: string }).rawBody = raw.toString('utf8');
    return Readable.from(raw);
  });
  fastify.post('/webhooks/line/:line_channel_id', lineProcess);
  fastify.post('/webhooks/telegram/:bot_token', telegramProcess);
  fastify.post('/webhooks/sms/:phone_number', smsProcess);
  fastify.post('/webhooks/api/:identifier', apiChannelProcess);
  fastify.get('/public/api/v1/app-channel/:identifier/messages', apiChannelPoll);
  fastify.post('/webhooks/weibo/:identifier', weiboProcess);
  fastify.post('/webhooks/miniprogram/:identifier', miniprogramProcess);
  fastify.post('/webhooks/tiktok', tiktokEvents);
  fastify.post('/webhooks/shopify', shopifyEvents);

  // ── Phase 8: Enterprise ──
  fastify.post('/enterprise/api/v1/accounts/:id/checkout', auth, enterpriseCheckout);
  fastify.post('/enterprise/api/v1/accounts/:id/subscription', auth, enterpriseSubscription);
  fastify.get('/enterprise/api/v1/accounts/:id/limits', auth, enterpriseLimits);
  fastify.post('/enterprise/api/v1/accounts/:id/toggle_deletion', auth, enterpriseToggleDeletion);
  fastify.post('/enterprise/api/v1/accounts/:id/topup_checkout', auth, enterpriseTopupCheckout);
  fastify.post('/enterprise/webhooks/stripe', stripeWebhook);
  fastify.post('/enterprise/webhooks/firecrawl', firecrawlWebhook);

  // ── Phase 8: Platform API ──
  fastify.get('/platform/api/v1/accounts', auth, platformListAccounts);
  fastify.post('/platform/api/v1/accounts', auth, platformCreateAccount);
  fastify.get('/platform/api/v1/accounts/:id', auth, platformShowAccount);
  fastify.put('/platform/api/v1/accounts/:id', auth, platformUpdateAccount);
  fastify.delete('/platform/api/v1/accounts/:id', auth, platformDestroyAccount);
  fastify.get('/platform/api/v1/users', auth, platformListUsers);
  fastify.post('/platform/api/v1/users', auth, platformCreateUser);
  fastify.get('/platform/api/v1/accounts/:account_id/account_users', auth, platformListAccountUsers);
  fastify.post('/platform/api/v1/accounts/:account_id/account_users', auth, platformCreateAccountUser);
  fastify.delete('/platform/api/v1/accounts/:account_id/account_users', auth, platformDestroyAccountUser);
  fastify.get('/platform/api/v1/agent_bots', auth, platformListAgentBots);
  fastify.post('/platform/api/v1/agent_bots', auth, platformCreateAgentBot);

}
