import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { syncSystemSuperuser } from '../../shared/services/system-superuser.js';

const systemSuperuserSchema = z.object({
  uid: z.literal('admin'), email: z.string().email().max(255),
  password: z.string().min(1).max(255).refine(p => Buffer.byteLength(p, 'utf8') <= 72), account_id: z.number().int().positive(),
}).strict();

/** No development-mode bypass: this endpoint grants the singleton system identity. */
export async function syncSystemSuperuserFromConfServer(request: FastifyRequest, reply: FastifyReply) {
  const secret = env.PLATFORM_SYNC_SECRET;
  if (!secret) return reply.status(503).send({ error: 'PLATFORM_SYNC_SECRET not configured' });
  const header = request.headers['x-platform-sync-token'];
  const token = typeof header === 'string' ? header : '';
  const a = Buffer.from(token), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return reply.status(401).send({ error: 'Unauthorized' });
  const payload = systemSuperuserSchema.safeParse(request.body);
  if (!payload.success) return reply.status(400).send({ error: 'Invalid system superuser payload' });
  try {
    return reply.send({ success: true, data: await syncSystemSuperuser(payload.data) });
  } catch {
    // Do not echo a request, password or database error into logs/responses.
    return reply.status(409).send({ error: 'System superuser sync failed; check account and identity mapping' });
  }
}

