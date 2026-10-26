import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ config: null as Record<string, unknown> | null, channel: null as Record<string, unknown> | null }));
vi.mock('../../plugins/db.js', () => ({ prisma: { channel_twilio_sms: { findFirst: async () => null }, channel_sms: { findFirst: async () => deps.channel } } }));
vi.mock('../../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => true }));
vi.mock('../../shared/services/sms-provider.js', () => ({ getSmsProviderConfig: () => deps.config }));
import { phoneDelivery, phoneReadiness } from '../../modules/auth/phone-auth.delivery.js';
let server: http.Server, endpoint = '', status = 200;
let received: Record<string, unknown> | null = null;
let receivedPath = '';
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    receivedPath = req.url ?? '';
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(status === 200 ? { accepted: true } : { private: 'provider-error-with-123456-and-credentials' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/verification`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => { deps.config = null; deps.channel = null; received = null; receivedPath = ''; status = 200; delete process.env.OMNI_SMS_LOGIN_ENABLED; });
describe('SMS verification delivery via the existing platform gateway', () => {
  it('requires an explicit verification opt-in and template', async () => {
    expect((await phoneReadiness()).ready).toBe(false);
    deps.config = { endpoint, enabled: true, login_template_id: 'test-verification' };
    expect((await phoneReadiness()).ready).toBe(false);
    deps.config.login_enabled = true;
    expect((await phoneReadiness()).ready).toBe(true);
    process.env.OMNI_SMS_LOGIN_ENABLED = '0';
    expect((await phoneReadiness()).ready).toBe(false);
  });
  it('sends E164 recipient, verification template and six-digit parameters over real local HTTP', async () => {
    deps.config = { endpoint, enabled: true, login_enabled: true, login_template_id: 'test-verification' };
    await phoneDelivery(undefined).send('+8613800000000', '012345');
    expect(received).toMatchObject({ to: '+8613800000000', template_id: 'test-verification', template_params: { code: '012345', minutes: '5' } });
  });
  it('supports a national-format internal gateway without changing the identity phone', async () => {
    deps.config = { endpoint, enabled: true, login_enabled: true, login_template_id: 'test-verification', login_phone_format: 'national' };
    await phoneDelivery(undefined).send('+8613800000000', '012345');
    expect(received?.to).toBe('13800000000');
  });
  it('ignores supervisor-maintained channel endpoints when delivering an authentication secret', async () => {
    deps.config = { endpoint, enabled: true, login_enabled: true, login_template_id: 'test-verification' };
    deps.channel = { provider_config: { url: endpoint + '/unapproved-channel' }, phone_number: 'business-sender' };
    await phoneDelivery(undefined).send('+8613800000000', '012345');
    expect(receivedPath).toBe('/verification');
  });
  it('does not expose provider bodies containing codes or credentials', async () => {
    deps.config = { endpoint, enabled: true, login_enabled: true, login_template_id: 'test-verification' }; status = 503;
    await expect(phoneDelivery(undefined).send('+8613800000000', '123456')).rejects.toMatchObject({ statusCode: 502, message: '短信验证码发送失败' });
  });
});
