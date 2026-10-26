import { z } from 'zod';

// ── Account ──
export const createAccountSchema = z.object({
  name: z.string().min(1).max(255),
  locale: z.number().int().optional().default(0),
  domain: z.string().max(100).optional(),
  support_email: z.string().email().max(100).optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  locale: z.number().int().optional(),
  domain: z.string().max(100).optional(),
  support_email: z.string().email().max(100).optional(),
  auto_resolve_duration: z.number().int().optional(),
  custom_attributes: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

// ── Agent ──
export const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  role: z.enum(['administrator', 'agent']).default('agent'),
  availability: z.enum(['online', 'offline', 'busy']).optional(),
  auto_offline: z.boolean().optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  role: z.string().optional(),
  availability: z.number().int().optional(),
  auto_offline: z.boolean().optional(),
});

export const bulkCreateAgentSchema = z.object({
  agents: z.array(z.object({
    name: z.string().min(1).max(255),
    email: z.string().email(),
    role: z.string().default('agent'),
  })),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;

// ── Team ──
export const createTeamSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  allow_auto_assign: z.boolean().default(true),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  allow_auto_assign: z.boolean().optional(),
});

export const teamMemberSchema = z.object({
  user_ids: z.array(z.number().int()),
});

export const updateTeamMemberSchema = z.object({
  user_ids: z.array(z.number().int()),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

// ── Agent Bot ──
export const createAgentBotSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  outgoing_url: z.string().url().optional(),
  bot_type: z.number().int().default(0),
  bot_config: z.record(z.unknown()).default({}),
});

export const updateAgentBotSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  outgoing_url: z.string().url().optional(),
  bot_type: z.number().int().optional(),
  bot_config: z.record(z.unknown()).optional(),
});

export type CreateAgentBotInput = z.infer<typeof createAgentBotSchema>;

// ── Custom Role ──
export const createCustomRoleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
});

export const updateCustomRoleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

// ── Agent Capacity Policy ──
export const createCapacityPolicySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  exclusion_rules: z.record(z.unknown()).default({}),
});

export const updateCapacityPolicySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  exclusion_rules: z.record(z.unknown()).optional(),
});

// ── Inbox Limit ──
export const createInboxLimitSchema = z.object({
  inbox_id: z.number().int(),
  conversation_limit: z.number().int().min(1),
});

export const updateInboxLimitSchema = z.object({
  conversation_limit: z.number().int().min(1),
});
