import { z } from 'zod';

// ── Sign Up ──
export const signUpSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  password_confirmation: z.string(),
}).refine((d) => d.password === d.password_confirmation, {
  message: 'Password confirmation does not match',
  path: ['password_confirmation'],
});

export type SignUpInput = z.infer<typeof signUpSchema>;

// ── Sign In ──
export const signInSchema = z.object({
  work_no: z.string().trim().min(1, '请输入工号').max(64),
  password: z.string().min(1, '请输入密码'),
  user_id: z.number().int().positive().optional(),
  vdn_id: z.number().int().positive().optional(),
  extension: z.never().optional(),
  device_id: z.string().min(8).max(128).optional(),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const loginVdnUpdateSchema = z.object({
  user_id: z.number().int().positive(),
  vdn_id: z.number().int().positive().nullable(),
});

// ── Password Reset Request ──
export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

// ── Password Reset ──
export const passwordResetSchema = z.object({
  token: z.string(),
  password: z.string().min(6),
  password_confirmation: z.string(),
}).refine((d) => d.password === d.password_confirmation, {
  message: 'Password confirmation does not match',
  path: ['password_confirmation'],
});

// ── Profile Update ──
export const profileUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  display_name: z.string().max(255).optional(),
  email: z.string().email().optional(),
  message_signature: z.string().optional(),
  ui_settings: z.record(z.unknown()).optional(),
  custom_attributes: z.record(z.unknown()).optional(),
  department: z.string().max(255).optional(),
  title: z.string().max(255).optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// ── Availability ──
export const availabilitySchema = z.object({
  availability: z.enum(['online', 'offline', 'busy']),
});

// ── Auto Offline ──
export const autoOfflineSchema = z.object({
  auto_offline: z.boolean(),
});

// ── MFA Setup ──
export const mfaVerifySchema = z.object({
  otp_code: z.string().length(6),
});

// ── Platform Token ──
export const platformTokenSchema = z.object({
  email: z.string().email(),
});
