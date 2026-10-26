import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { syncVdn, syncManagedUser } from '../../shared/services/conf-tenancy-sync.js';
import { confTenancyEnabled } from '../../shared/services/conf-tenancy.js';

export function requireConfSync(req: FastifyRequest, reply: FastifyReply) {
  const secret = env.PLATFORM_SYNC_SECRET;
  if (!secret) { reply.status(503).send({ error: 'PLATFORM_SYNC_SECRET not configured' }); return false; }
  const header = req.headers['x-platform-sync-token'];
  const a = Buffer.from(typeof header === 'string' ? header : ''), b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { reply.status(401).send({ error: 'Unauthorized' }); return false; }
  return true;
}
const vdnSchema = z.object({ action: z.enum(['upsert', 'delete']), vdn_id: z.number().int().positive(), account_id: z.number().int().positive().optional() }).strict();
const userSchema = z.object({ action: z.enum(['upsert', 'delete']), vdn_id: z.number().int().positive(), source_user_id: z.number().int().positive(), work_no: z.string().trim().min(1).max(100) }).strict();
async function handle(req: FastifyRequest, reply: FastifyReply, kind: 'vdn' | 'user') {
  if (!requireConfSync(req, reply)) return;
  if (!confTenancyEnabled()) return reply.status(409).send({ error: 'Conf tenancy not enabled' });
  try {
    const data = kind === 'vdn' ? await syncVdn(vdnSchema.parse(req.body)) : await syncManagedUser(userSchema.parse(req.body));
    return reply.send({ success: true, data });
  } catch (error) {
    // Never echo source credentials, SQL errors or an untrusted request body.
    return reply.status(error instanceof z.ZodError ? 400 : 409).send({ error: 'Conf tenancy sync rejected; verify mapping and source identity' });
  }
}
export const syncConfVdn = (req: FastifyRequest, reply: FastifyReply) => handle(req, reply, 'vdn');
export const syncConfManagedUser = (req: FastifyRequest, reply: FastifyReply) => handle(req, reply, 'user');
