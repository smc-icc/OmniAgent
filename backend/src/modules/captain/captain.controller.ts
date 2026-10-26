import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import {
  captainPreferencesSchema, assistantSchema, updateAssistantSchema,
  copilotThreadSchema, copilotMessageSchema,
  captainDocumentSchema, captainCustomToolSchema, captainScenarioSchema,
  captainTaskSchema,
} from '../../shared/validators/captain.js';
import { NotFoundError } from '../../shared/errors/index.js';
import type { ConversationContext } from '../../plugins/llm.js';
import { buildConversationContext } from '../../shared/services/conversation-context.js';

// ── Preferences ──

export async function showCaptainPreferences(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const account = await prisma.accounts.findUnique({
    where: { id: parseInt(account_id, 10) },
    select: { settings: true },
  });
  const prefs = (account?.settings as Record<string, unknown>)?.captain ?? {};
  return reply.status(200).send(prefs);
}

export async function updateCaptainPreferences(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = captainPreferencesSchema.parse(request.body);

  const account = await prisma.accounts.findUnique({
    where: { id: parseInt(account_id, 10) },
    select: { settings: true },
  });
  const currentSettings = (account?.settings as Record<string, unknown>) ?? {};
  const newSettings = { ...currentSettings, captain: { ...(currentSettings.captain as object ?? {}), ...body } };

  await prisma.accounts.update({
    where: { id: parseInt(account_id, 10) },
    data: { settings: newSettings },
  });

  return reply.status(200).send(body);
}

// ── Assistants ──

export async function listAssistants(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.captain_assistants.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createAssistant(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = assistantSchema.parse(request.body);
  const item = await prisma.captain_assistants.create({
    data: {
      account_id: parseInt(account_id, 10), name: body.name, description: body.description,
      config: body.config as object, response_guidelines: body.response_guidelines as object,
      guardrails: body.guardrails as object,
    },
  });
  return reply.status(200).send(item);
}

export async function showAssistant(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await prisma.captain_assistants.findUnique({ where: { id: parseInt(id, 10) } });
  if (!item) throw new NotFoundError('Assistant');
  return reply.status(200).send(item);
}

export async function updateAssistant(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateAssistantSchema.parse(request.body);
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.config !== undefined) data.config = body.config;
  if (body.response_guidelines !== undefined) data.response_guidelines = body.response_guidelines;
  if (body.guardrails !== undefined) data.guardrails = body.guardrails;

  const item = await prisma.captain_assistants.update({
    where: { id: parseInt(id, 10) },
    data: data as object,
  });
  return reply.status(200).send(item);
}

export async function destroyAssistant(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.captain_assistants.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

export async function assistantPlayground(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as { prompt?: string; system_prompt?: string; temperature?: number };

  const assistant = await prisma.captain_assistants.findUnique({
    where: { id: parseInt(id, 10) },
  });
  if (!assistant) throw new NotFoundError('Assistant');

  const systemPrompt = body.system_prompt ?? (assistant.config as Record<string, unknown>)?.system_prompt as string
    ?? `You are ${assistant.name}. ${assistant.description ?? ''}`;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Add response guidelines as additional system context
  const guidelines = assistant.response_guidelines as string[];
  if (guidelines?.length) {
    messages.push({ role: 'system', content: `Response guidelines: ${guidelines.join('; ')}` });
  }

  messages.push({ role: 'user', content: body.prompt ?? 'Hello!' });

  const response = await request.server.llm.chat(
    messages as unknown as Array<import('openai').OpenAI.ChatCompletionMessageParam>,
    { temperature: body.temperature ?? 0.7, maxTokens: 1024 },
  );

  return reply.status(200).send({
    assistant_id: parseInt(id, 10),
    assistant_name: assistant.name,
    response,
  });
}

export async function assistantTools(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ tools: ['rewrite', 'summarize', 'reply_suggestion', 'label_suggestion', 'follow_up'] });
}

// ── Assistant Inboxes ──

