import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the actual requireConfSync; its unrelated tenancy implementations never load a DB.
vi.mock('../shared/services/conf-tenancy-sync.js', () => ({ syncVdn: vi.fn(), syncManagedUser: vi.fn() }));
vi.mock('../shared/services/conf-tenancy.js', () => ({ confTenancyEnabled: () => false }));
vi.mock('../config/env.js', () => ({ env: { PLATFORM_SYNC_SECRET: 'registration-sync-secret' } }));
vi.mock('../shared/services/registration-config-runtime.js', async () => {
  const { env } = await import('../config/env.js');
  return { registrationConfigRuntime: { resolve: async () => ({ sms: null, email: { host: env.SMTP_HOST, port: env.SMTP_PORT, username: env.SMTP_USERNAME, password: env.SMTP_PASSWORD, fromEmail: process.env.CONF_ADMIN_FROM_EMAIL } }) } };
});
import { env } from '../config/env.js';
import { createConfRegistrationRoutes, type ConfRegistrationSmtpConfig } from '../modules/platform_config/conf-registration.routes.js';
import type { SmsProviderConfig } from '../shared/services/sms-provider.js';

const base = '/api/platform-config/conf-registration';
const headers = { 'x-platform-sync-token': 'registration-sync-secret' };
const brand = '细语全媒体智能客服平台';
const privateFailure = 'secret-password smtp://private.host otp=123456 recipient@example.com';
let apps: FastifyInstance[] = [];
const smsConfig = () => ({
  endpoint: 'https://sms.example.com/send', enabled: true,
  registration_enabled: true, registration_template_id: 'registration-otp',
  registration_notice_template_id: 'registration-notice', login_template_id: 'login-only',
});
const smtpConfig = () => ({ host: 'smtp.example.com', port: 465, username: 'sender@example.com', password: 'private-password' });

async function fixture() {
  let sms: SmsProviderConfig | null = smsConfig();
  let smtp: ConfRegistrationSmtpConfig = smtpConfig();
  const sendSmsToNumber = vi.fn().mockResolvedValue({ ok: true });
  const sendMail = vi.fn().mockResolvedValue({ accepted: ['recipient@example.com'], rejected: [] });
  const close = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail, close }));
  const getSmsProviderConfig = vi.fn(() => sms);
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(createConfRegistrationRoutes({
    getSmsProviderConfig, getSmtpConfig: () => smtp, sendSmsToNumber, createTransport,
  }));
  await app.ready();
  return {
    app, sendSmsToNumber, sendMail, createTransport, close, getSmsProviderConfig,
    setSms: (value: SmsProviderConfig | null) => { sms = value; },
    setSmtp: (value: typeof smtp) => { smtp = value; },
    deliver: async (payload: unknown) => app.inject({ method: 'POST', url: `${base}/deliver`, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) }),
    readiness: () => app.inject({ url: `${base}/readiness`, headers }),
  };
}

beforeEach(() => { env.PLATFORM_SYNC_SECRET = 'registration-sync-secret'; });
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(apps.map(app => app.close()));
  apps = [];
});

