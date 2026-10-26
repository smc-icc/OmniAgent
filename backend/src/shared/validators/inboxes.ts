import { z } from 'zod';

// ── Inbox ──
export const createInboxSchema = z.object({
  name: z.string().min(1).max(255),
  channel_type: z.string().min(1),
  channel_id: z.number().int().optional(),
  enable_auto_assignment: z.boolean().default(true),
  greeting_enabled: z.boolean().default(false),
  greeting_message: z.string().optional(),
  email_address: z.string().email().optional(),
  working_hours_enabled: z.boolean().default(false),
  out_of_office_message: z.string().optional(),
  timezone: z.string().default('UTC'),
  enable_email_collect: z.boolean().default(true),
  csat_survey_enabled: z.boolean().default(false),
  allow_messages_after_resolved: z.boolean().default(true),
  lock_to_single_conversation: z.boolean().default(false),
  sender_name_type: z.number().int().default(0),
  business_name: z.string().optional(),
});

export const updateInboxSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  enable_auto_assignment: z.boolean().optional(),
  greeting_enabled: z.boolean().optional(),
  greeting_message: z.string().optional(),
  working_hours_enabled: z.boolean().optional(),
  out_of_office_message: z.string().optional(),
  timezone: z.string().optional(),
  enable_email_collect: z.boolean().optional(),
  csat_survey_enabled: z.boolean().optional(),
  allow_messages_after_resolved: z.boolean().optional(),
  lock_to_single_conversation: z.boolean().optional(),
  business_name: z.string().optional(),
  auto_assignment_config: z.record(z.unknown()).optional(),
  csat_config: z.record(z.unknown()).optional(),
  itr_flow_id: z.number().int().nullable().optional(),
  itr_enabled: z.boolean().optional(),
});

export type CreateInboxInput = z.infer<typeof createInboxSchema>;
export type UpdateInboxInput = z.infer<typeof updateInboxSchema>;

// ── Inbox Member ──
export const createInboxMemberSchema = z.object({
  inbox_id: z.number().int(),
  user_ids: z.array(z.number().int()),
});

export const updateInboxMemberSchema = z.object({
  inbox_id: z.number().int(),
  user_ids: z.array(z.number().int()),
});

export const setAgentBotSchema = z.object({
  agent_bot_id: z.number().int(),
});

// ── Web Widget ──
export const createWebWidgetSchema = z.object({
  website_url: z.string().optional(),
  widget_color: z.string().default('#1f93ff'),
  welcome_title: z.string().optional(),
  welcome_tagline: z.string().optional(),
  reply_time: z.number().int().default(0),
  pre_chat_form_enabled: z.boolean().default(false),
  pre_chat_form_options: z.record(z.unknown()).default({}),
  continuity_via_email: z.boolean().default(true),
  allowed_domains: z.string().default(''),
});

export const updateWebWidgetSchema = z.object({
  website_url: z.string().optional(),
  widget_color: z.string().optional(),
  welcome_title: z.string().optional(),
  welcome_tagline: z.string().optional(),
  reply_time: z.number().int().optional(),
  pre_chat_form_enabled: z.boolean().optional(),
  pre_chat_form_options: z.record(z.unknown()).optional(),
  continuity_via_email: z.boolean().optional(),
  allowed_domains: z.string().optional(),
});

// ── Channel Email ──
export const createChannelEmailSchema = z.object({
  email: z.string().email(),
  forward_to_email: z.string().email(),
  imap_enabled: z.boolean().default(false),
  imap_address: z.string().optional(),
  imap_port: z.number().int().default(0),
  imap_login: z.string().optional(),
  imap_password: z.string().optional(),
  imap_enable_ssl: z.boolean().default(true),
  smtp_enabled: z.boolean().default(false),
  smtp_address: z.string().optional(),
  smtp_port: z.number().int().default(0),
  smtp_login: z.string().optional(),
  smtp_password: z.string().optional(),
  smtp_domain: z.string().optional(),
});
