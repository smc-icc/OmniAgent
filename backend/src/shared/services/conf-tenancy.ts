import type { FastifyRequest } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { AppError } from '../errors/index.js';
import { database, rows } from '../../modules/access/access.db.js';
import { isSystemSuperuser } from './system-superuser.js';

/** Activate only after the mapping migration and explicit reconciliation. No legacy fallback. */
export const confTenancyEnabled = () => process.env.CONF_TENANCY_ENABLED === '1';
export function managedUid(vdn: number, source: number, workNo: string) {
  return `conf-vdn:${vdn}:${source}:${encodeURIComponent(workNo)}`;
}
export function managedIdentity(uid: string | null | undefined) {
  const m = /^conf-vdn:([1-9]\d*):([1-9]\d*):(.+)$/.exec(uid ?? '');
  if (!m) return null;
  try { return { vdnId: Number(m[1]), sourceId: Number(m[2]), workNo: decodeURIComponent(m[3]) }; }
  catch { return null; }
}
export async function sourceVdn(vdnId: number) {
  return (await rows<{ id: number; name: string }>(await database(),
    'SELECT ID AS id, Name AS name FROM t_icc_vdn WHERE ID = ?', [vdnId]))[0];
}
export async function sourceUser(vdnId: number, sourceId: number) {
  return (await rows<{ id: number; work_no: string; name: string; email: string | null; enabled: number }>(await database(),
    'SELECT ID AS id, WorkNO AS work_no, Name AS name, Email AS email, IsValid AS enabled FROM t_user_users WHERE ID = ? AND VDNID = ?', [sourceId, vdnId]))[0];
}
export async function assertLiveBinding(userId: number) {
  const binding = await prisma.conf_user_bindings.findUnique({ where: { user_id: userId } });
  if (!binding?.enabled) throw new AppError(403, '业务身份未绑定或已停用');
  const [map, user] = await Promise.all([
    prisma.conf_vdn_accounts.findUnique({ where: { vdn_id: binding.vdn_id } }),
    sourceUser(binding.vdn_id, binding.source_user_id),
  ]);
  if (!map?.enabled || !await sourceVdn(binding.vdn_id) || !user || Number(user.enabled) !== 1 || user.work_no !== binding.work_no) {
    throw new AppError(403, 'VDN 或操作员已停用、删除或映射已失效');
  }
  const member = await prisma.account_users.findFirst({ where: { account_id: map.account_id, user_id: userId } });
  if (!member) throw new AppError(403, '不属于当前租户');
  return { binding, map, user };
}
const positive = (v: unknown): number => {
  if (typeof v !== 'number' && typeof v !== 'string') throw new AppError(400, '租户参数无效');
  if (!/^[1-9]\d*$/.test(String(v))) throw new AppError(400, '租户参数无效');
  const n = Number(v); if (!Number.isSafeInteger(n)) throw new AppError(400, '租户参数无效');
  return n;
};
/** Selectors choose a tenant, never grant access. All aliases must agree with the mapping. */
export function tenantSelectors(req: FastifyRequest) {
  const p = req.params as Record<string, unknown> | undefined;
  const q = req.query as Record<string, unknown> | undefined;
  const b = req.body as Record<string, unknown> | undefined;
  const accountValues = [p?.account_id, /\/accounts\/:id(?:\/|$)/.test(req.routeOptions?.url ?? '') ? p?.id : undefined,
    q?.account_id, q?.accountId, b?.account_id, b?.accountId, req.headers?.['x-account-id']].filter(v => v != null);
  const vdnValues = [p?.vdn_id, p?.vdnId, q?.vdn_id, q?.vdnId, q?.VDNID, b?.vdn_id, b?.vdnId, b?.VDNID, req.headers?.['x-vdn-id']].filter(v => v != null);
  const accounts = accountValues.map(positive), vdns = vdnValues.map(positive);
  if (new Set(accounts).size > 1 || new Set(vdns).size > 1) throw new AppError(403, '租户参数不一致');
  return { accountId: accounts[0], vdnId: vdns[0] };
}
export async function managedContext(req: FastifyRequest) {
  const current = req.currentUser;
  if (!current) throw new AppError(401, '请先登录');
  const selected = tenantSelectors(req);
  const superuser = isSystemSuperuser(current);
  const live = superuser ? null : await assertLiveBinding(current.id);
  const map = selected.accountId ? await prisma.conf_vdn_accounts.findUnique({ where: { account_id: selected.accountId } })
    : selected.vdnId ? await prisma.conf_vdn_accounts.findUnique({ where: { vdn_id: selected.vdnId } })
    : live?.map ?? await prisma.conf_vdn_accounts.findFirst({ where: { enabled: true }, orderBy: { vdn_id: 'asc' } });
  if (!map?.enabled || (selected.vdnId != null && selected.vdnId !== map.vdn_id) || !await sourceVdn(map.vdn_id)) throw new AppError(403, 'VDN 映射不存在或已停用');
  if (!superuser && live?.map.account_id !== map.account_id) throw new AppError(403, '没有此 VDN 的成员授权');
  const account = await prisma.accounts.findUnique({ where: { id: map.account_id }, select: { id: true, name: true } });
  if (!account) throw new AppError(403, '租户不存在');
  req.currentAccount = account;
  return { userId: current.id, accountId: map.account_id, vdnId: map.vdn_id,
    agentId: live ? Number(live.user.id) : 0, administrator: superuser, systemSuperuser: superuser };
}
export async function listManagedTenants(req: FastifyRequest) {
  if (!confTenancyEnabled()) throw new AppError(409, '尚未启用 ConfManager 租户联动');
  if (!req.currentUser) throw new AppError(401, '请先登录');
  const maps = isSystemSuperuser(req.currentUser)
    ? await prisma.conf_vdn_accounts.findMany({ where: { enabled: true }, orderBy: { vdn_id: 'asc' } })
    : [(await assertLiveBinding(req.currentUser.id)).map];
  const tenants = [];
  for (const map of maps) {
    const source = await sourceVdn(map.vdn_id);
    if (source) tenants.push({ vdn_id: map.vdn_id, account_id: map.account_id, name: source.name });
  }
  return { system_superuser: isSystemSuperuser(req.currentUser), tenants };
}

/** Background/callback work derives VDN from persisted account, never the process default. */
export async function vdnForConversation(conversationId: number, legacyDefault: number) {
  if (!confTenancyEnabled()) return legacyDefault;
  const conv = await prisma.conversations.findUnique({ where: { id: conversationId }, select: { account_id: true } });
  if (!conv?.account_id) throw new AppError(403, '会话租户不存在');
  const map = await prisma.conf_vdn_accounts.findUnique({ where: { account_id: conv.account_id } });
  if (!map?.enabled || !await sourceVdn(map.vdn_id)) throw new AppError(403, '会话 VDN 已失效');
  return map.vdn_id;
}
