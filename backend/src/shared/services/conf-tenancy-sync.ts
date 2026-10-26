import crypto from 'node:crypto';
import { prisma } from '../../plugins/db.js';
import { AppError } from '../errors/index.js';
import { hashPassword } from '../utils/password.js';
import { assertBusinessEmailAvailable, isReservedSystemIdentity } from './system-superuser.js';
import { sourceVdn, sourceUser, managedUid } from './conf-tenancy.js';
import { database, rows } from '../../modules/access/access.db.js';

export type VdnSync = { action: 'upsert' | 'delete'; vdn_id: number; account_id?: number };
export type ManagedUserSync = { action: 'upsert' | 'delete'; vdn_id: number; source_user_id: number; work_no: string };
/** Trusted source lifecycle only; existing data is never silently rebound or erased. */
export async function syncVdn(payload: VdnSync) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(193655, 2)`;
    const source = await sourceVdn(payload.vdn_id);
    if (payload.action === 'upsert' && !source) throw new AppError(409, 'VDN 源记录不存在');
    if (payload.action === 'delete' && source) throw new AppError(409, 'VDN 尚未从 ConfManager 删除');
    const existing = await tx.conf_vdn_accounts.findUnique({ where: { vdn_id: payload.vdn_id } });
    if (payload.account_id && existing && payload.account_id !== existing.account_id) throw new AppError(409, 'VDN 不能重新映射其他 account');
    if (payload.action === 'delete') {
      if (!existing) return { deleted: false };
      await tx.conf_user_bindings.updateMany({ where: { vdn_id: payload.vdn_id }, data: { enabled: false } });
      await tx.conf_vdn_accounts.update({ where: { vdn_id: payload.vdn_id }, data: { enabled: false } });
      return { deleted: true, account_id: existing.account_id, preserved: true };
    }
    if (existing) {
      // Deleted mappings are tombstones. Reusing VDN IDs must be an explicit audited migration.
      if (!existing.enabled) throw new AppError(409, '已删除 VDN 映射禁止自动复活');
      await tx.accounts.update({ where: { id: existing.account_id }, data: { name: source!.name } });
      return { vdn_id: existing.vdn_id, account_id: existing.account_id };
    }
    let accountId = payload.account_id;
    if (accountId) {
      if (await tx.conf_vdn_accounts.findUnique({ where: { account_id: accountId } })) throw new AppError(409, 'account 已绑定其他 VDN');
      if (!await tx.accounts.findUnique({ where: { id: accountId } })) throw new AppError(409, 'account 不存在');
    } else {
      const account = await tx.accounts.create({ data: { name: source!.name } }); accountId = account.id;
    }
    return tx.conf_vdn_accounts.create({ data: { vdn_id: payload.vdn_id, account_id: accountId } });
  }, { maxWait: 10000, timeout: 30000 });
}
export async function syncManagedUser(payload: ManagedUserSync) {
  if (isReservedSystemIdentity(payload.work_no)) throw new AppError(409, '业务同步不能管理系统超级用户');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(193655, 2)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(193655, 1)`;
    const source = await sourceUser(payload.vdn_id, payload.source_user_id);
    if (payload.action === 'upsert' && (!source || source.work_no !== payload.work_no)) throw new AppError(409, '业务用户源记录不存在或已变更');
    if (payload.action === 'delete' && source) throw new AppError(409, '用户尚未从 ConfManager 删除');
    // Read current credentials from the authoritative source. Never persist/replay a raw password in a queue.
    const [credentials] = source ? await rows<{ password: string }>(await database(),
      'SELECT PassWord AS password FROM t_user_users WHERE ID = ? AND VDNID = ?', [payload.source_user_id, payload.vdn_id]) : [];
    const password = credentials?.password;
    if (source && (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72)) throw new AppError(422, '源密码为空或超过 bcrypt 72 字节限制');
    const encrypted = source ? await hashPassword(password!) : undefined;
    const email = source?.email?.trim().toLowerCase() || null;
    if (email) await assertBusinessEmailAvailable(email);
    const map = await tx.conf_vdn_accounts.findUnique({ where: { vdn_id: payload.vdn_id } });
    if (!map?.enabled) throw new AppError(409, 'VDN 尚未映射或已停用');
    const binding = await tx.conf_user_bindings.findUnique({ where: { vdn_id_source_user_id: { vdn_id: payload.vdn_id, source_user_id: payload.source_user_id } } });
    if (payload.action === 'delete') {
      if (!binding) return { deleted: false };
      await tx.conf_user_bindings.update({ where: { id: binding.id }, data: { enabled: false } });
      await tx.account_users.deleteMany({ where: { user_id: binding.user_id, account_id: map.account_id } });
      return { deleted: true, user_removed: false, user_id: binding.user_id };
    }
    const conflict = email ? await tx.users.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, ...(binding ? { id: { not: binding.user_id } } : {}) } }) : null;
    if (conflict) throw new AppError(409, '邮箱已有其他身份，请为各 VDN 使用不同登录邮箱');
    const enabled = Number(source!.enabled) === 1;
    const data = { uid: managedUid(payload.vdn_id, payload.source_user_id, source!.work_no), name: source!.name, email, encrypted_password: encrypted!, confirmed_at: new Date() };
    if (binding) {
      const user = await tx.users.findUnique({ where: { id: binding.user_id } });
      if (!user || isReservedSystemIdentity(user.uid ?? '', user)) throw new AppError(409, '业务绑定无效');
    }
    const user = binding ? await tx.users.update({ where: { id: binding.user_id }, data })
      : await tx.users.create({ data: { ...data, provider: 'email', pubsub_token: crypto.randomBytes(16).toString('hex') } });
    await tx.conf_user_bindings.upsert({
      where: { vdn_id_source_user_id: { vdn_id: payload.vdn_id, source_user_id: payload.source_user_id } },
      create: { vdn_id: payload.vdn_id, source_user_id: payload.source_user_id, user_id: user.id, work_no: source!.work_no, enabled },
      update: { work_no: source!.work_no, enabled },
    });
    if (enabled) await tx.account_users.upsert({ where: { account_id_user_id: { account_id: map.account_id, user_id: user.id } },
      create: { account_id: map.account_id, user_id: user.id, role: 1, availability: 1 }, update: { role: 1 } });
    else await tx.account_users.deleteMany({ where: { account_id: map.account_id, user_id: user.id } });
    return { upserted: true, user_id: user.id, account_id: map.account_id, enabled, email };
  }, { maxWait: 10000, timeout: 30000 });
}
