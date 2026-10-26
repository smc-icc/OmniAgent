import { z } from 'zod';

// ── Canned Response ──
export const cannedResponseSchema = z.object({
  short_code: z.string().min(1).max(100),
  content: z.string().min(1),
});
export type CannedResponseInput = z.infer<typeof cannedResponseSchema>;

// ── Automation Rule ──
export const automationRuleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  event_name: z.string().min(1),
  conditions: z.record(z.unknown()).default({}),
  actions: z.record(z.unknown()).default({}),
  active: z.boolean().default(true),
});
export type AutomationRuleInput = z.infer<typeof automationRuleSchema>;

// ── Macro ──
export const macroSchema = z.object({
  name: z.string().min(1).max(255),
  visibility: z.number().int().default(0),
  actions: z.record(z.unknown()).default({}),
});
export const macroExecuteSchema = z.object({
  conversation_ids: z.array(z.number().int()).optional(),
});
export type MacroInput = z.infer<typeof macroSchema>;

// ── Custom Filter ──
export const customFilterSchema = z.object({
  name: z.string().min(1).max(255),
  filter_type: z.number().int().default(0),
  query: z.record(z.unknown()).default({}),
});
export type CustomFilterInput = z.infer<typeof customFilterSchema>;

// ── CSAT ──
export const csatTemplateSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()).optional(),
  })).default([]),
});

// ── SLA Policy ──
export const slaPolicySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  first_response_time_threshold: z.number().optional(),
  next_response_time_threshold: z.number().optional(),
  resolution_time_threshold: z.number().optional(),
  only_during_business_hours: z.boolean().default(false),
});
export type SlaPolicyInput = z.infer<typeof slaPolicySchema>;

// ── Assignment Policy ──
export const assignmentPolicySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  assignment_order: z.number().int().default(0),
  conversation_priority: z.number().int().default(0),
  fair_distribution_limit: z.number().int().default(100),
  fair_distribution_window: z.number().int().default(3600),
  enabled: z.boolean().default(true),
});
export type AssignmentPolicyInput = z.infer<typeof assignmentPolicySchema>;
