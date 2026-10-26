/** System identity is provisioned ONLY by the ConfManager bootstrap/password flow. */
import crypto from 'node:crypto';
import { AppError } from '../errors/index.js';
import { prisma } from '../../plugins/db.js';
import { hashPassword } from '../utils/password.js';

export const SYSTEM_SUPERUSER_UID = 'conf-system:admin';
export const SYSTEM_SUPERUSER_TYPE = 'SuperAdmin';
export function isSystemSuperuser(user: { uid?: string | null; type?: string | null } | null | undefined) {
  return user?.uid === SYSTEM_SUPERUSER_UID && user?.type === SYSTEM_SUPERUSER_TYPE;
}
export function isReservedSystemIdentity(workNo: string, user?: { uid?: string | null; type?: string | null } | null) {
  return workNo === SYSTEM_SUPERUSER_UID || user?.type === SYSTEM_SUPERUSER_TYPE || user?.uid === SYSTEM_SUPERUSER_UID;
}

export async function assertBusinessManagedUser(userId: number) {
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { uid: true, type: true } });
  if (process.env.CONF_TENANCY_ENABLED === '1' && user?.uid?.startsWith('conf-vdn:')) throw new AppError(403, 'ConfManager 业务身份只能通过源配置维护');
  if (user && isReservedSystemIdentity('', user)) throw new AppError(403, '系统超级用户只能通过 ConfManager 初始化及改密流程维护');
}

/** Ordinary-user entrypoints must not reuse the singleton login email. */
export async function assertBusinessEmailAvailable(email: string | null | undefined) {
  if (!email) return;
  const reserved = await prisma.users.findFirst({ where: {
    email: { equals: email.trim().toLowerCase(), mode: 'insensitive' },
    OR: [{ uid: SYSTEM_SUPERUSER_UID }, { type: SYSTEM_SUPERUSER_TYPE }],
  }, select: { id: true } });
  if (reserved) throw new AppError(403, '系统超级用户邮箱不能由业务账号使用');
}

export async function syncSystemSuperuser(payload: { uid: 'admin'; email: string; password: string; account_id: number }) {
  if (payload.uid !== 'admin' || !payload.password || Buffer.byteLength(payload.password, 'utf8') > 72 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw new Error('Invalid system superuser payload');
  }
  const email = payload.email.trim().toLowerCase();
  const encrypted = await hashPassword(payload.password);
  return prisma.$transaction(async tx => {
    // Serializes bootstrap and password updates. A partial UNIQUE index is the final DB backstop.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(193655, 1)`;
    const account = await tx.accounts.findUnique({ where: { id: payload.account_id }, select: { id: true } });
    if (!account) throw new Error('Target Omni account does not exist');
    const candidates = await tx.users.findMany({ where: { OR: [
      { uid: SYSTEM_SUPERUSER_UID }, { type: SYSTEM_SUPERUSER_TYPE }, { email: { equals: email, mode: 'insensitive' } },
    ] } });
    if (candidates.length > 1 || (candidates[0] && !isSystemSuperuser(candidates[0]))) {
      throw new Error('System identity conflict; existing users will not be adopted or overwritten');
    }
    const data = { email, encrypted_password: encrypted, confirmed_at: new Date(),
      reset_password_token: null, reset_password_sent_at: null };
    const user = candidates[0]
      ? await tx.users.update({ where: { id: candidates[0].id }, data })
      : await tx.users.create({ data: { ...data, uid: SYSTEM_SUPERUSER_UID, type: SYSTEM_SUPERUSER_TYPE,
          name: 'System administrator', provider: 'email', pubsub_token: crypto.randomBytes(16).toString('hex') } });
    const membership = await tx.account_users.findFirst({ where: { account_id: account.id, user_id: user.id } });
    if (membership) await tx.account_users.update({ where: { id: membership.id }, data: { role: 0 } });
    else await tx.account_users.create({ data: { account_id: account.id, user_id: user.id, role: 0,
      availability: 1, auto_offline: true } });
    return { user_id: user.id, email: user.email, system_superuser: true };
  });
}
