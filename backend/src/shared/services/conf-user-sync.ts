/**
 * ConfServer → OmniAgent 坐席账号同步。
 *
 * 约定（CCS 为权威，Omni 为投影）：
 * - uid = ICC WorkNO（配合 CCS_WORK_NO_FIELD=uid）
 * - email = 配置台 Email；没有则留空
 * - password = ICC PassWord 明文；Omni 侧 bcrypt。upsert 未带 password 则保留原密码
 * - 匹配优先：previous_work_no → uid=work_no → email
 */
import crypto from 'crypto';
import { assertBusinessEmailAvailable, isReservedSystemIdentity } from './system-superuser.js';
import { prisma } from '../../plugins/db.js';
import { hashPassword } from '../utils/password.js';
import { resolveSyncEmail } from './conf-user-sync-email.js';

export { resolveSyncEmail } from './conf-user-sync-email.js';

export type ConfUserSyncPayload = {
  action: 'upsert' | 'delete';
  account_id?: number;
  work_no: string;
  previous_work_no?: string | null;
  name?: string | null;
  email?: string | null;
  password?: string | null;
  role?: 'administrator' | 'agent';
};

function normalizeWorkNo(v: string | null | undefined): string {
  return String(v ?? '').trim();
}

async function findUser(workNo: string, previousWorkNo?: string | null, email?: string | null) {
  const prev = normalizeWorkNo(previousWorkNo);
  if (prev) {
    const byPrev = await prisma.users.findFirst({ where: { uid: prev } });
    if (byPrev) return byPrev;
  }
  const byUid = await prisma.users.findFirst({ where: { uid: workNo } });
  if (byUid) return byUid;
  const resolvedEmail = resolveSyncEmail(workNo, email);
  if (!resolvedEmail) return null;
  return prisma.users.findFirst({ where: { email: resolvedEmail } });
}

async function ensureAccountUser(
  accountId: number,
  userId: number,
  role: 'administrator' | 'agent',
) {
  const roleNum = role === 'administrator' ? 0 : 1;
  const existing = await prisma.account_users.findFirst({
    where: { account_id: accountId, user_id: userId },
  });
  if (existing) {
    if (existing.role !== roleNum) {
      await prisma.account_users.update({
        where: { id: existing.id },
        data: { role: roleNum },
      });
    }
    return existing.id;
  }
  await syncSerial('account_users');
  const created = await prisma.account_users.create({
    data: {
      account_id: accountId,
      user_id: userId,
      role: roleNum,
      availability: 1,
      auto_offline: true,
    },
  });
  return created.id;
}

/** seed 手工插 id 后序列落后，创建会撞 Unique(id)；对齐一次再写。 */
async function syncSerial(table: 'users' | 'account_users') {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
  );
}

export async function applyConfUserSync(payload: ConfUserSyncPayload) {
  if (process.env.CONF_TENANCY_ENABLED === '1') throw new Error('Legacy user sync disabled; VDN/source identity required');
  const workNo = normalizeWorkNo(payload.work_no);
  if (!workNo) throw new Error('work_no required');
  if (isReservedSystemIdentity(workNo) || isReservedSystemIdentity(normalizeWorkNo(payload.previous_work_no))) {
    throw new Error('System superuser cannot be managed by business user sync');
  }

  const accountId = payload.account_id && payload.account_id > 0 ? payload.account_id : 1;
  const role = payload.role === 'administrator' ? 'administrator' : 'agent';

  if (payload.action === 'delete') {
    const user = await findUser(workNo, payload.previous_work_no, payload.email);
    if (isReservedSystemIdentity(workNo, user)) throw new Error('System superuser cannot be deleted by business user sync');
    if (!user) {
      return { deleted: false, work_no: workNo, reason: 'not_found' };
    }
    await prisma.account_users.deleteMany({
      where: { account_id: accountId, user_id: user.id },
    });
    const remaining = await prisma.account_users.count({ where: { user_id: user.id } });
    if (remaining === 0) {
      await prisma.users.delete({ where: { id: user.id } });
      return { deleted: true, user_removed: true, work_no: workNo, user_id: user.id };
    }
    return { deleted: true, user_removed: false, work_no: workNo, user_id: user.id };
  }

  const email = resolveSyncEmail(workNo, payload.email);
  if (email) await assertBusinessEmailAvailable(email);
  const name = String(payload.name ?? '').trim() || workNo;
  const password = payload.password != null ? String(payload.password) : '';

  let user = await findUser(workNo, payload.previous_work_no, email);
  if (isReservedSystemIdentity(workNo, user)) throw new Error('System superuser cannot be overwritten by business user sync');
  if (!user) {
    if (!password) throw new Error('password required when creating Omni user');
    await syncSerial('users');
    user = await prisma.users.create({
      data: {
        name,
        email,
        uid: workNo,
        encrypted_password: await hashPassword(password),
        provider: 'email',
        pubsub_token: crypto.randomBytes(16).toString('hex'),
        confirmed_at: new Date(),
      },
    });
  } else {
    const data: {
      name: string;
      email: string | null;
      uid: string;
      encrypted_password?: string;
      confirmed_at?: Date | null;
    } = {
      name,
      email,
      uid: workNo,
    };
    if (password) {
      data.encrypted_password = await hashPassword(password);
    }
    if (!user.confirmed_at) {
      data.confirmed_at = new Date();
    }
    user = await prisma.users.update({
      where: { id: user.id },
      data,
    });
  }

  const accountUserId = await ensureAccountUser(accountId, user.id, role);
  return {
    upserted: true,
    user_id: user.id,
    account_user_id: accountUserId,
    work_no: workNo,
    email,
    uid: user.uid,
  };
}
