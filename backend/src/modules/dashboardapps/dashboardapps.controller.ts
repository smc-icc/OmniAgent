import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { NotFoundError, ValidationError } from '../../shared/errors/index.js';

interface DashboardAppContentItem {
  url: string;
  type: string;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatDashboardApp(d: Record<string, unknown>) {
  return {
    id: d.id,
    title: d.title,
    content: d.content,
    account_id: d.account_id,
    user_id: d.user_id,
    created_at: (d.created_at as Date)?.getTime(),
    updated_at: (d.updated_at as Date)?.getTime(),
  };
}

/** GET /api/v1/accounts/:account_id/dashboard_apps */
export async function listDashboardApps(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const apps = await prisma.dashboard_apps.findMany({
    where: { account_id: parseInt(account_id, 10) },
    orderBy: { created_at: 'asc' },
  });
  return reply.status(200).send({
    payload: apps.map((a) => formatDashboardApp(a as unknown as Record<string, unknown>)),
  });
}

/** GET /api/v1/accounts/:account_id/dashboard_apps/:id */
export async function showDashboardApp(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const app = await prisma.dashboard_apps.findUnique({ where: { id: parseInt(id, 10) } });
  if (!app) throw new NotFoundError('Dashboard App');
  return reply.status(200).send(formatDashboardApp(app as unknown as Record<string, unknown>));
}

/** POST /api/v1/accounts/:account_id/dashboard_apps */
export async function createDashboardApp(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const user = request.currentUser as { id: number } | null;
  const body = request.body as {
    title?: string;
    content?: DashboardAppContentItem[];
  };

  if (!body.title?.trim()) {
    throw new ValidationError(['Title is required']);
  }

  // Validate content: must be array of { url, type }
  let content = (body.content ?? []) as DashboardAppContentItem[];
  if (!Array.isArray(content) || content.length === 0) {
    content = [];
  }

  for (const item of content) {
    if (!isValidUrl(item.url)) {
      throw new ValidationError([`Invalid URL in content: ${item.url}`]);
    }
    if (item.type !== 'frame') {
      throw new ValidationError([`Content type must be "frame", got: ${item.type}`]);
    }
  }

  const app = await prisma.dashboard_apps.create({
    data: {
      account_id: parseInt(account_id, 10),
      title: body.title.trim(),
      content: content as unknown as object,
      user_id: user?.id,
    },
  });

  return reply.status(200).send(formatDashboardApp(app as unknown as Record<string, unknown>));
}

/** PUT /api/v1/accounts/:account_id/dashboard_apps/:id */
export async function updateDashboardApp(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as {
    title?: string;
    content?: DashboardAppContentItem[];
  };

  const existing = await prisma.dashboard_apps.findUnique({ where: { id: parseInt(id, 10) } });
  if (!existing) throw new NotFoundError('Dashboard App');

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title.trim();

  if (body.content !== undefined) {
    if (!Array.isArray(body.content)) {
      data.content = [];
    } else {
      for (const item of body.content) {
        if (!isValidUrl(item.url)) {
          throw new ValidationError([`Invalid URL in content: ${item.url}`]);
        }
      }
      data.content = body.content as unknown as object;
    }
  }

  const app = await prisma.dashboard_apps.update({
    where: { id: parseInt(id, 10) },
    data: data as object,
  });

  return reply.status(200).send(formatDashboardApp(app as unknown as Record<string, unknown>));
}

/** DELETE /api/v1/accounts/:account_id/dashboard_apps/:id */
export async function destroyDashboardApp(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.dashboard_apps.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}
