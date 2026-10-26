import type { FastifyInstance } from 'fastify';
import {
  signUp, signIn, signOut, validateToken, currentLoginSession,
  requestPasswordReset, resetPassword,
  confirmEmail, resendConfirmation,
  getProfile, updateProfile, getLoginVdn, updateLoginVdn, deleteAvatar,
  setAvailability, setAutoOffline,
  setActiveAccount, profileResendConfirmation, resetAccessToken,
  getMfaStatus, setupMfa, verifyMfa, disableMfa, getBackupCodes,
  generatePlatformToken,
  createNotificationSubscription, deleteNotificationSubscription,
  samlLogin,
} from './auth.controller.js';

/**
 * Register all auth-related routes.
 * Mirrors Chatwoot's Devise token auth + profile routes.
 */
export async function authRoutes(fastify: FastifyInstance) {
  // ── Devise Token Auth compatible endpoints ──
  fastify.post('/auth', signUp);
  fastify.post('/auth/sign_in', signIn);
  fastify.delete('/auth/sign_out', { preHandler: [fastify.authenticate] }, signOut);
  fastify.get('/auth/validate_token', { preHandler: [fastify.authenticate] }, validateToken);
  fastify.get('/api/agent/login-session', { preHandler: [fastify.authenticate] }, currentLoginSession);

  // Password reset
  fastify.post('/auth/password', requestPasswordReset);
  fastify.put('/auth/password', resetPassword);

  // Email confirmation
  fastify.get('/auth/confirmation', confirmEmail);
  fastify.post('/auth/confirmation', resendConfirmation);

  // SAML login
  fastify.post('/api/v1/auth/saml_login', samlLogin);

  // ── Profile ──
  const profileOpts = { preHandler: [fastify.authenticate] };

  fastify.get('/api/v1/profile', profileOpts, getProfile);
  fastify.put('/api/v1/profile', profileOpts, updateProfile);
  fastify.get('/api/v1/profile/login-vdn', profileOpts, getLoginVdn);
  fastify.put('/api/v1/profile/login-vdn', profileOpts, updateLoginVdn);
  fastify.delete('/api/v1/profile/avatar', profileOpts, deleteAvatar);
  fastify.post('/api/v1/profile/availability', profileOpts, setAvailability);
  fastify.post('/api/v1/profile/auto_offline', profileOpts, setAutoOffline);
  fastify.put('/api/v1/profile/set_active_account', profileOpts, setActiveAccount);
  fastify.post('/api/v1/profile/resend_confirmation', profileOpts, profileResendConfirmation);
  fastify.post('/api/v1/profile/reset_access_token', profileOpts, resetAccessToken);

  // ── MFA ──
  fastify.get('/api/v1/profile/mfa', profileOpts, getMfaStatus);
  fastify.post('/api/v1/profile/mfa', profileOpts, setupMfa);
  fastify.post('/api/v1/profile/mfa/verify', profileOpts, verifyMfa);
  fastify.delete('/api/v1/profile/mfa', profileOpts, disableMfa);
  fastify.post('/api/v1/profile/mfa/backup_codes', profileOpts, getBackupCodes);

  // ── Notification Subscriptions ──
  fastify.post('/api/v1/notification_subscriptions', profileOpts, createNotificationSubscription);
  fastify.delete('/api/v1/notification_subscriptions', profileOpts, deleteNotificationSubscription);

  // ── Platform API ──
  fastify.post('/platform/api/v1/users/:id/token', generatePlatformToken);
}
