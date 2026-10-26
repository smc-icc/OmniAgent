import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../plugins/db.js';
import { context } from '../access/access.context.js';
import { recipientCatalog, validateRecipients, saveAnnouncement, mapAnnouncement } from './announcements.service.js';
import { idsSchema } from './announcements.policy.js';
import { AppError } from '../../shared/errors/index.js';
const idOf = (req: any) => z.coerce.number().int().positive().parse(req.params.id);
async function uniqueName<T>(save: () => Promise<T>): Promise<T> {
  try { return await save(); } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw new AppError(409, '自定义分组名称已存在');
    throw error;
  }
}
export async function announcementRoutes(app: FastifyInstance) {
  app.get('/api/announcements/recipients', async req => recipientCatalog(prisma, await context(req)));
  app.get('/api/announcements/manage', async req => {
    const ctx = await context(req);
    const { page, limit } = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    const where = { account_id: ctx.accountId, vdn_id: ctx.vdnId };
    const [items, total] = await Promise.all([prisma.agent_announcements.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }), prisma.agent_announcements.count({ where })]);
    return { items: items.map(a => mapAnnouncement(a)), total };
  });
  app.post('/api/announcements/manage', async req => saveAnnouncement(prisma, await context(req), null, req.body));
  app.put('/api/announcements/manage/:id', async req => saveAnnouncement(prisma, await context(req), idOf(req), req.body));
  app.delete('/api/announcements/manage/:id', async req => {
    const ctx = await context(req);
    const result = await prisma.agent_announcements.deleteMany({ where: { id: idOf(req), account_id: ctx.accountId, vdn_id: ctx.vdnId } });
    if (!result.count) throw new AppError(404, '公告不存在');
    return { ok: true };
  });
  const groupSchema = z.object({ name: z.string().trim().min(1).max(100), operator_ids: idsSchema.refine(ids => ids.length > 0, '请选择分组成员') }).strict();
  app.post('/api/announcements/groups', async req => {
    const ctx = await context(req), b = groupSchema.parse(req.body); await validateRecipients(ctx, b.operator_ids);
    return uniqueName(() => prisma.agent_announcement_groups.create({ data: { ...b, account_id: ctx.accountId, vdn_id: ctx.vdnId, created_by: ctx.userId } }));
  });
  app.put('/api/announcements/groups/:id', async req => {
    const ctx = await context(req), b = groupSchema.parse(req.body); await validateRecipients(ctx, b.operator_ids);
    const result = await uniqueName(() => prisma.agent_announcement_groups.updateMany({ where: { id: idOf(req), account_id: ctx.accountId, vdn_id: ctx.vdnId }, data: b }));
    if (!result.count) throw new AppError(404, '自定义分组不存在'); return { ok: true };
  });
  app.delete('/api/announcements/groups/:id', async req => {
    const ctx = await context(req);
    const result = await prisma.agent_announcement_groups.deleteMany({ where: { id: idOf(req), account_id: ctx.accountId, vdn_id: ctx.vdnId } });
    if (!result.count) throw new AppError(404, '自定义分组不存在'); return { ok: true };
  });
}