export async function listAssistantInboxes(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const items = await prisma.captain_inboxes.findMany({
    where: { captain_assistant_id: parseInt(id, 10) },
    include: { inbox: { select: { id: true, name: true } } },
  });
  return reply.status(200).send(items.map((ci) => ({ inbox_id: ci.inbox_id, name: ci.inbox?.name })));
}

export async function addAssistantInbox(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { inbox_id } = request.body as { inbox_id: number };
  await prisma.captain_inboxes.create({
    data: { captain_assistant_id: parseInt(id, 10), inbox_id },
  });
  return reply.status(200).send({ success: true });
}

export async function removeAssistantInbox(request: FastifyRequest, reply: FastifyReply) {
  const { id, inbox_id } = request.params as { id: string; inbox_id: string };
  await prisma.captain_inboxes.deleteMany({
    where: { captain_assistant_id: parseInt(id, 10), inbox_id: parseInt(inbox_id, 10) },
  });
  return reply.status(200).send({ success: true });
}

// ── Scenarios ──

export async function listScenarios(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const items = await prisma.captain_scenarios.findMany({
    where: { assistant_id: parseInt(id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createScenario(request: FastifyRequest, reply: FastifyReply) {
  const { id, account_id } = request.params as { id: string; account_id: string };
  const body = captainScenarioSchema.parse(request.body);
  const item = await prisma.captain_scenarios.create({
    data: {
      assistant_id: parseInt(id, 10), account_id: parseInt(account_id, 10),
      title: body.title, description: body.description, instruction: body.instruction,
      tools: body.tools as object, enabled: body.enabled,
    },
  });
  return reply.status(200).send(item);
}

export async function destroyScenario(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.captain_scenarios.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ── Assistant Responses ──

export async function listAssistantResponses(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.captain_assistant_responses.findMany({
    where: { account_id: parseInt(account_id, 10) },
    orderBy: { created_at: 'desc' },
    take: 100,
  });
  return reply.status(200).send(items);
}

// ── Copilot Threads ──

export async function listCopilotThreads(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const user = request.currentUser;
  const items = await prisma.copilot_threads.findMany({
    where: { account_id: parseInt(account_id, 10), user_id: user?.id ?? 1 },
    orderBy: { updated_at: 'desc' },
  });
  return reply.status(200).send(items);
}

export async function createCopilotThread(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = copilotThreadSchema.parse(request.body);
  const user = request.currentUser;
  const item = await prisma.copilot_threads.create({
    data: {
      account_id: parseInt(account_id, 10), user_id: user?.id ?? 1,
      title: body.title, assistant_id: body.assistant_id,
    },
  });
  return reply.status(200).send(item);
}

// ── Copilot Messages ──

export async function listCopilotMessages(request: FastifyRequest, reply: FastifyReply) {
  const { thread_id } = request.params as { thread_id: string };
  const items = await prisma.copilot_messages.findMany({
    where: { copilot_thread_id: parseInt(thread_id, 10) },
    orderBy: { created_at: 'asc' },
  });
  return reply.status(200).send(items);
}

export async function createCopilotMessage(request: FastifyRequest, reply: FastifyReply) {
  const { thread_id, account_id } = request.params as { thread_id: string; account_id: string };
  const body = copilotMessageSchema.parse(request.body);
  const item = await prisma.copilot_messages.create({
    data: {
      copilot_thread_id: parseInt(thread_id, 10), account_id: parseInt(account_id, 10),
      message: body.message as object, message_type: body.message_type,
    },
  });
  return reply.status(200).send(item);
}

// ── Custom Tools ──

export async function listCustomTools(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.captain_custom_tools.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createCustomTool(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = captainCustomToolSchema.parse(request.body);
  const item = await prisma.captain_custom_tools.create({
    data: {
      account_id: parseInt(account_id, 10), slug: body.slug, title: body.title,
      description: body.description, http_method: body.http_method,
      endpoint_url: body.endpoint_url, request_template: body.request_template,
      response_template: body.response_template, auth_type: body.auth_type,
      auth_config: body.auth_config as object, param_schema: body.param_schema as object,
      enabled: body.enabled,
    },
  });
  return reply.status(200).send(item);
}

export async function destroyCustomTool(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.captain_custom_tools.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ── Documents ──

export async function listDocuments(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const items = await prisma.captain_documents.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(items);
}

export async function createDocument(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = captainDocumentSchema.parse(request.body);
  const item = await prisma.captain_documents.create({
    data: {
      account_id: parseInt(account_id, 10), assistant_id: body.assistant_id,
      name: body.name, external_link: body.external_link ?? '', content: body.content,
    },
  });
  return reply.status(200).send(item);
}

export async function showDocument(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await prisma.captain_documents.findUnique({ where: { id: parseInt(id, 10) } });
  if (!item) throw new NotFoundError('Document');
  return reply.status(200).send(item);
}

export async function destroyDocument(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.captain_documents.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ── LLM Tasks ──

export async function rewriteTask(request: FastifyRequest, reply: FastifyReply) {
  const body = captainTaskSchema.parse(request.body);
  const result = await request.server.llm.rewrite(body.content, body.context);
  return reply.status(200).send({ task: 'rewrite', original: body.content, result });
}

export async function summarizeTask(request: FastifyRequest, reply: FastifyReply) {
  const body = captainTaskSchema.parse(request.body);
  const result = await request.server.llm.summarize(body.content, body.context);
  return reply.status(200).send({ task: 'summarize', original: body.content, result });
}

export async function replySuggestion(request: FastifyRequest, reply: FastifyReply) {
  const body = captainTaskSchema.parse(request.body);

  // Build conversation context from the database if conversation_id is provided
  let context: ConversationContext = { messages: [{ role: 'customer', content: body.content }] };
  if (body.conversation_id) {
    context = await buildConversationContext(body.conversation_id, body.content);
  }

  const result = await request.server.llm.replySuggestion(context);
  return reply.status(200).send({ task: 'reply_suggestion', suggestions: result.suggestions });
}

export async function labelSuggestion(request: FastifyRequest, reply: FastifyReply) {
  const body = captainTaskSchema.parse(request.body);

  // Get account labels
  const { account_id } = request.params as { account_id: string };
  const dbLabels = await prisma.labels.findMany({
    where: { account_id: parseInt(account_id, 10) },
    select: { title: true },
  });
  const labelNames = dbLabels.map((l: { title: string | null }) => l.title).filter((t: string | null): t is string => t !== null);

  let context: ConversationContext = { messages: [{ role: 'customer', content: body.content }] };
  if (body.conversation_id) {
    context = await buildConversationContext(body.conversation_id, body.content);
  }

  const result = await request.server.llm.labelSuggestion(context, labelNames);
  return reply.status(200).send({ task: 'label_suggestion', labels: result.labels });
}

export async function followUpTask(request: FastifyRequest, reply: FastifyReply) {
  const body = captainTaskSchema.parse(request.body);

  let context: ConversationContext = { messages: [{ role: 'customer', content: body.content }] };
  if (body.conversation_id) {
    context = await buildConversationContext(body.conversation_id, body.content);
  }

  const result = await request.server.llm.followUp(context);
  return reply.status(200).send({ task: 'follow_up', tasks: result.tasks });
}

// ── Bulk Actions ──

export async function captainBulkActions(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { action: string; conversation_ids: number[] };
  const { account_id } = request.params as { account_id: string };

  // Queue bulk action to background job
  const jobId = `bulk_${body.action}_${Date.now()}`;
  request.server.enqueue('conversation', jobId, {
    conversation_ids: body.conversation_ids,
    action: body.action,
    account_id: parseInt(account_id, 10),
  });

  return reply.status(200).send({
    success: true,
    job_id: jobId,
    message: `Bulk ${body.action} queued for ${body.conversation_ids.length} conversations`,
  });
}
