import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { HubDeliveryError } from '../core/errors.js';

const V4_PRIVATE = [
  /^127\./,
  /^10\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
];

export function isPrivateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (v === '::1' || v === '0:0:0:0:0:0:0:1') return true;
  if (v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true;
  if (v.includes(':')) {
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return false;
  }
  return V4_PRIVATE.some((re) => re.test(v));
}

export async function assertSafeHttpUrl(
  urlStr: string,
  opts: { allowPrivate?: boolean; allowHosts?: string[] } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new HubDeliveryError(`非法 URL: ${urlStr}`, 'fatal');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HubDeliveryError(`禁止的协议 ${url.protocol}`, 'fatal');
  }
  if (url.username || url.password) {
    throw new HubDeliveryError('URL 不得包含 userinfo', 'fatal');
  }
  const host = url.hostname.toLowerCase();
  if (opts.allowHosts?.length && !opts.allowHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new HubDeliveryError(`host ${host} 不在白名单`, 'fatal');
  }
  const ip = isIP(host) ? host : (await lookup(host)).address;
  if (!opts.allowPrivate && isPrivateIp(ip)) {
    throw new HubDeliveryError(`SSRF: 拒绝内网地址 ${host} → ${ip}`, 'fatal');
  }
  return url;
}
