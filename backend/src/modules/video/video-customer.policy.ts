import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../shared/errors/index.js';

const entrySchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), label: z.string().max(80).default('Video support'),
  vdnId: z.number().int().positive(), accessCode: z.string().regex(/^\d{1,30}$/) }).strict();
export type VideoEntry = z.infer<typeof entrySchema>;
export function parseVideoEntries(raw: string): VideoEntry[] {
  const entries = z.array(entrySchema).max(32).parse(JSON.parse(raw || '[]'));
  if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Duplicate video entry');
  return entries;
}
const iceSchema = z.object({ urls: z.union([z.string(), z.array(z.string()).min(1).max(8)]), username: z.string().max(256).optional(), credential: z.string().max(512).optional() }).strict();
export function browserSipSettings(rawUrl: string, rawIce: string) {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new AppError(503, 'Browser SIP WSS endpoint is not configured'); }
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash) throw new AppError(503, 'Invalid browser SIP WSS endpoint');
  const servers = z.array(iceSchema).max(8).parse(JSON.parse(rawIce || '[]'));
  for (const server of servers) {
    for (const iceUrl of [server.urls].flat()) {
      if (!/^(stun|stuns|turn|turns):[^\s@]+$/.test(iceUrl)) throw new AppError(503, 'Invalid ICE server');
    }
  }
  return { wss_url: url.toString(), ice_servers: servers };
}
export function checkVideoOrigin(origin: string | undefined, baseUrl: string) {
  if (!origin || origin !== new URL(baseUrl).origin) throw new AppError(403, 'Video session origin denied');
}
export const hashVideoToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function issueVisitorIdentity(mediaType: 0 | 1 = 1) {
  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('hex');
  return { id, username: `${mediaType === 0 ? 'voice' : 'video'}_${id}`, password: randomBytes(32).toString('hex'), token, tokenHash: hashVideoToken(token) };
}
