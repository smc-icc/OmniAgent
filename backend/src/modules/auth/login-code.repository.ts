import type { FastifyRequest } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { AppError } from '../../shared/errors/index.js';
import { assertLiveBinding, confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import { isSystemSuperuser } from '../../shared/services/system-superuser.js';
import { requirePermission } from '../access/access.context.js';
import { database } from '../access/access.db.js';
import { requireUser } from '../access/access.users.js';
import type { LoginCodeManager, LoginCodeRepository } from './login-code.service.js';

async function operator(manager: LoginCodeManager, id: number) {
  if (!confTenancyEnabled()) throw new AppError(503, '授权码登录需要已启用的 VDN 账号映射');
  return requireUser(await database(), manager.vdnId, id);
}
export async function requireLoginCodeManager(request: FastifyRequest) {
  const manager = await requirePermission(request, 'access.manage');
  if (manager.systemSuperuser || !Number.isSafeInteger(manager.agentId) || manager.agentId <= 0) {
    throw new AppError(403, '仅限当前 VDN 的业务管理员签发和管理登录授权码');
  }
  return manager;
}
export const loginCodeRepository: LoginCodeRepository = {
  assertOperator: async (manager, id) => { await operator(manager, id); },
  target: async (manager, id) => {
    const source = await operator(manager, id);
    if (Number(source.enabled) !== 1) throw new AppError(403, '不能为已停用的操作员签发授权码');
    const binding = await prisma.conf_user_bindings.findUnique({ where: { vdn_id_source_user_id: { vdn_id: manager.vdnId, source_user_id: id } } });
    if (!binding?.enabled) throw new AppError(409, '坐席尚未关联有效的全媒体账号，请先同步');
    const live = await assertLiveBinding(binding.user_id);
    if (live.map.account_id !== manager.accountId || live.binding.vdn_id !== manager.vdnId || live.binding.source_user_id !== id) {
      throw new AppError(403, '坐席不属于当前租户或 VDN');
    }
    return { userId: binding.user_id, accountId: manager.accountId, vdnId: manager.vdnId, operatorId: id };
  },
  validate: async record => {
    // Authorization changes after issue must also invalidate an unused code.
    const issuer = await prisma.users.findUnique({ where: { id: record.issuerId } });
    if (!issuer) throw new AppError(403, '签发管理员已失效');
    const issuerRequest = { currentUser: { ...issuer, accounts: [] }, headers: { 'x-account-id': String(record.accountId), 'x-vdn-id': String(record.vdnId) } } as unknown as FastifyRequest;
    const manager = await requireLoginCodeManager(issuerRequest);
    if (manager.accountId !== record.accountId || manager.vdnId !== record.vdnId) throw new AppError(403, '管理员 VDN 已失效');
    const target = await loginCodeRepository.target(manager, record.operatorId);
    if (target.userId !== record.userId) throw new AppError(403, '授权码对应的坐席身份已变更');
    const user = await prisma.users.findUnique({ where: { id: target.userId } });
    if (!user || isSystemSuperuser(user)) throw new AppError(403, '授权码对应的坐席账号已失效');
    return user;
  },
};
