import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { NotFoundError, ValidationError } from '../../shared/errors/index.js';

// ── Helpers ──

function formatLabel(l: Record<string, unknown>) {
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    color: l.color ?? '#1f93ff',
    show_on_sidebar: l.show_on_sidebar,
  };
}

// ── CRUD ──

/** GET /api/v1/accounts/:account_id/labels */
export async function listLabels(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const labels = await prisma.labels.findMany({
    where: { account_id: parseInt(account_id, 10) },
    orderBy: { title: 'asc' },
  });
  return reply.status(200).send({
    payload: labels.map((l) => formatLabel(l as unknown as Record<string, unknown>)),
  });
}

/** GET /api/v1/accounts/:account_id/labels/:id */
export async function showLabel(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const label = await prisma.labels.findUnique({ where: { id: parseInt(id, 10) } });
  if (!label) throw new NotFoundError('Label');
  return reply.status(200).send(formatLabel(label as unknown as Record<string, unknown>));
}

/** POST /api/v1/accounts/:account_id/labels */
export async function createLabel(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as {
    title?: string; description?: string; color?: string; show_on_sidebar?: boolean;
  };

  if (!body.title?.trim()) {
    throw new ValidationError(['Title is required']);
  }

  // Check uniqueness per account
  const existing = await prisma.labels.findFirst({
    where: { account_id: parseInt(account_id, 10), title: body.title.toLowerCase().trim() },
  });
  if (existing) {
    throw new ValidationError([`Label "${body.title}" already exists`]);
  }

  const label = await prisma.labels.create({
    data: {
      account_id: parseInt(account_id, 10),
      title: body.title.toLowerCase().trim(),
      description: body.description ?? '',
      color: body.color ?? '#1f93ff',
      show_on_sidebar: body.show_on_sidebar ?? false,
    },
  });

  return reply.status(200).send(formatLabel(label as unknown as Record<string, unknown>));
}

/** PUT /api/v1/accounts/:account_id/labels/:id */
export async function updateLabel(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as {
    title?: string; description?: string; color?: string; show_on_sidebar?: boolean;
  };

  const existing = await prisma.labels.findUnique({ where: { id: parseInt(id, 10) } });
  if (!existing) throw new NotFoundError('Label');

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title.toLowerCase().trim();
  if (body.description !== undefined) data.description = body.description;
  if (body.color !== undefined) data.color = body.color;
  if (body.show_on_sidebar !== undefined) data.show_on_sidebar = body.show_on_sidebar;

  const label = await prisma.labels.update({
    where: { id: parseInt(id, 10) },
    data: data as object,
  });

  return reply.status(200).send(formatLabel(label as unknown as Record<string, unknown>));
}

/** DELETE /api/v1/accounts/:account_id/labels/:id */
export async function destroyLabel(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.labels.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}
