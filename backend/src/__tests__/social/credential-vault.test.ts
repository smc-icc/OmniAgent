import { describe, expect, it } from 'vitest';
import { CredentialVault } from '../../modules/social-auth/credential-vault.js';

const key = Buffer.alloc(32, 7).toString('base64');
describe('social credential vault', () => {
  it('encrypts secrets with versioned authenticated envelopes', () => {
    const vault = new CredentialVault({ current: key }, 'current');
    const first = vault.seal('app:1', { clientSecret: 'never-in-app' });
    const second = vault.seal('app:1', { clientSecret: 'never-in-app' });
    expect(first).not.toBe(second);
    expect(first).not.toContain('never-in-app');
    expect(vault.open('app:1', first)).toEqual({ clientSecret: 'never-in-app' });
  });
  it('does not allow ciphertext to be swapped between enterprise rows', () => {
    const vault = new CredentialVault({ current: key }, 'current');
    expect(() => vault.open('installation:2', vault.seal('installation:1', { refreshToken: 'secret' }))).toThrow();
  });
  it('supports old key decryption while writing only the new key', () => {
    const old = new CredentialVault({ old: key }, 'old').seal('app:1', { secret: 'rotated' });
    const current = new CredentialVault({ old: key, current: Buffer.alloc(32, 9).toString('base64') }, 'current');
    expect(current.open('app:1', old)).toEqual({ secret: 'rotated' });
    expect(current.seal('app:1', {})).toMatch(/^v1:current:/);
  });
  it('fails closed for short keys and modified authentication tags', () => {
    expect(() => new CredentialVault({ short: 'not-a-key' }, 'short')).toThrow();
    const vault = new CredentialVault({ current: key }, 'current');
    const parts = vault.seal('app:1', { secret: 'x' }).split(':');
    parts[3] = Buffer.alloc(16, 0).toString('base64url');
    expect(() => vault.open('app:1', parts.join(':'))).toThrow();
  });
});
