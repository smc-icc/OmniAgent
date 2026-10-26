import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { AppError } from '../../shared/errors/index.js';
import { SocialAuthService, socialPlatformSchema, socialProviderSchema, type SocialSessionResult } from './social-service.js';

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const verifier = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const code = z.string().trim().min(1).max(64);
const authorizeSchema = z.object({ provider: socialProviderSchema, platform: socialPlatformSchema, organization_code: code,
  proof_challenge: token, device_id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/) }).strict();
const exchangeSchema = z.object({ ticket: token, transaction_id: token, proof_verifier: verifier }).strict();
const bindingSchema = z.object({ binding_ticket: token, transaction_id: token, proof_verifier: verifier,
  email: z.string().trim().min(1).max(254), password: z.string().min(1).max(256) }).strict();
export interface SocialRouteDependencies {
  service: SocialAuthService | null;
  complete(request: FastifyRequest, result: SocialSessionResult): Promise<unknown>;
}

export async function registerSocialRoutes(app: FastifyInstance, deps: SocialRouteDependencies): Promise<void> {
  await app.register(rateLimit, { global: false,
    errorResponseBuilder: () => new AppError(429, '请求过于频繁，请稍后重试', 'rate_limit') });
  const options = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, bodyLimit: 16 * 1024 };
  const service = () => {
    if (!deps.service) throw new AppError(503, '第三方登录尚未配置或审核完成', 'social_unavailable');
    return deps.service;
  };
  app.get('/auth/social/providers', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const query = z.object({ platform: socialPlatformSchema, organization_code: z.string().trim().max(64).default('') }).strict().parse(req.query);
    reply.header('Cache-Control', 'no-store');
    return { providers: deps.service ? await deps.service.providers(query.organization_code, query.platform) : [] };
  });
  app.post('/auth/social/authorize', options, async (req, reply) => {
    const body = authorizeSchema.parse(req.body);
    reply.header('Cache-Control', 'no-store');
    return service().authorize({ provider: body.provider, platform: body.platform, organizationCode: body.organization_code,
      proofChallenge: body.proof_challenge, deviceId: body.device_id });
  });
  app.post('/auth/social/callback/:provider', options, async (req, reply) => {
    const provider = socialProviderSchema.parse((req.params as { provider: string }).provider);
    const body = z.object({ state: token, code: z.string().min(1).max(4096) }).strict().parse(req.body);
    reply.header('Cache-Control', 'no-store');
    return service().callback(provider, body.state, body.code);
  });
  app.post('/auth/social/exchange', options, async (req, reply) => {
    const body = exchangeSchema.parse(req.body);
    const result = await service().exchange(body.ticket, body.transaction_id, body.proof_verifier);
    reply.header('Cache-Control', 'no-store');
    return result.status === 'binding_required' ? result : deps.complete(req, result);
  });
  app.post('/auth/social/bind', options, async (req, reply) => {
    const body = bindingSchema.parse(req.body);
    const result = await service().bind(body.binding_ticket, body.transaction_id, body.proof_verifier, body.email, body.password);
    reply.header('Cache-Control', 'no-store');
    return deps.complete(req, result);
  });
  app.post('/auth/social/cancel', options, async req => {
    const body = z.object({ transaction_id: token }).strict().parse(req.body);
    await service().cancel(body.transaction_id);
    return { cancelled: true };
  });
}

export async function socialAuthRoutes(app: FastifyInstance): Promise<void> {
  // No provider is enabled before its official adapter, SDK and deployment configuration are verified.
  await registerSocialRoutes(app, { service: null, complete: async (request, result) => {
    const { prisma } = await import('../../plugins/db.js');
    const { socialRepository } = await import('./social-repository.js');
    const { completeSocialLoginSession } = await import('../auth/auth-session.js');
    await socialRepository.assertAccount(result.userId, result.installation);
    const user = await prisma.users.findUniqueOrThrow({ where: { id: result.userId } });
    return { ...await completeSocialLoginSession(request, user, { method: 'social', deviceId: result.deviceId,
      accountId: result.installation.organization.accountId, vdnId: result.installation.organization.vdnId,
      social: { organizationId: result.installation.organization.id, installationId: result.installation.id,
        revision: result.installation.revision, subjectId: result.subjectId } }), status: 'authenticated' };
  } });
}
