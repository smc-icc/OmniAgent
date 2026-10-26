import type { FastifyInstance } from 'fastify';
import {
  showCaptainPreferences, updateCaptainPreferences,
  listAssistants, createAssistant, showAssistant, updateAssistant, destroyAssistant,
  assistantPlayground, assistantTools,
  listAssistantInboxes, addAssistantInbox, removeAssistantInbox,
  listScenarios, createScenario, destroyScenario,
  listAssistantResponses,
  listCopilotThreads, createCopilotThread,
  listCopilotMessages, createCopilotMessage,
  listCustomTools, createCustomTool, destroyCustomTool,
  listDocuments, createDocument, showDocument, destroyDocument,
  rewriteTask, summarizeTask, replySuggestion, labelSuggestion, followUpTask,
  captainBulkActions,
} from './captain.controller.js';

export async function captainRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };
  const base = '/api/v1/accounts/:account_id';
  const cap = `${base}/captain`;

  // Preferences
  fastify.get(`${cap}/preferences`, auth, showCaptainPreferences);
  fastify.put(`${cap}/preferences`, auth, updateCaptainPreferences);

  // Assistants
  fastify.get(`${cap}/assistants`, auth, listAssistants);
  fastify.post(`${cap}/assistants`, auth, createAssistant);
  fastify.get(`${cap}/assistants/tools`, auth, assistantTools);
  fastify.get(`${cap}/assistants/:id`, auth, showAssistant);
  fastify.put(`${cap}/assistants/:id`, auth, updateAssistant);
  fastify.delete(`${cap}/assistants/:id`, auth, destroyAssistant);
  fastify.post(`${cap}/assistants/:id/playground`, auth, assistantPlayground);

  // Assistant Inboxes
  fastify.get(`${cap}/assistants/:id/inboxes`, auth, listAssistantInboxes);
  fastify.post(`${cap}/assistants/:id/inboxes`, auth, addAssistantInbox);
  fastify.delete(`${cap}/assistants/:id/inboxes/:inbox_id`, auth, removeAssistantInbox);

  // Scenarios
  fastify.get(`${cap}/assistants/:id/scenarios`, auth, listScenarios);
  fastify.post(`${cap}/assistants/:id/scenarios`, auth, createScenario);
  fastify.delete(`${cap}/assistants/:id/scenarios/:id`, auth, destroyScenario);

  // Assistant Responses
  fastify.get(`${cap}/assistant_responses`, auth, listAssistantResponses);

  // Copilot Threads & Messages
  fastify.get(`${cap}/copilot_threads`, auth, listCopilotThreads);
  fastify.post(`${cap}/copilot_threads`, auth, createCopilotThread);
  fastify.get(`${cap}/copilot_threads/:thread_id/copilot_messages`, auth, listCopilotMessages);
  fastify.post(`${cap}/copilot_threads/:thread_id/copilot_messages`, auth, createCopilotMessage);

  // Custom Tools
  fastify.get(`${cap}/custom_tools`, auth, listCustomTools);
  fastify.post(`${cap}/custom_tools`, auth, createCustomTool);
  fastify.delete(`${cap}/custom_tools/:id`, auth, destroyCustomTool);

  // Documents
  fastify.get(`${cap}/documents`, auth, listDocuments);
  fastify.post(`${cap}/documents`, auth, createDocument);
  fastify.get(`${cap}/documents/:id`, auth, showDocument);
  fastify.delete(`${cap}/documents/:id`, auth, destroyDocument);

  // LLM Tasks
  fastify.post(`${cap}/tasks/rewrite`, auth, rewriteTask);
  fastify.post(`${cap}/tasks/summarize`, auth, summarizeTask);
  fastify.post(`${cap}/tasks/reply_suggestion`, auth, replySuggestion);
  fastify.post(`${cap}/tasks/label_suggestion`, auth, labelSuggestion);
  fastify.post(`${cap}/tasks/follow_up`, auth, followUpTask);

  // Bulk Actions
  fastify.post(`${cap}/bulk_actions`, auth, captainBulkActions);
}
