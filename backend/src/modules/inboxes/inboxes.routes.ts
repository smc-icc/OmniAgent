import type { FastifyInstance } from 'fastify';
import {
  listInboxes, createInbox, showInbox, updateInbox, destroyInbox,
  inboxAssignableAgents, inboxCampaigns, inboxAgentBot, inboxSetAgentBot,
  inboxDeleteAvatar, inboxHealth, inboxSyncTemplates, inboxRegisterWebhook,
  createInboxMembers, showInboxMembers, updateInboxMembers, destroyInboxMembers,
  getWebWidget, createWebWidget, updateWebWidget,
  createChannelEmail, createTwilioChannel,
} from './inboxes.controller.js';

export async function inboxesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  // ── Inboxes ──
  fastify.get('/api/v1/accounts/:account_id/inboxes', auth, listInboxes);
  fastify.post('/api/v1/accounts/:account_id/inboxes', auth, createInbox);
  fastify.get('/api/v1/accounts/:account_id/inboxes/:id', auth, showInbox);
  fastify.put('/api/v1/accounts/:account_id/inboxes/:id', auth, updateInbox);
  fastify.delete('/api/v1/accounts/:account_id/inboxes/:id', auth, destroyInbox);

  // Inbox sub-resources
  fastify.get('/api/v1/accounts/:account_id/inboxes/:id/assignable_agents', auth, inboxAssignableAgents);
  fastify.get('/api/v1/accounts/:account_id/inboxes/:id/campaigns', auth, inboxCampaigns);
  fastify.get('/api/v1/accounts/:account_id/inboxes/:id/agent_bot', auth, inboxAgentBot);
  fastify.post('/api/v1/accounts/:account_id/inboxes/:id/set_agent_bot', auth, inboxSetAgentBot);
  fastify.delete('/api/v1/accounts/:account_id/inboxes/:id/avatar', auth, inboxDeleteAvatar);
  fastify.get('/api/v1/accounts/:account_id/inboxes/:id/health', auth, inboxHealth);
  fastify.post('/api/v1/accounts/:account_id/inboxes/:id/sync_templates', auth, inboxSyncTemplates);
  fastify.post('/api/v1/accounts/:account_id/inboxes/:id/register_webhook', auth, inboxRegisterWebhook);

  // ── Inbox Members ──
  fastify.post('/api/v1/accounts/:account_id/inbox_members', auth, createInboxMembers);
  fastify.get('/api/v1/accounts/:account_id/inbox_members/:inbox_id', auth, showInboxMembers);
  fastify.patch('/api/v1/accounts/:account_id/inbox_members', auth, updateInboxMembers);
  fastify.delete('/api/v1/accounts/:account_id/inbox_members', auth, destroyInboxMembers);

  // ── Web Widget Channel ──
  fastify.get('/api/v1/accounts/:account_id/channel_web_widgets', auth, getWebWidget);
  fastify.post('/api/v1/accounts/:account_id/channel_web_widgets', auth, createWebWidget);
  fastify.put('/api/v1/accounts/:account_id/channel_web_widgets', auth, updateWebWidget);

  // ── Email Channel ──
  fastify.post('/api/v1/accounts/:account_id/channel_email', auth, createChannelEmail);

  // ── Twilio Channel ──
  fastify.post('/api/v1/accounts/:account_id/channels/twilio_channel', auth, createTwilioChannel);

  // ── Cross-inbox assignable agents (intersection across multiple inboxes) ──
  fastify.get('/api/v1/accounts/:account_id/assignable_agents', auth, inboxAssignableAgents);
}
