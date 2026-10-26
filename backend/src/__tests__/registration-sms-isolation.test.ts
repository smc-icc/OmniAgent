import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../plugins/db.js', () => ({ prisma: { channel_sms: { findFirst: vi.fn() }, channel_twilio_sms: { findFirst: vi.fn() } } }));
vi.mock('../shared/services/sms-provider.js', () => ({ getSmsProviderConfig: () => ({ enabled: false, endpoint: 'https://business.example.com', headers: { Authorization: 'business-secret' } }) }));
import { sendSmsToNumber } from '../modules/channels/sms/outgoing.js';
import { prisma } from '../plugins/db.js';
import { routePolicy } from '../modules/access/access.route-policy.js';
afterEach(() => vi.unstubAllGlobals());
describe('isolated registration SMS transport', () => {
  it('uses registration endpoint, credentials, signature and template without reading a business channel', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
    const result = await sendSmsToNumber(0, '13800138000', 'test', { platformOnly: true, registrationConfig: { enabled: true, endpoint: 'https://registration.example.com', headers: { Authorization: 'registration-secret' }, sign_name: '细语' }, providerTemplateId: 'otp', templateParameters: { code: '654321' } });
    expect(result.ok).toBe(true); expect(prisma.channel_sms.findFirst).not.toHaveBeenCalled(); expect(prisma.channel_twilio_sms.findFirst).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][0]).toBe('https://registration.example.com');
    const opts = fetch.mock.calls[0][1]; expect(opts.headers.Authorization).toBe('registration-secret'); expect(JSON.parse(opts.body)).toMatchObject({ sign_name: '细语', template_id: 'otp', template_params: { code: '654321' } }); expect(opts.body).not.toContain('business-secret');
  });
  it('fails closed for disabled registration config', async () => { const fetch=vi.fn();vi.stubGlobal('fetch',fetch); expect((await sendSmsToNumber(0,'13800138000','test',{platformOnly:true,registrationConfig:{enabled:false,endpoint:'https://registration.example.com'}})).ok).toBe(false);expect(fetch).not.toHaveBeenCalled(); });
});
describe('exact service-auth route policy', () => {
  it.each([['GET','config'],['HEAD','config'],['PUT','config'],['POST','test'],['GET','readiness'],['POST','deliver']])('delegates only %s %s to the mandatory sync guard', (method,path) => { expect(routePolicy(method,'/api/platform-config/conf-registration/'+path)?.mode).toBe('external'); });
  it.each([['DELETE','config'],['PATCH','config'],['GET','test'],['POST','config'],['GET','config/other']])('keeps unsupported %s %s protected', (method,path) => { expect(routePolicy(method,'/api/platform-config/conf-registration/'+path)?.mode).toBe('operator'); });
});
