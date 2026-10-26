import { describe, expect, it } from 'vitest';
import { createRegistrationConfigRuntime } from '../shared/services/registration-config.js';
const key = Buffer.alloc(32, 7).toString('base64');
const input = (revision = 0) => ({ revision,
  sms: { enabled: true, endpoint: 'https://sms.example.com/send', sign_name: '细语', registration_template_id: 'otp', registration_notice_template_id: 'notice', headers: { Authorization: 'private-token' }, body: { app_secret: 'private-body' } },
  email: { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls', username: 'smtp-user', password: 'private-password', from_email: 'sender@example.com', from_name: '细语' },
});
function fixture(k = key) {
  let row: { value: string; encrypted: boolean } | null = null;
  const repo = { read: async () => row, transaction: async (run: any) => run({ read: async () => row, write: async (next: typeof row) => { row = next; } }) };
  const runtime = createRegistrationConfigRuntime({ repository: repo, key: () => k, legacy: async () => ({ sms: null, email: null }) });
  return { runtime, row: () => row, tamper: () => { row!.value = row!.value.slice(0, -3) + 'bad'; } };
}
describe('registration configuration', () => {
  it('encrypts all credentials and exposes only write-only markers', async () => {
    const f = fixture(); const view = await f.runtime.save(input());
    expect(view.revision).toBe(1); expect(view.source).toBe('managed');
    for (const secret of ['private-token', 'private-body', 'private-password']) { expect(f.row()!.value).not.toContain(secret); expect(JSON.stringify(view)).not.toContain(secret); }
    expect(f.row()!.encrypted).toBe(true); expect(view.sms.headers_configured).toBe(true); expect(view.email.password_configured).toBe(true);
    expect((await f.runtime.resolve()).email?.password).toBe('private-password');
  });
  it('keeps omitted credentials and empty SMTP password; supports explicit clearing while disabled', async () => {
    const f = fixture(); await f.runtime.save(input()); const update = input(1);
    delete (update.sms as any).headers; delete (update.sms as any).body; update.email.password = '';
    await f.runtime.save(update); expect((await f.runtime.resolve()).sms?.headers?.Authorization).toBe('private-token'); expect((await f.runtime.resolve()).email?.password).toBe('private-password');
    await f.runtime.save({ ...update, revision: 2, sms: { ...update.sms, enabled: false, clear_headers: true, clear_body: true }, email: { ...update.email, enabled: false, clear_password: true } });
    const view = await f.runtime.view(); expect(view.sms.headers_configured).toBe(false); expect(view.sms.body_configured).toBe(false); expect(view.email.password_configured).toBe(false);
  });
  it('rejects stale revisions without overwriting', async () => {
    const f = fixture(); await f.runtime.save(input()); await expect(f.runtime.save(input())).rejects.toMatchObject({ statusCode: 409 }); expect((await f.runtime.view()).revision).toBe(1);
  });
  it('fails closed without the encryption key', async () => { const f = fixture(''); expect((await f.runtime.view()).writable).toBe(false); await expect(f.runtime.save(input())).rejects.toMatchObject({ statusCode: 503 }); expect(f.row()).toBeNull(); });
  it('detects tampered encrypted data', async () => { const f = fixture(); await f.runtime.save(input()); f.tamper(); await expect(f.runtime.resolve()).rejects.toMatchObject({ statusCode: 503 }); });
  it.each([
    (v: any) => { v.email.host = 'smtp://private-password@example.com'; },
    (v: any) => { v.email.from_email = 'one@example.com\r\nBcc:other@example.com'; },
    (v: any) => { v.email.password = ''; },
    (v: any) => { v.email.security = 'plain'; },
    (v: any) => { v.sms.endpoint = 'https://user:password@example.com/?token=secret'; },
    (v: any) => { v.sms.endpoint = 'http://public.example.com/send'; },
    (v: any) => { v.sms.headers = { Authorization: 'bad\r\nInjected:yes' }; },
    (v: any) => { v.sms.registration_template_id = ''; },
    (v: any) => { v.actor = 'admin'; },
  ])('rejects invalid settings without disclosing inputs %#', async change => { const f = fixture(); const v = input(); change(v); await expect(f.runtime.save(v)).rejects.toMatchObject({ statusCode: 400 }); expect(f.row()).toBeNull(); });
  it('reads fresh database settings after save with no restart', async () => { const f = fixture(); await f.runtime.save(input()); const v = input(1); v.email.host = 'new.example.com'; await f.runtime.save(v); expect((await f.runtime.resolve()).email?.host).toBe('new.example.com'); });
  it('keeps legacy settings until the first managed save', async () => {
    const f = fixture(); const r = createRegistrationConfigRuntime({ repository: { read: async () => f.row(), transaction: async () => { throw Error('unused'); } }, key: () => key,
      legacy: async () => ({ sms: { enabled: true, registration_enabled: true, endpoint: 'https://sms.example.com', headers: { Authorization: 'legacy-secret' } }, email: { host: 'smtp.example.com', port: 587, username: 'legacy', password: 'legacy-secret', fromEmail: 'sender@example.com' } }) });
    expect((await r.view()).source).toBe('legacy'); expect(JSON.stringify(await r.view())).not.toContain('legacy-secret'); expect((await r.resolve()).email?.username).toBe('legacy');
  });
});


describe('Aliyun registration settings', () => {
  const aliyun = (revision = 0): any => ({ ...input(revision), sms: {
    enabled: true, provider: 'aliyun', endpoint: 'dysmsapi.aliyuncs.com',
    sign_name: '细语', registration_template_id: 'SMS_12345', registration_notice_template_id: 'SMS_67890',
    access_key_id: 'LTAI-synthetic-id', access_key_secret: 'synthetic-aliyun-secret',
  } });
  it('normalizes the Aliyun hostname and encrypts both credentials without returning them', async () => {
    const f = fixture(); const view = await f.runtime.save(aliyun());
    expect(view.sms).toMatchObject({ provider: 'aliyun', endpoint: 'https://dysmsapi.aliyuncs.com/', access_key_id_configured: true, access_key_secret_configured: true });
    for (const value of ['LTAI-synthetic-id', 'synthetic-aliyun-secret']) {
      expect(JSON.stringify(view)).not.toContain(value); expect(f.row()!.value).not.toContain(value);
    }
    expect((await f.runtime.resolve()).sms).toMatchObject({ access_key_id: 'LTAI-synthetic-id', access_key_secret: 'synthetic-aliyun-secret' });
    expect(view.readiness.sms).toBe(true);
  });
  it('keeps blank credentials on edit and requires a new secret if the AccessKey ID changes', async () => {
    const f = fixture(); await f.runtime.save(aliyun());
    const edit = aliyun(1); edit.sms.access_key_id = ''; edit.sms.access_key_secret = '';
    await f.runtime.save(edit);
    expect((await f.runtime.resolve()).sms?.access_key_secret).toBe('synthetic-aliyun-secret');
    const changed = aliyun(2); changed.sms.access_key_id = 'other-id'; delete changed.sms.access_key_secret;
    await expect(f.runtime.save(changed)).rejects.toMatchObject({ statusCode: 400, code: 'SMS_ACCESS_KEY_SECRET_REQUIRED' });
  });
  it.each([
    ['SMS_ACCESS_KEY_ID_REQUIRED', (x: any) => { delete x.sms.access_key_id; }],
    ['SMS_ACCESS_KEY_SECRET_REQUIRED', (x: any) => { delete x.sms.access_key_secret; }],
    ['SMS_SIGN_REQUIRED', (x: any) => { x.sms.sign_name = ''; }],
    ['SMS_ALIYUN_ENDPOINT_INVALID', (x: any) => { x.sms.endpoint = 'https://attacker.example/'; }],
    ['SMS_TEMPLATE_INVALID', (x: any) => { x.sms.registration_template_id = 'template'; }],
  ])('rejects invalid Aliyun configuration with safe code %s', async (code, change) => {
    const f = fixture(); const x = aliyun(); (change as Function)(x);
    await expect(f.runtime.save(x)).rejects.toMatchObject({ statusCode: 400, code }); expect(f.row()).toBeNull();
  });
  it('explains missing URL scheme and cannot mistake the Aliyun API for a generic gateway', async () => {
    const f = fixture(); const x = input(); x.sms.endpoint = 'sms.example.com/send';
    await expect(f.runtime.save(x)).rejects.toMatchObject({ code: 'SMS_ENDPOINT_INVALID' });
    x.sms.endpoint = 'https://dysmsapi.aliyuncs.com';
    await expect(f.runtime.save(x)).rejects.toMatchObject({ code: 'SMS_ALIYUN_MODE_REQUIRED' });
  });
  it('drops Aliyun credentials when switching to a generic gateway', async () => {
    const f = fixture(); await f.runtime.save(aliyun()); await f.runtime.save(input(1));
    expect((await f.runtime.resolve()).sms).not.toHaveProperty('access_key_secret');
    expect((await f.runtime.resolve()).sms).not.toHaveProperty('access_key_id');
  });
});
