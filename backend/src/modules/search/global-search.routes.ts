import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../plugins/db.js';
import { getAccess } from '../access/access.context.js';

const querySchema = z.object({ q: z.string().trim().min(1).max(200), types: z.string().optional(), limit: z.coerce.number().int().min(1).max(20).default(8) });
const esc = (s: string | null | undefined) => String(s ?? '').replace(/<[^>]*>/g, '').slice(0, 240);
export async function globalSearchRoutes(app: FastifyInstance) {
  app.get('/api/search/global', async (req: FastifyRequest) => {
    const q = querySchema.parse(req.query), access = await getAccess(req);
    const selected = new Set((q.types?.split(',').map(s => s.trim()).filter(Boolean) ?? ['all']));
    const wants = (kind: string) => selected.has('all') || selected.has(kind);
    const limit = q.limit, needle = q.q;
    const [conversations, messages, contacts, announcements, memos, calendar, rest, articles, documents] = await Promise.all([
      wants('conversations') && access.permissions.includes('conversation.read') ? prisma.conversations.findMany({ where: { OR: [{ cached_label_list: { contains: needle, mode: 'insensitive' } }, { identifier: { contains: needle, mode: 'insensitive' } }] }, take: limit, orderBy: { last_activity_at: 'desc' }, select: { id: true, display_id: true, status: true, cached_label_list: true, last_activity_at: true } }) : [],
      wants('messages') && access.permissions.includes('conversation.read') ? prisma.messages.findMany({ where: { content: { contains: needle, mode: 'insensitive' } }, take: limit, orderBy: { created_at: 'desc' }, select: { id: true, content: true, conversation_id: true, created_at: true } }) : [],
      wants('contacts') && access.permissions.includes('customer.read') ? prisma.contacts.findMany({ where: { OR: [{ name: { contains: needle, mode: 'insensitive' } }, { email: { contains: needle, mode: 'insensitive' } }, { phone_number: { contains: needle, mode: 'insensitive' } }] }, take: limit, orderBy: { updated_at: 'desc' }, select: { id: true, name: true, email: true, phone_number: true } }) : [],
      wants('announcements') && access.permissions.includes('announcement.read') ? prisma.agent_announcements.findMany({ where: { OR: [{ title: { contains: needle, mode: 'insensitive' } }, { body: { contains: needle, mode: 'insensitive' } }] }, take: limit, orderBy: { published_at: 'desc' }, select: { id: true, title: true, body: true, type: true, published_at: true } }) : [],
      wants('memos') ? prisma.agent_memos.findMany({ where: { OR: [{ title: { contains: needle, mode: 'insensitive' } }, { content: { contains: needle, mode: 'insensitive' } }] }, take: limit, orderBy: { created_at: 'desc' }, select: { id: true, title: true, content: true, done: true, created_at: true } }) : [],
      wants('calendar') ? prisma.agent_calendar_events.findMany({ where: { OR: [{ content: { contains: needle, mode: 'insensitive' } }, { location: { contains: needle, mode: 'insensitive' } }, { note: { contains: needle, mode: 'insensitive' } }] }, take: limit, orderBy: { date: 'desc' }, select: { id: true, date: true, time: true, content: true, location: true } }) : [],
      wants('tickets') ? prisma.agent_rest_requests.findMany({ where: { OR: [{ content: { contains: needle, mode: 'insensitive' } }, { applicant_name: { contains: needle, mode: 'insensitive' } }, { status: { contains: needle, mode: 'insensitive' } }] }, take: limit, orderBy: { requested_at: 'desc' }, select: { id: true, content: true, status: true, applicant_name: true, requested_at: true } }) : [],
      wants('knowledge') && access.permissions.includes('knowledge.read') ? prisma.articles.findMany({ where: { OR: [{ title: { contains: needle, mode: 'insensitive' } }, { description: { contains: needle, mode: 'insensitive' } }, { content: { contains: needle, mode: 'insensitive' } }] }, take: limit, orderBy: { updated_at: 'desc' }, select: { id: true, title: true, description: true, content: true, updated_at: true, portal_id: true } }) : [],
      wants('documents') && access.permissions.includes('knowledge.read') ? prisma.captain_documents.findMany({ where: { OR: [{ name: { contains: needle, mode: 'insensitive' } }, { content: { contains: needle, mode: 'insensitive' } }] }, take: limit, orderBy: { updated_at: 'desc' }, select: { id: true, name: true, content: true, external_link: true, updated_at: true } }) : [],
    ]);
    const result = {
      conversations: conversations.map(x => ({ id: x.id, title: `会话 #${x.display_id}`, snippet: esc(x.cached_label_list), route: `/omnichannel?conversation=${x.id}`, updated_at: x.last_activity_at })),
      messages: messages.map(x => ({ id: x.id, title: `会话 #${x.conversation_id} 消息`, snippet: esc(x.content), route: `/omnichannel?conversation=${x.conversation_id}`, updated_at: x.created_at })),
      contacts: contacts.map(x => ({ id: x.id, title: x.name || x.email || x.phone_number || '联系人', snippet: esc(x.email || x.phone_number), route: `/customers/${x.id}` })),
      announcements: announcements.map(x => ({ id: x.id, title: x.title, snippet: esc(x.body), route: `/business-nav?tile=最新未读公告信息`, updated_at: x.published_at })),
      memos: memos.map(x => ({ id: x.id, title: x.title, snippet: esc(x.content), route: '/', updated_at: x.created_at })),
      calendar: calendar.map(x => ({ id: x.id, title: x.content || x.location || '行程', snippet: `${x.date.toISOString().slice(0, 10)} ${x.time}`, route: '/business-nav?tile=日程安排', updated_at: x.date })),
      tickets: rest.map(x => ({ id: x.id, title: `${x.applicant_name || '工单'} · ${x.status}`, snippet: esc(x.content), route: '/business-nav?tile=小休申请记录', updated_at: x.requested_at })),
      knowledge: articles.map(x => ({ id: x.id, title: x.title || '知识文章', snippet: esc(x.description || x.content), route: `/omnichannel?panel=kb&article=${x.id}`, updated_at: x.updated_at })),
      documents: documents.map(x => ({ id: x.id, title: x.name || '知识文档', snippet: esc(x.content), route: x.external_link || '/omnichannel?panel=kb', updated_at: x.updated_at })),
    };
    return { query: needle, results: result, total: Object.values(result).reduce((n, list) => n + list.length, 0) };
  });
}
