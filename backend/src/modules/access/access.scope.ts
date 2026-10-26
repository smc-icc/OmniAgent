import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../../shared/errors/index.js';
import type { DataScope } from './access.catalog.js';
import type { AccessContext } from './access.context.js';
import { database, rows } from './access.db.js';
import { resolveCcsWorkNo } from '../../integrations/ccs/ccs-workno.js';
import { env } from '../../config/env.js';
import { announcementVisibility } from '../announcements/announcements.policy.js';

export interface ScopeContext extends AccessContext {
  permission: string; scopes: DataScope[]; all: boolean; userIds: number[]; agentIds: number[]; workNos: string[];
}
export const accessScope = new AsyncLocalStorage<ScopeContext>();
/** Request-scoped VDN always wins over environment/client defaults. */
export function activeVdn(fallback: number) { return accessScope.getStore()?.vdnId ?? fallback; }
export async function resolveScope(ctx: AccessContext, permission: string, scopes: DataScope[], users: { id: number; email: string | null; name: string | null; uid: string | null; custom_attributes: unknown }[]): Promise<ScopeContext> {
  const all = scopes.includes('account');
  let agents: { id: number; work_no: string }[] = [];
  if (!all && ctx.agentId) {
    const db = await database();
    agents = await rows(db, `SELECT DISTINCT u.ID AS id, u.WorkNO AS work_no FROM t_user_users u WHERE u.VDNID = ? AND u.IsValid = 1 AND (
      u.ID = ? OR (? = 1 AND EXISTS (SELECT 1 FROM t_user_usertogroup a JOIN t_user_usertogroup b ON a.GroupID = b.GroupID
        WHERE a.UserID = ? AND b.UserID = u.ID AND a.VDNID = ? AND b.VDNID = ?)) OR
      (? = 1 AND EXISTS (SELECT 1 FROM t_user_usertodepart a JOIN t_user_usertodepart b ON a.departid = b.departid
        WHERE a.UserID = ? AND b.UserID = u.ID AND a.VDNID = ? AND b.VDNID = ?)))`,
      [ctx.vdnId, ctx.agentId, scopes.includes('group') ? 1 : 0, ctx.agentId, ctx.vdnId, ctx.vdnId,
        scopes.includes('department') ? 1 : 0, ctx.agentId, ctx.vdnId, ctx.vdnId]);
  }
  const workNos = agents.map(a => a.work_no);
  const userIds = all ? users.map(u => u.id) : users.filter(u => u.id === ctx.userId || workNos.includes(resolveCcsWorkNo(u as any, env.CCS_WORK_NO_FIELD))).map(u => u.id);
  return { ...ctx, permission, scopes, all, userIds: [...new Set([ctx.userId, ...userIds])], agentIds: agents.map(a => a.id), workNos };
}

/** Predicates are ANDed with application filters before pagination/count/update. */
export function modelScope(model: string, ctx: ScopeContext, fields: Set<string>): Record<string, unknown> {
  const tenant = fields.has('account_id') ? { account_id: ctx.accountId } : fields.has('vdn_id') ? { vdn_id: ctx.vdnId } : {};
  const conv = conversationScope(ctx);
  const contact = { account_id: ctx.accountId, ...(ctx.all ? {} : { OR: [
    { conversations: { some: conv } }, { opportunities: { some: { owner_id: { in: ctx.userIds } } } },
    ...ctx.userIds.map(id => ({ custom_attributes: { path: ['omni_owner_id'], equals: id } })),
  ] }) };
  if (model === 'users') return { id: { in: ctx.userIds } };
  if (model === 'accounts') return { id: ctx.accountId };
  if (model === 'agent_announcements') return ctx.permission.startsWith('announcement.') ? { account_id: ctx.accountId, vdn_id: ctx.vdnId } : announcementVisibility(ctx.accountId, ctx.vdnId, ctx.agentId);
  if (model === 'agent_announcement_reads') return { user_id: ctx.userId, announcement: announcementVisibility(ctx.accountId, ctx.vdnId, ctx.agentId) };
  if (model === 'agent_announcement_groups') return { account_id: ctx.accountId, vdn_id: ctx.vdnId };
  // Personal objects never broaden via an unrelated role's account scope.
  if (['notifications', 'notification_settings', 'notification_subscriptions', 'custom_filters', 'agent_memos', 'agent_calendar_events', 'copilot_threads'].includes(model)) return { ...tenant, user_id: ctx.userId };
  if (model === 'conversations') return conv;
  if (model === 'contacts') return contact;
  if (model === 'companies' && !ctx.all) return { ...tenant, contacts: { some: contact } };
  if (model === 'opportunities' && !ctx.all) return { ...tenant, owner_id: { in: ctx.userIds } };
  if (model === 'attachments') return { ...tenant, message: { conversation: conv } };
  if (model === 'icc_voicemails' && !ctx.all) return { ...tenant, assignee_id: { in: ctx.userIds } };
  if (model === 'agent_rest_requests') return { ...tenant, OR: [{ applicant_user_id: ctx.userId }, { leader_user_id: ctx.userId }] };
  if (fields.has('conversation_id') && fields.has('conversation')) return { ...tenant, conversation: conv };
  if (fields.has('contact_id') && fields.has('contact')) return { ...tenant, contact };
  if (!fields.has('account_id') && fields.has('inbox')) return { inbox: { account_id: ctx.accountId } };
  if (!fields.has('account_id') && fields.has('portal')) return { portal: { account_id: ctx.accountId } };
  if (!ctx.all && fields.has('assignee_agent_id')) return { ...tenant, assignee_agent_id: { in: ctx.agentIds } };
  return tenant;
}
export function conversationScope(ctx: ScopeContext): Record<string, any> {
  return { account_id: ctx.accountId, ...(ctx.all ? {} : { OR: [
    { assignee_id: { in: ctx.userIds } }, { participants: { some: { user_id: { in: ctx.userIds } } } },
    ...(['conversation.queue', 'voicemail.claim'].includes(ctx.permission) ? [{ assignee_id: null, inbox: { inbox_members: { some: { user_id: { in: ctx.userIds } } } } }] : []),
  ] }) };
}
export function combineWhere(where: any, scope: Record<string, unknown>) {
  // Preserve unique selectors at the top level for Prisma's extended WhereUniqueInput.
  return { ...where, AND: [...(where?.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []), scope] };
}
export function assertScopeTarget(ctx: ScopeContext, userId: number) {
  if (!ctx.userIds.includes(userId)) throw new AppError(403, '目标人员不在授权数据范围内');
}
