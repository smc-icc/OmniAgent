import type { FastifyInstance } from 'fastify';
import {
  listConversations, createConversation, showConversation, updateConversation, destroyConversation,
  conversationsMeta, searchConversations, filterConversations,
  listMessages, createMessage, updateMessage, destroyMessage, translateMessage, translateText, retryMessage,
  assignConversation, addConversationLabels, listConversationLabels,
  showParticipants, addParticipants, updateParticipants, removeParticipants,
  showDraftMessage, updateDraftMessage, destroyDraftMessage,
  directUpload,
  muteConversation, unmuteConversation, transcriptConversation,
  toggleStatus, togglePriority, toggleTypingStatus, updateLastSeen, markUnread,
  setCustomAttributes, listAttachments, inboxAssistant,
} from './conversations.controller.js';

export async function conversationsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };
  const base = '/api/v1/accounts/:account_id/conversations';
  const accountBase = '/api/v1/accounts/:account_id';

  fastify.post(`${accountBase}/translate-text`, auth, translateText);

  // Conversations CRUD
  fastify.get(base, auth, listConversations);
  fastify.post(base, auth, createConversation);
  fastify.get(`${base}/meta`, auth, conversationsMeta);
  fastify.get(`${base}/search`, auth, searchConversations);
  fastify.post(`${base}/filter`, auth, filterConversations);
  fastify.get(`${base}/:id`, auth, showConversation);
  fastify.put(`${base}/:id`, auth, updateConversation);
  fastify.delete(`${base}/:id`, auth, destroyConversation);

  // Messages
  fastify.get(`${base}/:id/messages`, auth, listMessages);
  fastify.post(`${base}/:id/messages`, auth, createMessage);
  fastify.put(`${base}/:id/messages/:msg_id`, auth, updateMessage);
  fastify.delete(`${base}/:id/messages/:msg_id`, auth, destroyMessage);
  fastify.post(`${base}/:id/messages/:msg_id/translate`, auth, translateMessage);
  fastify.post(`${base}/:id/messages/:msg_id/retry`, auth, retryMessage);

  // Assignments & Labels
  fastify.post(`${base}/:id/assignments`, auth, assignConversation);
  fastify.post(`${base}/:id/labels`, auth, addConversationLabels);
  fastify.get(`${base}/:id/labels`, auth, listConversationLabels);

  // Participants
  fastify.get(`${base}/:id/participants`, auth, showParticipants);
  fastify.post(`${base}/:id/participants`, auth, addParticipants);
  fastify.put(`${base}/:id/participants`, auth, updateParticipants);
  fastify.delete(`${base}/:id/participants`, auth, removeParticipants);

  // Drafts & Uploads
  fastify.get(`${base}/:id/draft_messages`, auth, showDraftMessage);
  fastify.put(`${base}/:id/draft_messages`, auth, updateDraftMessage);
  fastify.delete(`${base}/:id/draft_messages`, auth, destroyDraftMessage);
  fastify.post(`${base}/:id/direct_uploads`, auth, directUpload);

  // Actions
  fastify.post(`${base}/:id/mute`, auth, muteConversation);
  fastify.post(`${base}/:id/unmute`, auth, unmuteConversation);
  fastify.get(`${base}/:id/transcript`, auth, transcriptConversation);
  fastify.post(`${base}/:id/toggle_status`, auth, toggleStatus);
  fastify.post(`${base}/:id/toggle_priority`, auth, togglePriority);
  fastify.post(`${base}/:id/toggle_typing_status`, auth, toggleTypingStatus);
  fastify.post(`${base}/:id/update_last_seen`, auth, updateLastSeen);
  fastify.post(`${base}/:id/unread`, auth, markUnread);
  fastify.post(`${base}/:id/custom_attributes`, auth, setCustomAttributes);
  fastify.get(`${base}/:id/attachments`, auth, listAttachments);
  fastify.get(`${base}/:id/inbox_assistant`, auth, inboxAssistant);
}
