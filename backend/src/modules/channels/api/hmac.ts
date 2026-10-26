import { createHmac, timingSafeEqual } from 'crypto';

export function signApiPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

export function verifyApiHmac(secret: string | null | undefined, body: string, signature: string | undefined): boolean {
  const key = String(secret || '');
  const sig = String(signature || '').trim().toLowerCase().replace(/^sha256=/, '');
  if (!key || !sig || !/^[0-9a-f]+$/.test(sig)) return false;
  const expected = signApiPayload(key, body);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function canonicalJsonBody(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload ?? {});
}

export function readHmacHeader(headers: Record<string, unknown> | undefined): string {
  const h = headers || {};
  const pick = (k: string) => {
    const v = h[k] ?? h[k.toLowerCase()];
    return Array.isArray(v) ? String(v[0] || '') : String(v || '');
  };
  return pick('x-omni-signature') || pick('X-Omni-Signature') || pick('x-chatwoot-signature') || pick('X-Chatwoot-Signature');
}
