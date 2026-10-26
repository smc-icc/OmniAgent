import type { FastifyInstance } from 'fastify';
import {
  widgetConfig, widgetConversations, widgetCreateConversation,
  widgetToggleTyping, widgetUpdateLastSeen, widgetToggleStatus,
  widgetTranscript, widgetSetCustomAttributes,
  widgetMessages, widgetCreateMessage, widgetUpdateMessage,
  widgetContact, widgetUpdateContact,
  widgetCampaigns, widgetEvents, widgetInboxMembers, widgetDirectUploads,
} from './widget.controller.js';

/**
 * Public Widget API — unauthenticated endpoints for the customer-facing widget.
 * Chatwoot equivalent: app/controllers/api/v1/widget/
 */
export default async function widgetRoutes(fastify: FastifyInstance) {
  // ── Config ──
  fastify.post('/public/api/v1/widget/config', widgetConfig);

  // ── Conversations ──
  fastify.get('/public/api/v1/widget/conversations', widgetConversations);
  fastify.post('/public/api/v1/widget/conversations', widgetCreateConversation);
  fastify.post('/public/api/v1/widget/conversations/:id/toggle_typing', widgetToggleTyping);
  fastify.post('/public/api/v1/widget/conversations/:id/update_last_seen', widgetUpdateLastSeen);
  fastify.get('/public/api/v1/widget/conversations/:id/toggle_status', widgetToggleStatus);
  fastify.post('/public/api/v1/widget/conversations/:id/transcript', widgetTranscript);
  fastify.post('/public/api/v1/widget/conversations/:id/set_custom_attributes', widgetSetCustomAttributes);

  // ── Messages ──
  fastify.get('/public/api/v1/widget/messages/:conversation_id', widgetMessages);
  fastify.post('/public/api/v1/widget/messages', widgetCreateMessage);
  fastify.patch('/public/api/v1/widget/messages/:id', widgetUpdateMessage);

  // ── Contact ──
  fastify.get('/public/api/v1/widget/contact', widgetContact);
  fastify.patch('/public/api/v1/widget/contact', widgetUpdateContact);

  // ── Campaigns ──
  fastify.get('/public/api/v1/widget/campaigns', widgetCampaigns);

  // ── Events ──
  fastify.post('/public/api/v1/widget/events', widgetEvents);

  // ── Inbox Members ──
  fastify.get('/public/api/v1/widget/inbox_members', widgetInboxMembers);

  // ── Direct Uploads ──
  fastify.post('/public/api/v1/widget/direct_uploads', widgetDirectUploads);
}
