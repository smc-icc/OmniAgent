import { z } from 'zod';

export const captainPreferencesSchema = z.object({
  default_model: z.string().optional(),
  default_provider: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

export const assistantSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  config: z.record(z.unknown()).default({}),
  response_guidelines: z.array(z.unknown()).default([]),
  guardrails: z.array(z.unknown()).default([]),
});

export const updateAssistantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  response_guidelines: z.array(z.unknown()).optional(),
  guardrails: z.array(z.unknown()).optional(),
});

export const copilotThreadSchema = z.object({
  title: z.string().min(1).max(255),
  assistant_id: z.number().int().optional(),
});

export const copilotMessageSchema = z.object({
  message: z.record(z.unknown()),
  message_type: z.number().int().default(0),
});

export const captainDocumentSchema = z.object({
  name: z.string().min(1).max(255),
  external_link: z.string().url().optional(),
  content: z.string().optional(),
  assistant_id: z.number().int(),
});

export const captainCustomToolSchema = z.object({
  slug: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  http_method: z.string().default('GET'),
  endpoint_url: z.string().min(1),
  request_template: z.string().optional(),
  response_template: z.string().optional(),
  auth_type: z.string().default('none'),
  auth_config: z.record(z.unknown()).default({}),
  param_schema: z.array(z.unknown()).default([]),
  enabled: z.boolean().default(true),
});

export const captainScenarioSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  instruction: z.string().optional(),
  tools: z.array(z.unknown()).default([]),
  enabled: z.boolean().default(true),
});

export const captainTaskSchema = z.object({
  content: z.string().min(1),
  context: z.string().optional(),
  conversation_id: z.number().int().optional(),
});
