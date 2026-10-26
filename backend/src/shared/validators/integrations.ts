import { z } from 'zod';

// ── Portal ──
export const portalSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  custom_domain: z.string().optional(),
  color: z.string().optional(),
  homepage_link: z.string().optional(),
  page_title: z.string().optional(),
  header_text: z.string().optional(),
  config: z.record(z.unknown()).default({ allowed_locales: ['en'] }),
});
export const updatePortalSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  custom_domain: z.string().optional(),
  color: z.string().optional(),
  homepage_link: z.string().optional(),
  page_title: z.string().optional(),
  header_text: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

// ── Category ──
export const categorySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  locale: z.string().default('en'),
  slug: z.string().min(1).max(255),
  position: z.number().int().optional(),
  icon: z.string().default(''),
});
export const reorderSchema = z.object({ ids: z.array(z.number().int()) });

// ── Article ──
export const articleSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  content: z.string().optional(),
  description: z.string().optional(),
  locale: z.string().default('en'),
  status: z.number().int().default(0),
  position: z.number().int().optional(),
  meta: z.record(z.unknown()).default({}),
  category_id: z.number().int().optional(),
});
export const updateArticleSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.string().optional(),
  description: z.string().optional(),
  status: z.number().int().optional(),
  position: z.number().int().optional(),
  category_id: z.number().int().optional().nullable(),
  meta: z.record(z.unknown()).optional(),
});

// ── Integrations ──
export const hookSchema = z.object({
  app_id: z.string().min(1),
  inbox_id: z.number().int().optional(),
  status: z.number().int().default(1),
  hook_type: z.number().int().default(0),
  settings: z.record(z.unknown()).default({}),
});
export const slackSchema = z.object({ channel_id: z.string().optional() });
