import { confTenancyEnabled, assertLiveBinding, managedContext } from '../shared/services/conf-tenancy.js';
import { isSystemSuperuser } from '../shared/services/system-superuser.js';
import fp from 'fastify-plugin';
import { assertOperatorEnabled } from '../modules/access/access.enabled.js';
import { resolveCcsWorkNo } from '../integrations/ccs/ccs-workno.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { prisma } from './db.js';
import { AppError } from '../shared/errors/index.js';
import { getLoginSession, isCurrentSession } from '../shared/services/login-session.js';
import { assertActiveSocialLogin } from '../modules/social-auth/social-session-authority.js';

/**
 * Fastify plugin that verifies JWT and loads the current user + account
 * context into the request. Equivalent to Devise token auth + set_current_user
 * in Chatwoot Rails.
 *
 * Usage:
 *   fastify.register(authPlugin)
 *
 * On protected routes:
 *   preHandler: [fastify.authenticate]
 *
 * In handlers:
 *   request.currentUser    → { id, email, name, ... }
 *   request.currentAccount → { id, name, ... }
 */

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: {
      id: number;
      email: string;
      name: string;
      uid?: string;
      type?: string;
      pubsubToken?: string;
      custom_attributes?: Record<string, unknown>;
      accounts: Array<{ id: number; role: string }>;
    } | null;

    currentAccount: {
      id: number;
      name: string;
    } | null;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  // JWT verification decorator
  fastify.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw fastify.httpErrors.unauthorized('Invalid or expired token');
    }
    const payload = request.user as { id?: number; sid?: string };
    if (process.env.OMNI_EXTENSION_BINDING_ENABLED === '1' && payload.id && payload.sid && !getLoginSession(payload.id)) {
      const { database, rows } = await import('../modules/access/access.db.js');
      const [saved] = await rows<{ sid: string; context: import('../shared/services/login-session.js').LoginSession | string }>(await database(), "SELECT LoginSID AS sid, LoginContext AS context FROM t_omni_extension_voice WHERE OmniUserID=? AND State<>'logged_out'", [payload.id]);
      if (saved?.sid === payload.sid) (await import('../shared/services/login-session.js')).restoreLoginSession(typeof saved.context === 'string' ? JSON.parse(saved.context) : saved.context);
    }
    if (payload?.id != null && !isCurrentSession(payload.id, payload.sid)) {
      throw new AppError(401, '账号已在其他终端登录', 'session_replaced');
    }
    if (!request.currentUser) throw fastify.httpErrors.unauthorized('User not found');
    await assertActiveSocialLogin(request.currentUser.id, payload.sid);
    if (confTenancyEnabled()) {
      if (!isSystemSuperuser(request.currentUser)) await assertLiveBinding(request.currentUser.id);
    } else await assertOperatorEnabled(resolveCcsWorkNo({ ...request.currentUser, uid: request.currentUser.uid ?? null }, env.CCS_WORK_NO_FIELD));
  });

  // Load current user from JWT payload into request
  fastify.addHook('onRequest', async (request) => {
    try {
      await request.jwtVerify();
      const payload = request.user as { id: number; email: string; sid?: string };
      if (getLoginSession(payload.id) && !isCurrentSession(payload.id, payload.sid)) {
        request.currentUser = null;
        return;
      }

      const user = await prisma.users.findUnique({
        where: { id: payload.id },
        select: {
          id: true,
          email: true,
          name: true,
          uid: true,
          type: true,
          pubsub_token: true,
          custom_attributes: true,
        },
      });

      if (user) {
        request.currentUser = {
          id: user.id,
          email: user.email ?? '',
          name: user.name ?? '',
          uid: user.uid ?? undefined,
          type: user.type ?? undefined,
          pubsubToken: user.pubsub_token ?? undefined,
          custom_attributes: (user.custom_attributes as Record<string, unknown> | null) ?? undefined,
          accounts: [],
        };
      }
    } catch {
      // Not authenticated — that's fine for public routes
      request.currentUser = null;
    }

    if (!request.currentAccount) {
      request.currentAccount = null;
    }
  });

  // Utility: load account context from header or param
  fastify.decorate('loadAccount', async (request: FastifyRequest) => {
    if (confTenancyEnabled()) { await managedContext(request); return; }
    const accountId = parseInt(
      (request.params as Record<string, string>)?.account_id ??
      request.headers['x-account-id'] as string ??
      '0',
      10
    );

    if (!accountId || !request.currentUser) return;

    const accountUser = await prisma.account_users.findFirst({
      where: {
        account_id: accountId,
        user_id: request.currentUser.id,
      },
      include: { account: { select: { id: true, name: true } } },
    });

    if (accountUser?.account) {
      request.currentAccount = {
        id: accountUser.account.id,
        name: accountUser.account.name ?? '',
      };
    }
  });
});
