import { z } from 'zod';

// ── Contact ──
export const createContactSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
  identifier: z.string().optional(),
  company_id: z.number().int().optional(),
  additional_attributes: z.record(z.unknown()).default({}),
  custom_attributes: z.record(z.unknown()).default({}),
  contact_type: z.number().int().default(0),
  middle_name: z.string().optional(),
  last_name: z.string().optional(),
  location: z.string().optional(),
  country_code: z.string().optional(),
  blocked: z.boolean().default(false),
});

export const updateContactSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional().nullable(),
  phone_number: z.string().optional().nullable(),
  identifier: z.string().optional().nullable(),
  company_id: z.number().int().optional().nullable(),
  additional_attributes: z.record(z.unknown()).optional(),
  custom_attributes: z.record(z.unknown()).optional(),
  blocked: z.boolean().optional(),
  middle_name: z.string().optional(),
  last_name: z.string().optional(),
  location: z.string().optional(),
  country_code: z.string().optional(),
});

export const contactFilterSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone_number: z.string().optional(),
  labels: z.array(z.string()).optional(),
  page: z.number().int().default(1),
  per_page: z.number().int().default(25),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

// ── Company ──
export const createCompanySchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().optional(),
  description: z.string().optional(),
});

export const updateCompanySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  domain: z.string().optional(),
  description: z.string().optional(),
});

// ── Note ──
export const createNoteSchema = z.object({
  content: z.string().min(1),
});

// ── Custom Attribute Definition ──
export const createCustomAttrDefSchema = z.object({
  attribute_display_name: z.string().min(1),
  attribute_key: z.string().min(1),
  attribute_display_type: z.number().int().default(0),
  attribute_model: z.number().int().default(0),
  attribute_description: z.string().optional(),
  attribute_values: z.array(z.unknown()).default([]),
  regex_pattern: z.string().optional(),
  regex_cue: z.string().optional(),
});

export const updateCustomAttrDefSchema = z.object({
  attribute_display_name: z.string().optional(),
  attribute_display_type: z.number().int().optional(),
  attribute_description: z.string().optional(),
  attribute_values: z.array(z.unknown()).optional(),
});

// ── Bulk Actions / Merge ──
export const contactMergeSchema = z.object({
  base_contact_id: z.number().int(),
  mergee_contact_id: z.number().int(),
});
