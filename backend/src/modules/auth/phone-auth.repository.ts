import { prisma } from '../../plugins/db.js';
import { AppError } from '../../shared/errors/index.js';
import { assertLiveBinding, confTenancyEnabled } from '../../shared/services/conf-tenancy.js';
import { isReservedSystemIdentity } from '../../shared/services/system-superuser.js';
import { database, rows } from '../access/access.db.js';
import { normalizeLoginPhone } from './phone-policy.js';
import type { PhoneAuthRepository, PhoneTarget } from './phone-auth.service.js';

const samePhone = (source: string | null, phone: string) => { try { return normalizeLoginPhone(source ?? '') === phone; } catch { return false; } };
async function canonicalMatches(vdnId: number, phone: string) {
  // One complete source statement keeps all candidates in the same read snapshot.
  // Filter in JS so SQL whitespace normalization cannot hide a canonical duplicate.
  const operators = await rows<{ id: number; mobile: string | null }>(await database(),
    "SELECT ID AS id, MobileTel AS mobile FROM t_user_users WHERE VDNID=? AND IsValid=1 AND COALESCE(IsSystem,0)=0 AND MobileTel IS NOT NULL AND TRIM(MobileTel)<>'' ORDER BY ID", [vdnId]);
  return operators.filter(operator => samePhone(operator.mobile, phone));
}
async function assertTarget(target: PhoneTarget, phone: string) {
  if (!confTenancyEnabled()) throw new AppError(403, '企业坐席映射未启用');
  const live = await assertLiveBinding(target.userId);
  if (live.map.account_id !== target.accountId || live.binding.vdn_id !== target.vdnId || live.binding.source_user_id !== target.operatorId) {
    throw new AppError(403, '手机号对应的坐席绑定已变更');
  }
  const matching = await canonicalMatches(target.vdnId, phone);
  if (matching.length !== 1 || Number(matching[0]!.id) !== target.operatorId) throw new AppError(403, '坐席手机号已变更、停用或存在歧义');
  const user = await prisma.users.findUnique({ where: { id: target.userId } });
  if (!user || isReservedSystemIdentity('', user)) throw new AppError(403, '坐席身份已失效');
  return user;
}
export const phoneAuthRepository: PhoneAuthRepository = {
  list: async phone => {
    if (!confTenancyEnabled()) return [];
    const maps = await prisma.conf_vdn_accounts.findMany({ where: { enabled: true }, orderBy: { vdn_id: 'asc' } });
    if (!maps.length) return [];
    const db = await database(), ids = maps.map(m => m.vdn_id), placeholders = ids.map(() => '?').join(',');
    // Read every active staff phone in one statement, preserving canonical uniqueness within each VDN.
    const operators = await rows<{ id: number; vdn_id: number; mobile: string | null }>(db,
      "SELECT ID AS id, VDNID AS vdn_id, MobileTel AS mobile FROM t_user_users WHERE VDNID IN (" + placeholders + ") AND IsValid=1 AND COALESCE(IsSystem,0)=0 AND MobileTel IS NOT NULL AND TRIM(MobileTel)<>'' ORDER BY VDNID, ID", ids);
    const matching = operators.filter(o => samePhone(o.mobile, phone));
    const names = await rows<{ id: number; name: string }>(db, 'SELECT ID AS id, Name AS name FROM t_icc_vdn WHERE ID IN (' + placeholders + ')', ids);
    const targets: PhoneTarget[] = [];
    for (const map of maps) {
      const seats = matching.filter(o => Number(o.vdn_id) === map.vdn_id);
      if (seats.length !== 1) continue;
      const operatorId = Number(seats[0]!.id);
      const binding = await prisma.conf_user_bindings.findUnique({ where: { vdn_id_source_user_id: { vdn_id: map.vdn_id, source_user_id: operatorId } } });
      if (!binding?.enabled) continue;
      const target = { userId: binding.user_id, accountId: map.account_id, vdnId: map.vdn_id, operatorId,
        name: names.find(n => Number(n.id) === map.vdn_id)?.name || 'VDN ' + map.vdn_id };
      try { await assertTarget(target, phone); targets.push(target); }
      catch (error) { if (!(error instanceof AppError && [403, 404, 409].includes(error.statusCode))) throw error; }
    }
    return targets;
  },
  validate: assertTarget,
};
