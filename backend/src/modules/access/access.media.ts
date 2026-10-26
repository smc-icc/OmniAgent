import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
const mac = (path: string, expires: string) => createHmac('sha256', env.JWT_SECRET).update(`omni-media\n${path}\n${expires}`).digest('hex');
export function signMediaUrl(value: string, now = Date.now()): string {
  const url = new URL(value, 'http://omni.local');
  if (!url.pathname.startsWith('/uploads/')) return value;
  const expires = String(Math.floor(now / 1000) + 300);
  url.searchParams.set('expires', expires); url.searchParams.set('signature', mac(url.pathname, expires));
  return value.startsWith('/') ? url.pathname + url.search : url.toString();
}
export function validMediaUrl(value: string, now = Date.now()): boolean {
  const url = new URL(value, 'http://omni.local');
  const expires = url.searchParams.get('expires') ?? '', signature = url.searchParams.get('signature') ?? '';
  if (!/^\d+$/.test(expires) || Number(expires) < Math.floor(now / 1000) || Number(expires) > Math.floor(now / 1000) + 300 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(mac(url.pathname, expires), 'hex'));
}
export function signMediaPayload(value: any): any {
  if (Array.isArray(value)) return value.map(signMediaPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    typeof child === 'string' && /^(file_url|external_url|data_url|thumb_url|audio_url)$/.test(key) && child.startsWith('/uploads/') ? signMediaUrl(child) : signMediaPayload(child),
  ]));
}
export function hasUnsignedMedia(value: any): boolean {
  if (typeof value === 'string') {
    try { return new URL(value, 'http://omni.local').pathname.startsWith('/uploads/') && !validMediaUrl(value); } catch { return false; }
  }
  return !!value && typeof value === 'object' && Object.values(value).some(hasUnsignedMedia);
}
