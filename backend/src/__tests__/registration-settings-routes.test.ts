import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../shared/services/conf-tenancy-sync.js', () => ({ syncVdn: vi.fn(), syncManagedUser: vi.fn() }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => false }));
vi.mock('../config/env.js', () => ({ env: { PLATFORM_SYNC_SECRET: 'registration-sync-secret' } }));
import { createConfRegistrationRoutes } from '../modules/platform_config/conf-registration.routes.js';
const base = '/api/platform-config/conf-registration';
const headers = { 'x-platform-sync-token': 'registration-sync-secret' };
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });
async function fixture() {
  const view = vi.fn().mockResolvedValue({ revision: 1, writable: true });
  const save = vi.fn().mockResolvedValue({ revision: 2 });
  const sendSmsToNumber = vi.fn().mockResolvedValue({ ok: true });
  const sendMail = vi.fn().mockResolvedValue({ accepted: ['recipient@example.com'] });
  const createTransport = vi.fn(() => ({ sendMail, close() {} }));
  const app = Fastify(); apps.push(app);
  await app.register(createConfRegistrationRoutes({
    getConfigRuntime: async () => ({ view, save }) as any,
    getSmsProviderConfig: () => ({ enabled: true, registration_enabled: true, endpoint: 'https://gateway.example.com', headers: { Authorization: 'dedicated-secret' }, registration_template_id: 'otp', registration_notice_template_id: 'notice' }),
    getSmtpConfig: async () => ({ enabled: true, host: 'smtp.example.com', port: 587, security: 'starttls', username: 'sender@example.com', password: 'secret' }), sendSmsToNumber, createTransport,
  }));
  return { app, view, save, sendSmsToNumber, sendMail, createTransport };
}
describe('registration settings administration routes', () => {
  it.each([['GET','config'],['PUT','config'],['POST','test']])('requires service token for %s %s', async (method, path) => {
    const f = await fixture(); const r = await f.app.inject({ method: method as any, url: `${base}/${path}`, headers: { authorization: 'Bearer user' }, ...(method === 'GET' ? {} : { payload: {} }) });
    expect(r.statusCode).toBe(401); expect(f.view).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
  });
  it('returns only runtime redacted view with no-store', async () => { const f = await fixture(); const r = await f.app.inject({ url: `${base}/config`, headers }); expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ revision: 1, writable: true }); expect(r.headers['cache-control']).toBe('no-store'); });
  it('persists the submitted settings and preserves the conflict status', async () => { const f = await fixture(); const r = await f.app.inject({ method: 'PUT', url: `${base}/config`, headers, payload: { revision: 1 } }); expect(r.statusCode).toBe(200); expect(f.save).toHaveBeenCalledWith({ revision: 1 }); f.save.mockRejectedValueOnce(Object.assign(Error('secret'), { statusCode: 409 })); const conflict = await f.app.inject({ method: 'PUT', url: `${base}/config`, headers, payload: {} }); expect(conflict.statusCode).toBe(409); expect(conflict.body).not.toContain('secret'); });
  it('tests saved dedicated SMS configuration using server-generated code', async () => { const f = await fixture(); const r = await f.app.inject({ method: 'POST', url: `${base}/test`, headers, payload: { channel: 'sms', purpose: 'verification', to: '13800138000' } }); expect(r.statusCode).toBe(200); expect(f.sendSmsToNumber).toHaveBeenCalledWith(0, '13800138000', expect.any(String), expect.objectContaining({ providerTemplateId: 'otp', registrationConfig: expect.objectContaining({ headers: { Authorization: 'dedicated-secret' } }), templateParameters: { code: expect.stringMatching(/^\d{6}$/) } })); expect(r.body).not.toContain('dedicated-secret'); });
  it('tests email through required STARTTLS with the saved password', async () => { const f = await fixture(); const r = await f.app.inject({ method: 'POST', url: `${base}/test`, headers, payload: { channel: 'email', purpose: 'approved', to: 'recipient@example.com' } }); expect(r.statusCode).toBe(200); expect(f.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, auth: { user: 'sender@example.com', pass: 'secret' } })); });
  it('rejects arbitrary test content, recipients and repeated sends', async () => { const f = await fixture(); for (const patch of [{ content: 'bad' }, { to: 'bad' }, { code: '123456' }]) { const r = await f.app.inject({ method: 'POST', url: `${base}/test`, headers, payload: { channel: 'sms', purpose: 'verification', to: '13800138000', ...patch } }); expect(r.statusCode).toBe(400); } for (let i=0; i<2; i++) { const r = await f.app.inject({ method:'POST', url:`${base}/test`, headers, payload:{channel:'sms',purpose:'verification',to:'13800138000'} }); expect(r.statusCode).toBe(i ? 429 : 200); } expect(f.sendSmsToNumber).toHaveBeenCalledTimes(1); });
});
it('returns a specific allowlisted config error without returning input secrets', async () => {
  const { RegistrationConfigError } = await import('../shared/services/registration-config.js');
  const f = await fixture(); f.save.mockRejectedValueOnce(new RegistrationConfigError('private-password',400,'SMS_ACCESS_KEY_SECRET_REQUIRED'));
  const r = await f.app.inject({method:'PUT',url:base+'/config',headers,payload:{}});
  expect(r.statusCode).toBe(400); expect(r.json().error_code).toBe('SMS_ACCESS_KEY_SECRET_REQUIRED'); expect(r.body).not.toContain('private-password');
  f.save.mockRejectedValueOnce(new RegistrationConfigError('private-password',400,'PRIVATE_SECRET_UNKNOWN'));
  const unknown = await f.app.inject({method:'PUT',url:base+'/config',headers,payload:{}});
  expect(unknown.body).not.toContain('PRIVATE_SECRET_UNKNOWN');
});
it('exposes a safe Aliyun business error code on a test send',async()=>{
  const f=await fixture(); f.sendSmsToNumber.mockResolvedValueOnce({ok:false,error:'ALIYUN_TEMPLATE_INVALID'} as any);
  const r=await f.app.inject({method:'POST',url:base+'/test',headers,payload:{channel:'sms',purpose:'verification',to:'13800138000'}});
  expect(r.statusCode).toBe(502);expect(r.json().error_code).toBe('ALIYUN_TEMPLATE_INVALID');
});
