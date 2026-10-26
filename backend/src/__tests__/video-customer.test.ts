import { describe, expect, it } from 'vitest';
import { parseVideoEntries, browserSipSettings, checkVideoOrigin, issueVisitorIdentity } from '../modules/video/video-customer.policy.js';

describe('video visitor boundaries', () => {
  it('entry configuration binds one server-owned VDN and numeric destination', () => {
    expect(parseVideoEntries('[{"id":"support","label":"Video support","vdnId":1,"accessCode":"7000"}]')).toEqual([
      { id: 'support', label: 'Video support', vdnId: 1, accessCode: '7000' },
    ]);
  });
  it.each(['[{"id":"x","vdnId":0,"accessCode":"7000"}]', '[{"id":"x","vdnId":1,"accessCode":"sip:admin@other"}]', '[{"id":"x","vdnId":1,"accessCode":"7000"},{"id":"x","vdnId":2,"accessCode":"8000"}]'])('rejects invalid/ambiguous entry config', text => {
    expect(() => parseVideoEntries(text)).toThrow();
  });
  it('browser configuration never derives WSS from TLS port 5064', () => {
    expect(() => browserSipSettings('', '[]')).toThrow();
    expect(() => browserSipSettings('ws://omni.seami.cloud/sip', '[]')).toThrow();
    expect(browserSipSettings('wss://omni.seami.cloud/sip', '[]')).toEqual({ wss_url: 'wss://omni.seami.cloud/sip', ice_servers: [] });
  });
  it('TURN credentials are parsed as structured ICE configuration, not URL query credentials', () => {
    expect(browserSipSettings('wss://omni.seami.cloud/sip', '[{"urls":"turns:turn.example:5349","username":"synthetic","credential":"synthetic"}]').ice_servers).toHaveLength(1);
    expect(() => browserSipSettings('wss://omni.seami.cloud/sip?token=private', '[]')).toThrow();
  });
  it('cross-origin and absent-origin session creation are rejected', () => {
    expect(() => checkVideoOrigin(undefined, 'https://omni.seami.cloud')).toThrow();
    expect(() => checkVideoOrigin('https://other.invalid', 'https://omni.seami.cloud')).toThrow();
    expect(() => checkVideoOrigin('https://omni.seami.cloud', 'https://omni.seami.cloud')).not.toThrow();
  });
  it('visitors do not reuse formal extensions, credentials or control tokens', () => {
    const a = issueVisitorIdentity(); const b = issueVisitorIdentity();
    expect(a.username).toMatch(/^video_[a-f0-9]{32}$/);
    expect(a.username).not.toBe(b.username);
    expect(a.password).not.toBe(a.token);
    expect(a.tokenHash).not.toBe(a.token);
    expect(a.password.length).toBeGreaterThanOrEqual(32);
  });
});

it('voice sessions use a separate opaque SIP identity', () => { expect(issueVisitorIdentity(0).username).toMatch(/^voice_[a-f0-9]{32}$/); expect(issueVisitorIdentity(1).username).toMatch(/^video_[a-f0-9]{32}$/); });
