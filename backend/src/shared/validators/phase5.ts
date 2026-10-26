import { z } from 'zod';

export const notificationUpdateSchema = z.object({
  read_at: z.string().optional().nullable(),
  snoozed_until: z.string().optional().nullable(),
});

export const notificationSettingsSchema = z.object({
  email_flags: z.number().int().optional(),
  push_flags: z.number().int().optional(),
});
