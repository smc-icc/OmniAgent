import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../shared/errors/index.js';
import { env } from '../../config/env.js';
import type { AuthenticatedUser } from './auth-session.js';
import { PhoneAuthService, type PhoneTarget } from './phone-auth.service.js';

const requestSchema = z.object({ phone: z.string().trim().min(7).max(50),
  device_id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/) }).strict();
const signInSchema = requestSchema.extend({ request_id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict();
const selectSchema = requestSchema.extend({ selection_ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), vdn_id: z.number().int().positive().max(2147483647) }).strict();
interface Dependencies { service: PhoneAuthService; complete(request: FastifyRequest, user: AuthenticatedUser, target: PhoneTarget, deviceId: string): Promise<unknown> }
export async function registerPhoneAuthRoutes(app: FastifyInstance, deps: Dependencies) {
  const noStore = async (_req: FastifyRequest, reply: import('fastify').FastifyReply) => { reply.header('Cache-Control', 'no-store'); };
  const opts = { preHandler: [noStore] };
  app.get('/auth/phone/capabilities', opts, () => deps.service.capabilities());
  app.post('/auth/phone/request', opts, request => deps.service.request(requestSchema.parse(request.body), request.ip));
  app.post('/auth/phone/sign_in', opts, async request => {
    const body = signInSchema.parse(request.body), result = await deps.service.signIn(body, request.ip);
    return result.status === 'authenticated' ? deps.complete(request, result.user, result.target, body.device_id) : result;
  });
  app.post('/auth/phone/select_vdn', opts, async request => {
    const body = selectSchema.parse(request.body), result = await deps.service.select(body, request.ip);
    return deps.complete(request, result.user, result.target, body.device_id);
  });
  app.addHook('onClose', async () => { await deps.service.drainDeliveries(); });
}
export async function phoneAuthRoutes(app: FastifyInstance) {
  const { phoneAuthRepository } = await import('./phone-auth.repository.js');
  const { phoneDelivery } = await import('./phone-auth.delivery.js');
  const { redisPhoneChallengeStore } = await import('./phone-auth.store.js');
  const master = crypto.createHmac('sha256', env.JWT_SECRET).update('omni.sms-login.master.v1').digest();
  const delivery = phoneDelivery(challengeId => { app.log.warn({ challengeId }, 'SMS verification delivery failed'); });
  const service = new PhoneAuthService(redisPhoneChallengeStore(app.redis), phoneAuthRepository, delivery, master);
  await registerPhoneAuthRoutes(app, { service, complete: completePhoneLoginSession });
}
export async function completePhoneLoginSession(request: FastifyRequest, user: AuthenticatedUser, target: PhoneTarget, deviceId: string) {
  const { prisma } = await import('../../plugins/db.js');
  const { completeIdentityLoginSession } = await import('./auth-session.js');
  const previous = await prisma.users.findUnique({ where: { id: user.id } });
  if (!previous) throw new AppError(401, '坐席账号已失效');
  await prisma.users.update({ where: { id: user.id }, data: { sign_in_count: { increment: 1 }, current_sign_in_at: new Date(),
    last_sign_in_at: previous.current_sign_in_at, current_sign_in_ip: request.ip, last_sign_in_ip: previous.current_sign_in_ip } });
  return { ...await completeIdentityLoginSession(request, user, { method: 'sms', deviceId, accountId: target.accountId, vdnId: target.vdnId }), status: 'authenticated' };
}
