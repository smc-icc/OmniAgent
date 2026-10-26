import { confTenancyEnabled, assertLiveBinding } from '../../shared/services/conf-tenancy.js';
import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/index.js';
import { database, rows } from '../access/access.db.js';
import { accessScope } from '../access/access.scope.js';
import { env } from '../../config/env.js';
import { resolveCcsWorkNo } from '../../integrations/ccs/ccs-workno.js';
import { announcementSchema, announcementVisibility } from './announcements.policy.js';
import type { AccessContext } from '../access/access.context.js';

export async function recipientCatalog(pg: PrismaClient, ctx: AccessContext) {
  const db = await database();
  const operators = (await rows<{ id: number; name: string; work_no: string }>(db,
    'SELECT ID AS id, Name AS name, WorkNO AS work_no FROM t_user_users WHERE VDNID=? AND IsValid=1 AND COALESCE(IsSystem,0)=0 ORDER BY WorkNO', [ctx.vdnId])).map(o => ({ ...o, id: Number(o.id) }));
  const valid = new Set(operators.map(o => o.id));
  const definitions = [
    ['groups', 'SELECT g.ID AS id,g.Name AS name,m.UserID AS user_id FROM t_user_group g JOIN t_icc_grouptovdn v ON v.GroupID=g.ID AND v.VDNID=? LEFT JOIN t_user_usertogroup m ON m.GroupID=g.ID AND m.VDNID=v.VDNID'],
    ['skills', 'SELECT g.ID AS id,g.Name AS name,m.UserID AS user_id FROM t_icc_skill g LEFT JOIN t_icc_skill_skilltouser m ON m.SkillID=g.ID WHERE g.VDN=?'],
    ['departments', 'SELECT g.ID AS id,g.DepartMentName AS name,m.UserID AS user_id FROM t_user_department g LEFT JOIN t_user_usertodepart m ON m.departid=g.ID AND m.VDNID=g.VDNID WHERE g.VDNID=?'],
    ['roles', 'SELECT g.ID AS id,g.Name AS name,m.UserID AS user_id FROM t_user_role g LEFT JOIN t_user_usertorole m ON m.RoleID=g.ID AND (m.VDNID=g.VDNID OR (g.VDNID=1 AND m.VDNID<=0)) WHERE g.VDNID=?'],
  ];
  const categories: Record<string, { id: number; name: string; operator_ids: number[] }[]> = {};
  for (const [kind, sql] of definitions) {
    const list = await rows<{ id: number; name: string; user_id: number }>(db, sql, [ctx.vdnId]);
    const map = new Map<number, { id: number; name: string; operator_ids: number[] }>();
    for (const row of list) {
      row.id = Number(row.id); row.user_id = Number(row.user_id);
      if (!map.has(row.id)) map.set(row.id, { id: row.id, name: row.name, operator_ids: [] });
      const group = map.get(row.id)!;
      if (valid.has(row.user_id) && !group.operator_ids.includes(row.user_id)) group.operator_ids.push(row.user_id);
    }
    categories[kind] = [...map.values()];
  }
  categories.custom = (await pg.agent_announcement_groups.findMany({ where: { account_id: ctx.accountId, vdn_id: ctx.vdnId }, orderBy: { name: 'asc' } }))
    .map(g => ({ id: g.id, name: g.name, operator_ids: g.operator_ids.filter(id => valid.has(id)) }));
  return { operators, categories };
}
export async function validateRecipients(ctx: AccessContext, ids: number[]) {
  if (!ids.length) return;
  const found = await rows<{ id: number }>(await database(), `SELECT ID AS id FROM t_user_users WHERE VDNID=? AND IsValid=1 AND COALESCE(IsSystem,0)=0 AND ID IN (${ids.map(() => '?').join(',')})`, [ctx.vdnId, ...ids]);
  if (found.length !== ids.length) throw new AppError(422, '接收人已停用、不存在或不属于当前 VDN，请刷新接收人列表');
}
export async function recipientIdentity(pg: PrismaClient, userId: number) {
  const ctx = accessScope.getStore();
  if (ctx && ctx.userId === userId) return ctx;
  if (confTenancyEnabled()) {
    const live = await assertLiveBinding(userId);
    return { userId, accountId: live.map.account_id, vdnId: live.map.vdn_id, agentId: live.user.id };
  }
  const user = await pg.users.findUnique({ where: { id: userId } });
  const accountId = Number(process.env.OMNI_ACCESS_ACCOUNT_ID || 1), vdnId = env.OMNI_AGENT_VDN_ID;
  if (!user || !await pg.account_users.findFirst({ where: { user_id: userId, account_id: accountId } })) throw new AppError(403, '不属于当前租户');
  const [agent] = await rows<{ id: number }>(await database(), 'SELECT ID AS id FROM t_user_users WHERE WorkNO=? AND VDNID=? AND IsValid=1', [resolveCcsWorkNo(user, env.CCS_WORK_NO_FIELD), vdnId]);
  return { userId, accountId, vdnId, agentId: Number(agent?.id ?? 0) };
}
export function mapAnnouncement(a: any, read = false) {
  return { ...a, id: String(a.id), body: a.body ?? '', published_at: a.published_at.toISOString(), starts_at: a.starts_at.toISOString(), ends_at: a.ends_at?.toISOString() ?? null, time_label: a.published_at.toLocaleDateString('zh-CN'), read };
}
export async function listAnnouncements(pg: PrismaClient, _accountId: number | null, userId: number, opts?: { unreadOnly?: boolean; readOnly?: boolean; page?: number; limit?: number; query?: string }) {
  const ctx = await recipientIdentity(pg, userId);
  const visible = announcementVisibility(ctx.accountId, ctx.vdnId, ctx.agentId);
  const where: Prisma.agent_announcementsWhereInput = { ...visible, ...(opts?.unreadOnly ? { reads: { none: { user_id: userId } } } : opts?.readOnly ? { reads: { some: { user_id: userId } } } : {}), ...(opts?.query ? { OR: [{ title: { contains: opts.query, mode: 'insensitive' } }, { body: { contains: opts.query, mode: 'insensitive' } }] } : {}) };
  const limit = opts?.limit ?? 100, page = opts?.page ?? 1;
  const [items, total, unread_count, read_count] = await Promise.all([
    pg.agent_announcements.findMany({ where, orderBy: [{ published_at: 'desc' }, { id: 'desc' }], take: limit, skip: (page - 1) * limit, include: { reads: { where: { user_id: userId } } } }),
    pg.agent_announcements.count({ where }),
    pg.agent_announcements.count({ where: { ...announcementVisibility(ctx.accountId, ctx.vdnId, ctx.agentId), reads: { none: { user_id: userId } } } }),
    pg.agent_announcements.count({ where: { ...visible, reads: { some: { user_id: userId } } } }),
  ]);
  // Do not expose the full recipient roster in the recipient inbox.
  return { items: items.map(a => { const { recipient_ids, author_id, reads, ...item } = mapAnnouncement(a, !!a.reads.length); return item; }), total, unread_count, read_count };
}
export async function markAnnouncementsRead(pg: PrismaClient, userId: number, ids: number[]) {
  const ctx = await recipientIdentity(pg, userId), unique = [...new Set(ids)];
  const found = await pg.agent_announcements.findMany({ where: { id: { in: unique }, ...announcementVisibility(ctx.accountId, ctx.vdnId, ctx.agentId) }, select: { id: true } });
  if (found.length !== unique.length) throw new AppError(403, '公告不在接收范围内或已过期');
  await pg.agent_announcement_reads.createMany({ data: found.map(a => ({ announcement_id: a.id, user_id: userId })), skipDuplicates: true });
  return found.length;
}
export async function markAnnouncementUnread(pg: PrismaClient, userId: number, id: number) {
  const ctx = await recipientIdentity(pg, userId);
  if (!await pg.agent_announcements.findFirst({ where: { id, ...announcementVisibility(ctx.accountId, ctx.vdnId, ctx.agentId) } })) throw new AppError(403, '公告不在接收范围内或已过期');
  return (await pg.agent_announcement_reads.deleteMany({ where: { announcement_id: id, user_id: userId } })).count > 0;
}
export async function saveAnnouncement(pg: PrismaClient, ctx: AccessContext, id: number | null, input: unknown) {
  const b = announcementSchema.parse(input);
  await validateRecipients(ctx, b.recipient_ids);
  const data = { ...b, account_id: ctx.accountId, vdn_id: ctx.vdnId, author_id: ctx.userId, starts_at: new Date(b.starts_at), ends_at: b.ends_at ? new Date(b.ends_at) : null };
  if (!id) return mapAnnouncement(await pg.agent_announcements.create({ data }));
  const existing = await pg.agent_announcements.findFirst({ where: { id, account_id: ctx.accountId, vdn_id: ctx.vdnId } });
  if (!existing) throw new AppError(404, '公告不存在');
  // Publication recipients are immutable; change a draft or create a new announcement.
  if (existing.status === 'published') throw new AppError(409, '已发布公告不能修改，请撤下后重新发布');
  const result = await pg.agent_announcements.updateMany({ where: { id, account_id: ctx.accountId, vdn_id: ctx.vdnId, status: 'draft' }, data: { ...data, ...(b.status === 'published' ? { published_at: new Date() } : {}) } });
  if (!result.count) throw new AppError(409, '公告状态已改变，请刷新后重试');
  return mapAnnouncement(await pg.agent_announcements.findFirstOrThrow({ where: { id, account_id: ctx.accountId, vdn_id: ctx.vdnId } }));
}
