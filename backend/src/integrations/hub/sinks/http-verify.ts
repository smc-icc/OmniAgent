import { timingSafeEqual } from 'node:crypto';
import { signHttpBody } from './http.sink.js';

const SKEW_MS = 5 * 60 * 1000;

export function verifyHttpSignature(opts: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  nowMs?: number;
}): { ok: boolean; error?: string } {
  const now = opts.nowMs ?? Date.now();
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, error: 'invalid timestamp' };
  if (Math.abs(now - ts) > SKEW_MS) return { ok: false, error: 'timestamp skew' };
  const expected = signHttpBody(opts.secret, opts.timestamp, opts.rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(opts.signature ?? ''));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'bad signature' };
  }
  return { ok: true };
}
