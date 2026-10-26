import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class CredentialVault {
  private readonly keys = new Map<string, Buffer>();
  constructor(keys: Record<string, string>, private readonly current: string) {
    for (const [id, encoded] of Object.entries(keys)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('Invalid credential key identifier');
      const key = Buffer.from(encoded, 'base64');
      if (key.length !== 32) throw new Error('Credential encryption requires a 32-byte key');
      this.keys.set(id, key);
    }
    if (!this.keys.has(current)) throw new Error('Active credential encryption key is unavailable');
  }
  seal(scope: string, value: Record<string, unknown>): string {
    if (!scope) throw new Error('Credential scope is required');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current)!, iv);
    cipher.setAAD(Buffer.from(`social:v1:${this.current}:${scope}`, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', this.current, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
  }
  open(scope: string, envelope: string): Record<string, unknown> {
    const parts = envelope.split(':');
    if (!scope || parts.length !== 5 || parts[0] !== 'v1') throw new Error('Invalid credential envelope');
    const [, id, nonce, authTag, payload] = parts;
    const key = this.keys.get(id!);
    if (!key) throw new Error('Credential encryption key is unavailable');
    const iv = Buffer.from(nonce!, 'base64url'), tag = Buffer.from(authTag!, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid credential envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`social:v1:${id}:${scope}`, 'utf8'));
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([decipher.update(Buffer.from(payload!, 'base64url')), decipher.final()]);
    const value: unknown = JSON.parse(decoded.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid credential payload');
    return value as Record<string, unknown>;
  }
}
