import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ issue: vi.fn(), revoke: vi.fn(), env: {
  VIDEO_CUSTOMER_ENABLED: true, VIDEO_ENTRIES_JSON: '[{"id":"support","label":"Video support","vdnId":1,"accessCode":"7000"}]',
  SIP_REALM: 'cloud.invalid', SIP_WSS_URL: 'wss://omni.seami.cloud/sip', SIP_ICE_SERVERS_JSON: '[]',
  PUBLIC_BASE_URL: 'https://omni.seami.cloud', JWT_SECRET: 'synthetic-secret', SIP_SBC_HOST: 'omni.seami.cloud', SIP_SBC_PORT: 5064,
} }));
vi.mock('../config/env.js', () => ({ env: m.env }));
vi.mock('../modules/video/video-customer.repository.js', () => ({ createVideoLease: m.issue, revokeVideoLease: m.revoke }));
import { videoCustomerRoutes } from '../modules/video/video-customer.routes.js';
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.resetAllMocks(); m.env.VIDEO_CUSTOMER_ENABLED = true;
  m.issue.mockImplementation(async (_entry, _realm, _ip, called: string) => ({ id: 'a'.repeat(32), username: 'video_' + 'a'.repeat(32), password: 'synthetic-password', token: 'b'.repeat(64), expiresAt: '2026-10-13T10:00:00Z', destination: called }));
  app = Fastify(); await app.register(videoCustomerRoutes);
});
afterEach(async () => { await app.close(); });
describe('public video API', () => {
  it('returns only public entry metadata', async () => {
    const r = await app.inject('/public/api/video/entries/support');
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ id: 'support', label: 'Video support' });
    expect(r.headers['cache-control']).toBe('no-store');
  });
  it('cannot issue credentials for a disabled entry', async () => {
    m.env.VIDEO_CUSTOMER_ENABLED = false;
    const r = await app.inject({ method: 'POST', url: '/public/api/video/entries/support/sessions', headers: { origin: m.env.PUBLIC_BASE_URL }, payload: { called: '880000' } });
    expect(r.statusCode).toBe(503); expect(m.issue).not.toHaveBeenCalled();
  });
  it.each([undefined, 'https://other.invalid'])('cross-origin creation has no DB side effect', async origin => {
    const r = await app.inject({ method: 'POST', url: '/public/api/video/entries/support/sessions', headers: origin ? { origin } : {}, payload: { called: '880000' } });
    expect(r.statusCode).toBe(403); expect(m.issue).not.toHaveBeenCalled();
  });
  it('client cannot override VDN or invent the call destination', async () => {
    const extra = await app.inject({ method: 'POST', url: '/public/api/video/entries/support/sessions', headers: { origin: m.env.PUBLIC_BASE_URL }, payload: { called: '880000', vdnId: 2 } });
    expect(extra.statusCode).toBe(400); expect(m.issue).not.toHaveBeenCalled();
    const missing = await app.inject({ method: 'POST', url: '/public/api/video/entries/support/sessions', headers: { origin: m.env.PUBLIC_BASE_URL }, payload: {} });
    expect(missing.statusCode).toBe(400);
    const invalid = await app.inject({ method: 'POST', url: '/public/api/video/entries/support/sessions', headers: { origin: m.env.PUBLIC_BASE_URL }, payload: { called: 'sip:990040' } });
    expect(invalid.statusCode).toBe(400);
  });
  it('issues separate SIP/control identities for the submitted service number', async () => {
    const r = await app.inject({ method: 'POST', url: '/public/api/video/entries/support/sessions', headers: { origin: m.env.PUBLIC_BASE_URL }, payload: { called: '880000' } });
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ destination: '880000', session_token: 'b'.repeat(64), sip: { username: 'video_' + 'a'.repeat(32), web: { wss_url: 'wss://omni.seami.cloud/sip' } } });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(m.issue.mock.calls[0]![2]).toMatch(/^[a-f0-9]{64}$/);
    expect(m.issue.mock.calls[0]![3]).toBe('880000');
    expect(m.issue.mock.calls[0]![4]).toBe(1);
  });
  it('cleanup needs the control capability, not an arbitrary session ID', async () => {
    const denied = await app.inject({ method: 'DELETE', url: '/public/api/video/sessions/' + 'a'.repeat(32), headers: { origin: m.env.PUBLIC_BASE_URL } });
    expect(denied.statusCode).toBe(403); expect(m.revoke).not.toHaveBeenCalled();
    m.env.VIDEO_CUSTOMER_ENABLED = false;
    const ok = await app.inject({ method: 'DELETE', url: '/public/api/video/sessions/' + 'a'.repeat(32), headers: { origin: m.env.PUBLIC_BASE_URL, authorization: 'Bearer ' + 'b'.repeat(64) } });
    expect(ok.statusCode).toBe(200);
    expect(m.revoke).toHaveBeenCalledWith('a'.repeat(32), 'b'.repeat(64));
  });
});

it.each([0, 1])('passes explicit media_type %s to the lease issuer', async media_type => { const r = await app.inject({method:'POST',url:'/public/api/video/entries/support/sessions',headers:{origin:m.env.PUBLIC_BASE_URL},payload:{called:'990000',media_type}}); expect(r.statusCode).toBe(200); expect(m.issue.mock.calls[0]?.[4]).toBe(media_type); });
it.each([-1,2,'voice',null])('rejects invalid media_type %s', async media_type => { const r = await app.inject({method:'POST',url:'/public/api/video/entries/support/sessions',headers:{origin:m.env.PUBLIC_BASE_URL},payload:{called:'990000',media_type}}); expect(r.statusCode).toBe(400); expect(m.issue).not.toHaveBeenCalled(); });

it.each(['bad', null, []])('invalid body does not become a server error', async payload => { const r=await app.inject({method:'POST',url:'/public/api/video/entries/support/sessions',headers:{origin:m.env.PUBLIC_BASE_URL,'content-type':'application/json'},payload:JSON.stringify(payload)}); expect(r.statusCode).toBe(400); expect(m.issue).not.toHaveBeenCalled(); });
