import { z } from 'zod';

// ── Conversation ──
export const createConversationSchema = z.object({
  inbox_id: z.number().int(),
  contact_id: z.number().int().optional(),
  status: z.enum(['open', 'resolved', 'pending', 'snoozed']).default('open'),
  assignee_id: z.number().int().optional(),
  team_id: z.number().int().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  additional_attributes: z.record(z.unknown()).default({}),
});

export const updateConversationSchema = z.object({
  status: z.enum(['open', 'resolved', 'pending', 'snoozed']).optional(),
  assignee_id: z.number().int().optional().nullable(),
  team_id: z.number().int().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  additional_attributes: z.record(z.unknown()).optional(),
  custom_attributes: z.record(z.unknown()).optional(),
});

export const conversationFilterSchema = z.object({
  status: z.enum(['open', 'resolved', 'pending', 'snoozed', 'all']).optional(),
  assignee_id: z.number().int().optional(),
  inbox_id: z.number().int().optional(),
  team_id: z.number().int().optional(),
  labels: z.array(z.string()).optional(),
  page: z.number().int().default(1),
  per_page: z.number().int().default(25),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;

// ── Message ──
export const createMessageSchema = z
  .object({
    content: z.string().default(''),
    message_type: z.enum(['incoming', 'outgoing']).default('outgoing'),
    content_type: z.enum(['text', 'input_select', 'cards', 'form']).default('text'),
    content_attributes: z.record(z.unknown()).default({}),
    private: z.boolean().default(false),
    source_id: z.string().optional(),
    sender_type: z.string().default('User'),
    sender_id: z.number().int().default(0),
  })
  .refine(
    (data) => {
      const kind = (data.content_attributes as Record<string, unknown>)?.kind;
      return data.content.trim().length > 0 || !!kind;
    },
    { message: 'content or content_attributes.kind is required' },
  );

export const updateMessageSchema = z.object({
  content: z.string().min(1).optional(),
  content_attributes: z.record(z.unknown()).optional(),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;

// ── Assignment ──
export const assignmentSchema = z.object({
  assignee_id: z.number().int(),
});

// ── Labels ──
export const conversationLabelSchema = z.object({
  labels: z.array(z.string()),
});

// ── Participants ──
export const participantSchema = z.object({
  user_ids: z.array(z.number().int()),
});

// ── Draft ──
export const draftMessageSchema = z.object({
  content: z.string().optional(),
  message_type: z.string().optional(),
});

// ── Custom Attributes ──
export const customAttributesSchema = z.object({
  custom_attributes: z.record(z.unknown()),
});

// ── Toggle Priority ──
export const togglePrioritySchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});
