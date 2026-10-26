import { describe, expect, it } from 'vitest';
import { signMediaUrl, validMediaUrl, hasUnsignedMedia, signMediaPayload } from '../modules/access/access.media.js';
describe('private media capabilities', () => {
  it('allows authorized short-lived links and rejects tampering and expiry', () => {
    const now = 1700000000000;
    const url = signMediaUrl('/uploads/a.wav', now);
    expect(validMediaUrl(url, now)).toBe(true);
    expect(validMediaUrl(url.replace('a.wav', 'b.wav'), now)).toBe(false);
    expect(validMediaUrl(url, now + 301000)).toBe(false);
  });
  it('cannot use an absolute local-upload URL to bypass upload proof', () => {
    expect(hasUnsignedMedia({ file_url: 'https://host/uploads/secret.wav' })).toBe(true);
    expect(hasUnsignedMedia({ file_url: signMediaUrl('/uploads/own.wav') })).toBe(false);
  });
  it('signs authorized media metadata but never arbitrary message text', () => {
    const payload = signMediaPayload({ content: '/uploads/other.wav', content_attributes: { file_url: '/uploads/own.wav' } });
    expect(payload.content).toBe('/uploads/other.wav');
    expect(validMediaUrl(payload.content_attributes.file_url)).toBe(true);
  });
});
