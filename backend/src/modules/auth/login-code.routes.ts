import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../shared/errors/index.js';
import type { AuthenticatedUser } from './auth-session.js';
import type { LoginCodeManager, LoginCodeRecord } from './login-code.service.js';
import { LoginCodeService } from './login-code.service.js';

const operatorId = z.coerce.number().int().positive();
const signIn = z.object({ code: z.string().trim().min(1).max(80), device_id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/) }).strict();
interface Dependencies {
  service: LoginCodeService | null;
  manager(request: FastifyRequest): Promise<LoginCodeManager>;
  complete(request: FastifyRequest, user: AuthenticatedUser, receipt: LoginCodeRecord, deviceId: string): Promise<unknown>;
}
export async function registerLoginCodeRoutes(app: FastifyInstance, deps: Dependencies) {
  const available = () => {
    if (!deps.service) throw new AppError(503, '授权码登录暂不可用，请使用账号密码登录', 'login_code_unavailable');
    return deps.service;
  };
  const noStore = async (_req: FastifyRequest, reply: import('fastify').FastifyReply) => { reply.header('Cache-Control', 'no-store'); };
  const auth = { preHandler: [noStore, app.authenticate] };
  app.get('/auth/login-code/capabilities', { preHandler: [noStore] }, async () => ({ ready: !!deps.service, lifetime_seconds: 900 }));
  app.post('/auth/login-code/sign_in', { preHandler: [noStore] }, async request => {
    const body = signIn.parse(request.body);
    const result = await available().redeem(body.code, request.ip);
    return deps.complete(request, result.user, result.receipt, body.device_id);
  });
  app.get('/api/access/users/:id/login-codes', auth, async request => {
    const manager = await deps.manager(request);
    const id = operatorId.parse((request.params as { id: string }).id);
    return { codes: await available().list(manager, id) };
  });
  app.post('/api/access/users/:id/login-codes', auth, async request => {
    const manager = await deps.manager(request);
    const id = operatorId.parse((request.params as { id: string }).id);
    z.object({}).strict().parse(request.body ?? {});
    return available().issue(manager, id);
  });
  app.delete('/api/access/users/:id/login-codes/:codeId', auth, async request => {
    const manager = await deps.manager(request);
    const params = request.params as { id: string; codeId: string };
    return available().revoke(manager, operatorId.parse(params.id), z.string().uuid().parse(params.codeId));
  });
}
export async function loginCodeRoutes(app: FastifyInstance) {
  const { confTenancyEnabled } = await import('../../shared/services/conf-tenancy.js');
  const { redisLoginCodeStore } = await import('./login-code.store.js');
  const { loginCodeRepository, requireLoginCodeManager } = await import('./login-code.repository.js');
  const { completeIdentityLoginSession } = await import('./auth-session.js');
  await registerLoginCodeRoutes(app, {
    service: confTenancyEnabled() && process.env.OMNI_LOGIN_CODE_ENABLED !== '0' ? new LoginCodeService(redisLoginCodeStore(app.redis), loginCodeRepository) : null,
    manager: requireLoginCodeManager,
    complete: async (request, user, receipt, deviceId) => {
      await prismaSignInStatistics(user.id, request.ip);
      const session = await completeIdentityLoginSession(request, user, { deviceId, method: 'authorization_code', accountId: receipt.accountId, vdnId: receipt.vdnId });
      request.log.info({ userId: user.id, issuerId: receipt.issuerId, accountId: receipt.accountId, vdnId: receipt.vdnId }, 'VDN login code redeemed');
      return { ...session, status: 'authenticated' };
    },
  });
}
async function prismaSignInStatistics(userId: number, ip: string) {
  const { prisma } = await import('../../plugins/db.js');
  const user = await prisma.users.findUniqueOrThrow({ where: { id: userId } });
  await prisma.users.update({ where: { id: userId }, data: { sign_in_count: { increment: 1 }, current_sign_in_at: new Date(),
    last_sign_in_at: user.current_sign_in_at, current_sign_in_ip: ip, last_sign_in_ip: user.current_sign_in_ip } });
}
