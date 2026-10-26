import { z } from 'zod';
export const idsSchema = z.array(z.number().int().positive()).max(10000).transform(ids => [...new Set(ids)]);
export const announcementSchema = z.object({
  title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20000),
  type: z.enum(['system', 'exam', 'training', 'emergency']).default('system'),
  status: z.enum(['draft', 'published']).default('published'),
  audience_mode: z.enum(['all', 'selected']), recipient_ids: idsSchema.default([]),
  starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.audience_mode === 'selected' && !v.recipient_ids.length) ctx.addIssue({ code: 'custom', path: ['recipient_ids'], message: '请选择至少一名接收人' });
  if (v.audience_mode === 'all' && v.recipient_ids.length) ctx.addIssue({ code: 'custom', path: ['recipient_ids'], message: '全员公告不应包含指定接收人' });
  if (v.ends_at && new Date(v.ends_at) <= new Date(v.starts_at)) ctx.addIssue({ code: 'custom', path: ['ends_at'], message: '结束时间必须晚于开始时间' });
});
export function announcementVisibility(accountId: number, vdnId: number, agentId: number, now = new Date()) {
  return { account_id: accountId, vdn_id: vdnId, status: 'published', starts_at: { lte: now },
    AND: [{ OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      { OR: [{ audience_mode: 'all' }, { audience_mode: 'selected', recipient_ids: { has: agentId } }] }],
  };
}
