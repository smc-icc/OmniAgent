import { createHash } from 'node:crypto';

/** WeChat / WeCom URL signature verification */
export function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  signature: string,
  encrypt?: string,
): boolean {
  const parts = encrypt ? [token, timestamp, nonce, encrypt] : [token, timestamp, nonce];
  parts.sort();
  const hash = createHash('sha1').update(parts.join('')).digest('hex');
  return hash === signature;
}

export function computeSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt?: string,
): string {
  const parts = encrypt ? [token, timestamp, nonce, encrypt] : [token, timestamp, nonce];
  parts.sort();
  return createHash('sha1').update(parts.join('')).digest('hex');
}
