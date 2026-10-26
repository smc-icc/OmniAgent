import { confTenancyEnabled, managedContext } from '../../shared/services/conf-tenancy.js';
import type { FastifyRequest } from 'fastify';
import { isSystemSuperuser } from '../../shared/services/system-superuser.js';
import { env } from '../../config/env.js';
import { prisma } from '../../plugins/db.js';
import { AppError } from '../../shared/errors/index.js';
import { resolveCcsWorkNo } from '../../integrations/ccs/ccs-workno.js';
import { database, rows, type Db } from './access.db.js';
import { OMNI_SUBSYSTEM, omniPermissions, type PermissionCode } from './access.policy.js';
import { permissionCatalog, type DataScope } from './access.catalog.js';

export interface AccessContext { userId: number; accountId: number; vdnId: number; agentId: number; administrator: boolean; systemSuperuser?: boolean }
export async function context(req: FastifyRequest): Promise<AccessContext> {
  if (!req.currentUser) throw new AppError(401, '请先登录');
  if (confTenancyEnabled()) return managedContext(req);
  // This Omni deployment serves one configured account/VDN. Never trust a client-supplied VDN.
  const accountId = Number(process.env.OMNI_ACCESS_ACCOUNT_ID || 1);
  const vdnId = env.OMNI_AGENT_VDN_ID;
  const membership = await prisma.account_users.findFirst({ where: { account_id: accountId, user_id: req.currentUser.id } });
  if (!membership) throw new AppError(403, '不属于当前坐席租户');
  const db = await database();
  const agents = await rows<{ id: number; enabled: number }>(db,
    'SELECT ID AS id, IsValid AS enabled FROM t_user_users WHERE WorkNO = ? AND VDNID = ?', [resolveCcsWorkNo({ ...req.currentUser, uid: req.currentUser.uid ?? null }, env.CCS_WORK_NO_FIELD), vdnId]);
  if (agents.length > 1) throw new AppError(409, 'ICC 工号配置重复，请联系管理员');
  const agent = agents[0];
  if (agent && !agent.enabled) throw new AppError(403, '该操作员已停用');
  if (!agent && membership.role !== 0) throw new AppError(403, '未关联当前 VDN 的操作员');
  return { userId: req.currentUser.id, accountId, vdnId, agentId: Number(agent?.id ?? 0), administrator: membership.role === 0, systemSuperuser: isSystemSuperuser(req.currentUser) };
}

export async function effectivePermissions(db: Db, vdnId: number, agentId: number) {
  return rows<{ id: number; name: string; value: number; subsystem: number; source: string; owner_id: number; data_scope: DataScope | null }>(db, `
    SELECT DISTINCT p.ID AS id, p.Name AS name, p.Value AS value, p.SubSystemType AS subsystem,
      CASE g.OwnerType WHEN 1 THEN 'role' WHEN 2 THEN 'department' ELSE 'direct' END AS source, g.OwnerId AS owner_id, s.ScopeType AS data_scope
    FROM t_user_grantpower g JOIN t_user_power p ON p.ID = g.PowerId
    LEFT JOIN t_omni_access_scope s ON s.VDNID = g.VDNID AND s.OwnerType = g.OwnerType AND s.OwnerId = g.OwnerId AND s.PowerId = g.PowerId
    WHERE g.IsOwn = 1 AND (g.VDNID = ? OR (? = 1 AND g.VDNID <= 0)) AND (
      (g.OwnerType = 3 AND g.OwnerId = ?) OR
      (g.OwnerType = 1 AND EXISTS (SELECT 1 FROM t_user_usertorole r WHERE r.RoleID = g.OwnerId AND r.UserID = ? AND (r.VDNID = ? OR (? = 1 AND r.VDNID <= 0)))) OR
      (g.OwnerType = 2 AND EXISTS (SELECT 1 FROM t_user_usertodepart d WHERE d.departid = g.OwnerId AND d.UserID = ? AND d.VDNID = ?)))`,
  [vdnId, vdnId, agentId, agentId, vdnId, vdnId, agentId, vdnId]);
}

export async function getAccess(req: FastifyRequest) {
  const ctx = await context(req);
  const grants = await effectivePermissions(await database(), ctx.vdnId, ctx.agentId);
  const codes = omniPermissions.filter(p => (ctx.administrator && !p.code.startsWith('extension.')) || (ctx.systemSuperuser && ['extension.assign', 'extension.approve'].includes(p.code)) || grants.some(g => g.subsystem === OMNI_SUBSYSTEM && g.value === p.value)).map(p => p.code);
  const scopes: Record<string, DataScope[]> = {};
  for (const p of omniPermissions) {
    if (!codes.includes(p.code)) continue;
    const def = permissionCatalog.find(x => x.code === p.code);
    scopes[p.code] = ctx.administrator ? ['account'] : [...new Set(grants.filter(g => g.subsystem === OMNI_SUBSYSTEM && g.value === p.value)
      .map(g => g.data_scope ?? (def?.scopes.includes('self') ? 'self' : 'account')))];
  }
  return { ...ctx, permissions: codes, scopes };
}
export async function requirePermission(req: FastifyRequest, code: PermissionCode) {
  const access = await getAccess(req);
  if (!access.permissions.includes(code)) throw new AppError(403, '没有此功能的操作权限');
  return access;
}
