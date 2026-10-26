import OpenAI from 'openai';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { getConfig } from './platform_config.js';

/**
 * LLM plugin — provider-agnostic AI client.
 *
 * Decorates fastify with:
 *   fastify.llm.chat(messages, opts?)
 *   fastify.llm.rewrite(text, context?)
 *   fastify.llm.summarize(text, context?)
 *   fastify.llm.replySuggestion(conversation)
 *   fastify.llm.labelSuggestion(conversation, labels)
 *   fastify.llm.followUp(conversation)
 */

declare module 'fastify' {
  interface FastifyInstance {
    llm: LlmClient;
  }
}

export interface LlmClient {
  chat: (messages: OpenAI.ChatCompletionMessageParam[], opts?: { model?: string; temperature?: number; maxTokens?: number }) => Promise<string>;
  rewrite: (text: string, context?: string) => Promise<string>;
  summarize: (text: string, context?: string) => Promise<string>;
  replySuggestion: (conversation: ConversationContext) => Promise<ReplySuggestionResult>;
  labelSuggestion: (conversation: ConversationContext, labels: string[]) => Promise<LabelSuggestionResult>;
  followUp: (conversation: ConversationContext) => Promise<FollowUpResult>;
}

export interface ConversationContext {
  messages: Array<{ role: 'agent' | 'customer'; content: string; timestamp?: string }>;
  inbox_name?: string;
  contact_name?: string;
}

export interface ReplySuggestionResult {
  suggestions: string[];
}

export interface LabelSuggestionResult {
  labels: string[];
}

export interface FollowUpResult {
  tasks: Array<{ title: string; priority: 'low' | 'medium' | 'high'; due_in?: string }>;
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;

async function llmPlugin(fastify: FastifyInstance) {
  // Release configuration is authoritative; skip/external must not depend
  // on a DB seed key or even a platform-config query. Legacy dev mode keeps
  // its existing DB-first behavior.
  const apiKey = env.OPENAI_MODE === 'skip' ? ''
    : env.OPENAI_MODE === 'external' ? (env.OPENAI_API_KEY ?? '')
    : (await getConfig('openai_api_key')) || env.OPENAI_API_KEY || '';

  // If no API key is set, register a graceful-degradation stub
  if (!apiKey) {
    fastify.log.warn('[WARN] OPENAI_API_KEY not set — LLM features will return placeholder responses');
    fastify.decorate('llm', createStubClient());
    return;
  }

  const openai = new OpenAI({ apiKey, ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}) });

  const client: LlmClient = {
    // ── Raw chat ──
    async chat(messages, opts) {
      const response = await openai.chat.completions.create({
        model: opts?.model ?? env.OPENAI_MODEL ?? DEFAULT_MODEL,
        messages,
        temperature: opts?.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
      return response.choices[0]?.message?.content ?? '';
    },

    // ── Rewrite ──
    async rewrite(text, context) {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'You are a professional customer service agent. Rewrite the following message to be more clear, concise, and professional. Return ONLY the rewritten text, no explanations.' },
      ];
      if (context) {
        messages.push({ role: 'user', content: `Context: ${context}\n\nRewrite this: ${text}` });
      } else {
        messages.push({ role: 'user', content: `Rewrite this: ${text}` });
      }
      return client.chat(messages, { temperature: 0.3, maxTokens: 512 });
    },

    // ── Summarize ──
    async summarize(text, context) {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: 'You are a helpful assistant that summarizes customer service conversations. Provide a concise summary capturing the key issues, actions taken, and resolution status. Return ONLY the summary, no preamble.' },
      ];
      if (context) {
        messages.push({ role: 'user', content: `Context: ${context}\n\nConversation to summarize:\n${text}` });
      } else {
        messages.push({ role: 'user', content: `Summarize this conversation:\n${text}` });
      }
      return client.chat(messages, { temperature: 0.3, maxTokens: 512 });
    },

    // ── Reply Suggestion ──
    async replySuggestion(conversation) {
      const convoText = formatConversation(conversation);
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: 'You are an AI assistant helping a customer service agent. Based on the conversation, suggest 3 possible replies the agent could send. Return a JSON object with key "suggestions" containing an array of 3 strings. Format: {"suggestions": ["reply1", "reply2", "reply3"]}. No markdown, just the JSON.',
        },
        { role: 'user', content: convoText },
      ];
      const raw = await client.chat(messages, { temperature: 0.7, maxTokens: 600 });
      return parseJson<ReplySuggestionResult>(raw, { suggestions: ['Unable to generate suggestions.'] });
    },

    // ── Label Suggestion ──
    async labelSuggestion(conversation, labels) {
      const convoText = formatConversation(conversation);
      const labelList = labels.length > 0 ? labels.join(', ') : '(no existing labels)';
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: `You are an AI assistant that suggests conversation labels. Available labels: ${labelList}. Based on the conversation, suggest up to 3 appropriate labels from the available list. You may also suggest new labels if none fit. Return a JSON object with key "labels" containing an array of strings. Format: {"labels": ["Label1", "Label2"]}. No markdown, just the JSON.`,
        },
        { role: 'user', content: convoText },
      ];
      const raw = await client.chat(messages, { temperature: 0.3, maxTokens: 256 });
      return parseJson<LabelSuggestionResult>(raw, { labels: [] });
    },

    // ── Follow-up Tasks ──
    async followUp(conversation) {
      const convoText = formatConversation(conversation);
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: 'You are an AI assistant that identifies follow-up tasks from customer service conversations. Based on the conversation, suggest up to 3 actionable follow-up tasks. Return a JSON object with key "tasks" containing an array of objects, each with "title" (string), "priority" ("low"/"medium"/"high"), and optionally "due_in" (relative time string like "2 hours", "1 day"). Format: {"tasks": [{"title": "...", "priority": "medium", "due_in": "1 day"}]}. No markdown, just the JSON. Return {"tasks": []} if no tasks are needed.',
        },
        { role: 'user', content: convoText },
      ];
      const raw = await client.chat(messages, { temperature: 0.3, maxTokens: 512 });
      return parseJson<FollowUpResult>(raw, { tasks: [] });
    },
  };

  fastify.decorate('llm', client);
}

// ── Helpers ──

function formatConversation(conv: ConversationContext): string {
  const header = [
    conv.contact_name ? `Contact: ${conv.contact_name}` : null,
    conv.inbox_name ? `Channel: ${conv.inbox_name}` : null,
  ].filter(Boolean).join(', ');

  const messages = conv.messages.map((m) =>
    `[${m.role.toUpperCase()}]${m.timestamp ? ` (${m.timestamp})` : ''}: ${m.content}`
  ).join('\n\n');

  return `${header ? `--- Context: ${header} ---\n\n` : ''}${messages}`;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    // Strip markdown fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract JSON from within the text
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch { /* fall through */ }
    }
    return fallback;
  }
}

// ── Stub client (when no API key) ──

function createStubClient(): LlmClient {
  const stub = () => '[LLM not configured — set OPENAI_API_KEY]';
  return {
    chat: async () => stub(),
    rewrite: async (text) => `[LLM disabled] Rewrite of: ${text.substring(0, 80)}...`,
    summarize: async (text) => `[LLM disabled] Summary of: ${text.substring(0, 80)}...`,
    replySuggestion: async () => ({ suggestions: ['[LLM not configured] Enable by setting OPENAI_API_KEY in .env'] }),
    labelSuggestion: async () => ({ labels: [] }),
    followUp: async () => ({ tasks: [] }),
  };
}

export default fp(llmPlugin, { name: 'llm' });