describe('bounded Conf registration delivery', () => {
  it.each([undefined, 'wrong-token', 'a'.repeat(24)])('rejects missing/wrong sync token %s, even with a client bearer token', async token => {
    const f = await fixture();
    for (const method of ['GET', 'POST'] as const) {
      const result = await f.app.inject({ method, url: `${base}/${method === 'GET' ? 'readiness' : 'deliver'}`,
        headers: { authorization: 'Bearer client-jwt', ...(token ? { 'x-platform-sync-token': token } : {}) },
        ...(method === 'POST' ? { payload: { purpose: 'verification', channel: 'sms', to: '+8613800138000', code: '123456' } } : {}),
      });
      expect(result.statusCode).toBe(401);
      expect(result.json()).toEqual({ error: 'Unauthorized' });
    }
    expect(f.getSmsProviderConfig).not.toHaveBeenCalled();
    expect(f.sendSmsToNumber).not.toHaveBeenCalled();
  });

  it('fails closed and sanitizes missing sync configuration', async () => {
    const f = await fixture();
    env.PLATFORM_SYNC_SECRET = '';
    const result = await f.readiness();
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({ error: 'Registration delivery unavailable' });
    expect(f.getSmsProviderConfig).not.toHaveBeenCalled();
  });

  it('exposes only readiness booleans, without sending', async () => {
    const f = await fixture();
    const result = await f.readiness();
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ sms: true, email: true, ready: true });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(f.sendMail).not.toHaveBeenCalled();
    expect(f.createTransport).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { ...smsConfig(), enabled: false }, { ...smsConfig(), registration_enabled: false },
    { ...smsConfig(), registration_enabled: 'true' }, { ...smsConfig(), registration_template_id: '' },
    { ...smsConfig(), registration_notice_template_id: '' }, { ...smsConfig(), endpoint: '' },
    { ...smsConfig(), endpoint: 'file:///tmp/sms' }, { ...smsConfig(), endpoint: 'https://' },
  ])('does not claim SMS readiness from incomplete or login-only config %#', async config => {
    const f = await fixture();
    f.setSms(config as SmsProviderConfig | null);
    expect((await f.readiness()).json()).toEqual({ sms: false, email: true, ready: false });
  });

  it.each([
    { ...smtpConfig(), host: '' }, { ...smtpConfig(), host: 'localhost' },
    { ...smtpConfig(), host: '127.0.0.1' }, { ...smtpConfig(), host: '::1' },
    { ...smtpConfig(), username: '' }, { ...smtpConfig(), username: 'smtp-user' },
    { ...smtpConfig(), fromEmail: 'invalid', username: 'valid@example.com' },
    { ...smtpConfig(), fromEmail: 'sender@example.com\r\nBcc: other@example.com' },
    { ...smtpConfig(), port: 0 },
  ])('does not claim email readiness from defaults or an invented sender %#', async smtp => {
    const f = await fixture();
    f.setSmtp(smtp);
    expect((await f.readiness()).json()).toEqual({ sms: true, email: false, ready: false });
    expect(f.createTransport).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])('requires a nonblank SMTP password when a username is configured (%j)', async password => {
    const f = await fixture();
    for (const fromEmail of [undefined, 'explicit@example.com']) {
      f.setSmtp({ ...smtpConfig(), password, fromEmail });
      expect((await f.readiness()).json()).toEqual({ sms: true, email: false, ready: false });
      const result = await f.deliver({ purpose: 'verification', channel: 'email', to: 'recipient@example.com', code: '123456' });
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual({ error: 'Registration delivery unavailable' });
    }
    expect(f.createTransport).not.toHaveBeenCalled();
    expect(f.sendMail).not.toHaveBeenCalled();
  });

  it.each([undefined, ''])('allows a relay without SMTP username/password and with an explicit sender (%j)', async username => {
    const f = await fixture();
    f.setSmtp({ ...smtpConfig(), username, password: undefined, fromEmail: 'relay@example.com' });
    expect((await f.readiness()).json()).toEqual({ sms: true, email: true, ready: true });
    const result = await f.deliver({ purpose: 'approved', channel: 'email', to: 'recipient@example.com' });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ success: true });
    expect(f.createTransport).toHaveBeenCalledWith(expect.not.objectContaining({ auth: expect.anything() }));
    expect(f.sendMail.mock.calls[0][0].from).toEqual({ name: brand, address: 'relay@example.com' });
  });

  it('allows an explicit sender with a non-email SMTP login', async () => {
    const f = await fixture();
    f.setSmtp({ ...smtpConfig(), username: 'smtp-user', fromEmail: 'explicit@example.com' });
    expect((await f.readiness()).json()).toEqual({ sms: true, email: true, ready: true });
    const result = await f.deliver({ purpose: 'verification', channel: 'email', to: 'recipient@example.com', code: '654321' });
    expect(result.statusCode).toBe(200);
    expect(f.sendMail.mock.calls[0][0].from).toEqual({ name: brand, address: 'explicit@example.com' });
  });

  it('uses the runtime explicit SMTP sender through the default configuration dependency', async () => {
    Object.assign(env, { SMTP_HOST: 'smtp.example.com', SMTP_PORT: 587, SMTP_USERNAME: 'relay-user', SMTP_PASSWORD: 'runtime-password' });
    vi.stubEnv('CONF_ADMIN_FROM_EMAIL', 'runtime-sender@example.com');
    const sendMail = vi.fn().mockResolvedValue({ accepted: ['recipient@example.com'] });
    const close = vi.fn();
    const createTransport = vi.fn(() => ({ sendMail, close }));
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(createConfRegistrationRoutes({ getSmsProviderConfig: smsConfig, createTransport }));
    const result = await app.inject({ method: 'POST', url: `${base}/deliver`, headers,
      payload: { purpose: 'approved', channel: 'email', to: 'recipient@example.com' },
    });
    expect(result.json()).toEqual({ success: true });
    expect(sendMail.mock.calls[0][0].from).toEqual({ name: brand, address: 'runtime-sender@example.com' });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, auth: { user: 'relay-user', pass: 'runtime-password' } }));
  });

  it.each([
    { purpose: 'other', channel: 'sms', to: '13800138000' },
    { purpose: 'verification', channel: 'push', to: '13800138000', code: '123456' },
    { purpose: 'verification', channel: 'sms', to: '13800138000' },
    ...['12345', '1234567', '１２３４５６', 123456].map(code => ({ purpose: 'verification', channel: 'sms', to: '13800138000', code })),
    ...['submitted', 'approved', 'rejected', 'disabled'].map(purpose => ({ purpose, channel: 'sms', to: '13800138000', code: '123456' })),
    ...['url', 'subject', 'message', 'content', 'password', 'credentials', 'template_id'].map(key => ({ purpose: 'verification', channel: 'sms', to: '13800138000', code: '123456', [key]: privateFailure })),
    { purpose: 'verification', channel: 'email', to: 'invalid', code: '123456' },
    { purpose: 'verification', channel: 'email', to: 'one@example.com,two@example.com', code: '123456' },
    { purpose: 'verification', channel: 'email', to: 'one@example.com\r\nBcc: two@example.com', code: '123456' },
    { purpose: 'verification', channel: 'sms', to: 'https://private.host', code: '123456' },
    { purpose: 'verification', channel: 'sms', to: '1'.repeat(1000), code: '123456' },
  ])('rejects invalid or unbounded body %# before sending', async payload => {
    const f = await fixture();
    const result = await f.deliver(payload);
    expect(result.statusCode).toBe(400);
    expect(result.json()).toEqual({ error: 'Invalid registration delivery' });
    expect(f.sendSmsToNumber).not.toHaveBeenCalled();
    expect(f.sendMail).not.toHaveBeenCalled();
  });

  it('sanitizes parser failures and enforces a small request limit', async () => {
    const f = await fixture();
    for (const [payload, status] of [['{"code":"123456",', 400], [JSON.stringify({ content: privateFailure.repeat(100) }), 413]] as const) {
      const result = await f.app.inject({ method: 'POST', url: `${base}/deliver`, headers: { ...headers, 'content-type': 'application/json' }, payload });
      expect(result.statusCode).toBe(status);
      expect(result.json()).toEqual({ error: 'Invalid registration delivery' });
    }
  });

  it('awaits the platform-only SMS provider and uses a dedicated OTP template', async () => {
    const f = await fixture();
    let resolve!: (value: { ok: boolean }) => void;
    let started!: () => void;
    const sending = new Promise<void>(done => { started = done; });
    f.sendSmsToNumber.mockImplementation(() => { started(); return new Promise(done => { resolve = done; }); });
    let completed = false;
    const result = f.deliver({ purpose: 'verification', channel: 'sms', to: '+8613800138000', code: '123456' }).then(value => { completed = true; return value; });
    await sending;
    expect(completed).toBe(false);
    expect(f.sendSmsToNumber).toHaveBeenCalledWith(0, '+8613800138000', expect.stringContaining(brand), {
      providerTemplateId: 'registration-otp', registrationConfig: smsConfig(), templateParameters: { code: '123456' }, platformOnly: true, timeoutMs: 8000,
    });
    resolve({ ok: true });
    expect((await result).json()).toEqual({ success: true });
    expect((await result).body).not.toContain('123456');
  });

  it.each(['submitted', 'approved', 'rejected', 'disabled'] as const)('sends only static %s notices with the notice template', async purpose => {
    const f = await fixture();
    expect((await f.deliver({ purpose, channel: 'sms', to: '13800138000' })).statusCode).toBe(200);
    const [, , text, options] = f.sendSmsToNumber.mock.calls[0];
    expect(text).toContain(brand);
    expect(text).not.toMatch(/密码|password|https?:/i);
    expect(options.providerTemplateId).toBe('registration-notice');
    if (purpose === 'submitted') {
      expect(text).toContain('注册申请已提交');
      expect(text).toContain('三天内');
      expect(text).toContain('短信、邮箱');
    }
    expect((await f.deliver({ purpose, channel: 'email', to: 'recipient@example.com' })).statusCode).toBe(200);
    expect(f.sendMail.mock.calls[0][0].text).toBe(text);
  });

  it('awaits real SMTP acceptance and applies eight-second transport limits', async () => {
    const f = await fixture();
    let resolve!: (value: { accepted: string[] }) => void;
    let started!: () => void;
    const sending = new Promise<void>(done => { started = done; });
    f.sendMail.mockImplementation(() => { started(); return new Promise(done => { resolve = done; }); });
    let completed = false;
    const result = f.deliver({ purpose: 'verification', channel: 'email', to: 'recipient@example.com', code: '654321' }).then(value => { completed = true; return value; });
    await sending;
    expect(completed).toBe(false);
    expect(f.createTransport).toHaveBeenCalledWith({ host: 'smtp.example.com', port: 465, secure: true,
      auth: { user: 'sender@example.com', pass: 'private-password' }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000,
    });
    expect(f.sendMail.mock.calls[0][0]).toEqual({ from: { name: brand, address: 'sender@example.com' }, to: 'recipient@example.com',
      subject: `${brand}注册验证码`, text: expect.stringContaining('654321'),
    });
    resolve({ accepted: ['recipient@example.com'] });
    expect((await result).json()).toEqual({ success: true });
    expect(f.close).toHaveBeenCalledOnce();
  });

  it.each([[], ['someone-else@example.com'], undefined])('rejects SMTP sends without acceptance of the intended recipient %#', async accepted => {
    const f = await fixture();
    f.sendMail.mockResolvedValue({ accepted, rejected: [] });
    const result = await f.deliver({ purpose: 'approved', channel: 'email', to: 'recipient@example.com' });
    expect(result.statusCode).toBe(502);
    expect(result.json()).toEqual({ error: 'Registration delivery failed' });
    expect(f.close).toHaveBeenCalledOnce();
  });

  it.each(['sms', 'email'] as const)('sanitizes %s provider exceptions and failures', async channel => {
    const f = await fixture();
    const payload = { purpose: 'verification', channel, to: channel === 'sms' ? '13800138000' : 'recipient@example.com', code: '123456' };
    const send = channel === 'sms' ? f.sendSmsToNumber : f.sendMail;
    send.mockRejectedValue(new Error(privateFailure));
    const result = await f.deliver(payload);
    expect(result.statusCode).toBe(502);
    expect(result.json()).toEqual({ error: 'Registration delivery failed' });
    if (channel === 'sms') {
      send.mockResolvedValue({ ok: false, error: privateFailure });
      expect((await f.deliver(payload)).json()).toEqual({ error: 'Registration delivery failed' });
    }
  });

  it.each(['verification', 'approved'] as const)('never falls back to login/default templates for %s', async purpose => {
    const f = await fixture();
    f.setSms({ ...smsConfig(), default_template_id: 'default-only',
      ...(purpose === 'verification' ? { registration_template_id: '' } : { registration_notice_template_id: '' }),
    });
    const result = await f.deliver({ purpose, channel: 'sms', to: '13800138000', ...(purpose === 'verification' ? { code: '123456' } : {}) });
    expect(result.statusCode).toBe(503);
    expect(f.sendSmsToNumber).not.toHaveBeenCalled();
  });

  it('sanitizes configuration and transport-construction failures', async () => {
    const f = await fixture();
    f.getSmsProviderConfig.mockImplementation(() => { throw new Error(privateFailure); });
    expect((await f.readiness()).json()).toEqual({ error: 'Registration delivery unavailable' });
    expect((await f.deliver({ purpose: 'approved', channel: 'sms', to: '13800138000' })).json()).toEqual({ error: 'Registration delivery failed' });
    f.createTransport.mockImplementation(() => { throw new Error(privateFailure); });
    expect((await f.deliver({ purpose: 'approved', channel: 'email', to: 'recipient@example.com' })).json()).toEqual({ error: 'Registration delivery failed' });
  });

  it('fails unavailable channels without fallback or log-only success', async () => {
    const f = await fixture();
    f.setSms({ ...smsConfig(), registration_enabled: false });
    f.setSmtp({ ...smtpConfig(), host: 'localhost' });
    for (const channel of ['sms', 'email']) {
      const result = await f.deliver({ purpose: 'verification', channel, to: channel === 'sms' ? '13800138000' : 'recipient@example.com', code: '123456' });
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual({ error: 'Registration delivery unavailable' });
    }
    expect(f.sendSmsToNumber).not.toHaveBeenCalled();
    expect(f.createTransport).not.toHaveBeenCalled();
  });

  it.each(['sms', 'email'] as const)('bounds an unfinished %s delivery to eight seconds', async channel => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let started!: () => void;
    const sending = new Promise<void>(done => { started = done; });
    const send = channel === 'sms' ? f.sendSmsToNumber : f.sendMail;
    send.mockImplementation(() => { started(); return new Promise(() => {}); });
    let completed = false;
    const result = f.deliver({ purpose: 'verification', channel, to: channel === 'sms' ? '13800138000' : 'recipient@example.com', code: '123456' }).then(value => { completed = true; return value; });
    await sending;
    await vi.advanceTimersByTimeAsync(7999);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).statusCode).toBe(502);
    expect((await result).json()).toEqual({ error: 'Registration delivery failed' });
    if (channel === 'email') expect(f.close).toHaveBeenCalledOnce();
  });
});

describe('global access policy registration',()=>{
 it('delegates exactly the service endpoints to their sync-secret guard',async()=>{
  const {routePolicy}=await import('../modules/access/access.route-policy.js');
  expect(routePolicy('GET',base+'/readiness')?.mode).toBe('external');
  expect(routePolicy('HEAD',base+'/readiness')?.mode).toBe('external');
  expect(routePolicy('POST',base+'/deliver')?.mode).toBe('external');
  for(const [method,path]of [['POST',base+'/readiness'],['GET',base+'/deliver'],['POST',base+'/other'],['GET','/api/platform-config/integrations']])expect(routePolicy(method,path)?.mode).toBe('operator');
 });
});
