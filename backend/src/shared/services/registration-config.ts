import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { SmsProviderConfig } from './sms-provider.js';
export const REGISTRATION_CONFIG_KEY = 'conf_registration_v1';
export interface RegistrationSmtpConfig { host: string; port: number; username?: string; password?: string; fromEmail?: string; fromName?: string; enabled?: boolean; security?: 'tls' | 'starttls' }
export interface RegistrationSettings { sms: SmsProviderConfig | null; email: RegistrationSmtpConfig | null }
export interface RegistrationConfigRow { value: string; encrypted: boolean }
export interface RegistrationConfigTransaction { read(): Promise<RegistrationConfigRow | null>; write(row: RegistrationConfigRow): Promise<void> }
export interface RegistrationConfigRepository { read(): Promise<RegistrationConfigRow | null>; transaction<T>(run: (tx: RegistrationConfigTransaction) => Promise<T>): Promise<T> }
export const REGISTRATION_CONFIG_ERROR_CODES = [
  'SMS_ENDPOINT_INVALID', 'SMS_ALIYUN_ENDPOINT_INVALID', 'SMS_ALIYUN_MODE_REQUIRED',
  'SMS_ACCESS_KEY_ID_REQUIRED', 'SMS_ACCESS_KEY_SECRET_REQUIRED', 'SMS_SIGN_REQUIRED',
  'SMS_TEMPLATE_REQUIRED', 'SMS_TEMPLATE_INVALID', 'SMTP_HOST_INVALID', 'SMTP_CREDENTIALS_REQUIRED', 'SMTP_SENDER_INVALID',
] as const;
export class RegistrationConfigError extends Error {
  constructor(message: string, public statusCode = 400, public code?: string) { super(message); }
}
function invalid(code: typeof REGISTRATION_CONFIG_ERROR_CODES[number]): never {
  throw new RegistrationConfigError('Invalid registration settings', 400, code);
}
export function aliyunSmsEndpoint(endpoint: string) {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && u.hostname === 'dysmsapi.aliyuncs.com'
    && !u.port && u.pathname === '/' && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
}
const text = (max: number) => z.string().max(max).refine(v => !/[\r\n\0]/.test(v));
const headers = z.record(text(2048)).superRefine((v, ctx) => {
  if (Object.keys(v).length > 30 || Object.keys(v).some(k => !/^[!#$%&'*+.^_`|~0-9a-z-]{1,80}$/i.test(k) || /^(host|content-length|connection|transfer-encoding)$/i.test(k))) ctx.addIssue({ code: 'custom', message: 'Invalid headers' });
});
const body = z.record(z.unknown()).refine(v => Buffer.byteLength(JSON.stringify(v)) <= 8192);
const smsSchema = z.object({ provider: z.enum(['generic', 'aliyun']).optional(), access_key_id: text(256).optional(), access_key_secret: text(512).optional(), clear_access_key: z.boolean().optional(), enabled: z.boolean(), endpoint: text(2048), sign_name: text(100), registration_template_id: text(200), registration_notice_template_id: text(200), headers: headers.optional(), body: body.optional(), clear_headers: z.boolean().optional(), clear_body: z.boolean().optional() }).strict();
const emailSchema = z.object({ enabled: z.boolean(), host: text(253), port: z.number().int().min(1).max(65535), security: z.enum(['tls', 'starttls']), username: text(254), password: text(4096).optional(), clear_password: z.boolean().optional(), from_email: text(254), from_name: text(100) }).strict();
const saveSchema = z.object({ revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), sms: smsSchema, email: emailSchema }).strict();
interface Stored { revision: number; sms: SmsProviderConfig; email: RegistrationSmtpConfig }
const emptyEmail = (): RegistrationSmtpConfig => ({ enabled: false, host: '', port: 465, security: 'tls', username: '', password: '', fromEmail: '', fromName: '细语全媒体智能客服平台' });
function keyMaterial(encoded: string): Buffer {
  const raw = encoded.trim(), key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw new RegistrationConfigError('Registration encryption key unavailable', 503);
  return Buffer.from(hkdfSync('sha256', key, 'smc-conf-registration-v1', 'notification-settings', 32));
}
function encrypt(value: Stored, encoded: string): RegistrationConfigRow {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyMaterial(encoded), iv);
  cipher.setAAD(Buffer.from(REGISTRATION_CONFIG_KEY));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { encrypted: true, value: ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.') };
}
function decrypt(row: RegistrationConfigRow, encoded: string): Stored {
  try {
    if (!row.encrypted) throw Error('Unencrypted');
    const [v, iv, tag, data, extra] = row.value.split('.');
    if (v !== 'v1' || !iv || !tag || !data || extra) throw Error('Invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', keyMaterial(encoded), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(REGISTRATION_CONFIG_KEY)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const result = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')) as Stored;
    if (!Number.isSafeInteger(result.revision) || result.revision < 1 || !result.sms || !result.email) throw Error('Invalid settings');
    return result;
  } catch { throw new RegistrationConfigError('Registration configuration unavailable', 503); }
}
function validEndpoint(value: string): boolean {
  try {
    const u = new URL(value), local = /^(localhost|[a-z0-9_-]+)$/i.test(u.hostname) || (isIP(u.hostname) === 4 && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname));
    return !u.username && !u.password && !u.search && !u.hash && (u.protocol === 'https:' || u.protocol === 'http:' && local);
  } catch { return false; }
}
export function registrationReadiness({ sms: s, email: e }: RegistrationSettings) {
  let endpoint = false; try { endpoint = ['http:', 'https:'].includes(new URL(s?.endpoint || '').protocol); } catch { /* empty */ }
  const aliReady = s?.provider !== 'aliyun' || (aliyunSmsEndpoint(s.endpoint || '')
    && !!s.access_key_id?.trim() && !!s.access_key_secret?.trim() && !!s.sign_name?.trim()
    && /^SMS_\d+$/.test(s.registration_template_id || '') && /^SMS_\d+$/.test(s.registration_notice_template_id || ''));
  const sms = !!(s && s.enabled !== false && s.registration_enabled === true && endpoint && aliReady && s.registration_template_id?.trim() && s.registration_notice_template_id?.trim());
  const host = e?.host?.trim().toLowerCase().replace(/\.$/, '') || '', sender = e?.fromEmail ?? e?.username;
  const email = !!(e && e.enabled !== false && host && !/[\s/@\\]/.test(host) && !['localhost', '::1', '[::1]', '0.0.0.0', '::', '[::]'].includes(host) && !host.endsWith('.localhost') && !/^127\./.test(host) && Number.isInteger(e.port) && e.port > 0 && e.port < 65536 && (!e.username || e.password?.trim()) && typeof sender === 'string' && !/[\r\n]/.test(sender) && z.string().email().safeParse(sender).success);
  return { sms, email, ready: sms && email };
}
export function createRegistrationConfigRuntime(deps: { repository: RegistrationConfigRepository; key(): string; legacy(): Promise<RegistrationSettings> }) {
  async function current(row: RegistrationConfigRow | null): Promise<{ value: Stored; source: 'managed' | 'legacy' }> {
    if (row) return { value: decrypt(row, deps.key()), source: 'managed' };
    const old = await deps.legacy();
    return { value: { revision: 0, sms: { ...(old.sms || {}), enabled: old.sms?.registration_enabled === true && old.sms.enabled !== false }, email: old.email ? { ...old.email, enabled: registrationReadiness({ sms: null, email: old.email }).email } : emptyEmail() }, source: 'legacy' };
  }
  function publicView(value: Stored, source: 'managed' | 'legacy') {
    let writable = true; try { keyMaterial(deps.key()); } catch { writable = false; }
    const s = value.sms, e = value.email;
    let endpoint = s.endpoint || ''; // Legacy URLs can contain secrets; never return them.
    try { const u = new URL(endpoint); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; endpoint = u.toString(); } catch { endpoint = ''; }
    return { revision: value.revision, source, writable, readiness: registrationReadiness(value),
      sms: { provider: s.provider === 'aliyun' ? 'aliyun' : 'generic', access_key_id_configured: !!s.access_key_id, access_key_secret_configured: !!s.access_key_secret, enabled: s.enabled !== false && s.registration_enabled === true, endpoint, sign_name: s.sign_name || '', registration_template_id: s.registration_template_id || '', registration_notice_template_id: s.registration_notice_template_id || '', headers_configured: !!s.headers && Object.keys(s.headers).length > 0, body_configured: !!s.body && Object.keys(s.body).length > 0 },
      email: { enabled: e.enabled !== false, host: e.host, port: e.port, security: e.security || (e.port === 465 ? 'tls' : 'starttls'), username: e.username || '', from_email: e.fromEmail ?? e.username ?? '', from_name: e.fromName || '细语全媒体智能客服平台', password_configured: !!e.password } };
  }
  return {
    async resolve(): Promise<RegistrationSettings> { const { value } = await current(await deps.repository.read()); return { sms: value.sms, email: value.email }; },
    async view() { const { value, source } = await current(await deps.repository.read()); return publicView(value, source); },
    async save(raw: unknown) {
      const parsed = saveSchema.safeParse(raw); if (!parsed.success) throw new RegistrationConfigError('Invalid registration settings');
      const input = parsed.data; keyMaterial(deps.key());
      return deps.repository.transaction(async tx => {
        const { value: old } = await current(await tx.read());
        if (input.revision !== old.revision) throw new RegistrationConfigError('Registration configuration changed; reload before saving', 409);
        const s = input.sms, e = input.email;
        const sms: SmsProviderConfig = { provider: s.provider || 'generic', enabled: s.enabled, registration_enabled: s.enabled, endpoint: s.endpoint.trim(), method: 'POST', sign_name: s.sign_name.trim(), registration_template_id: s.registration_template_id.trim(), registration_notice_template_id: s.registration_notice_template_id.trim(), headers: s.clear_headers ? {} : s.headers ?? old.sms.headers ?? {}, body: s.clear_body ? {} : s.body ?? old.sms.body ?? {} };
        const email: RegistrationSmtpConfig = { enabled: e.enabled, host: e.host.trim(), port: e.port, security: e.security, username: e.username.trim(), password: e.clear_password ? '' : e.password || old.email.password || '', fromEmail: e.from_email.trim(), fromName: e.from_name.trim() };
        if (sms.provider === 'aliyun') {
          sms.endpoint = sms.endpoint || 'https://dysmsapi.aliyuncs.com/';
          if (sms.endpoint === 'dysmsapi.aliyuncs.com') sms.endpoint = 'https://dysmsapi.aliyuncs.com/';
          if (!aliyunSmsEndpoint(sms.endpoint)) invalid('SMS_ALIYUN_ENDPOINT_INVALID');
          sms.endpoint = new URL(sms.endpoint).toString();
          const existing = old.sms.provider === 'aliyun' ? old.sms : {};
          sms.access_key_id = s.clear_access_key ? '' : s.access_key_id?.trim() || existing.access_key_id || '';
          sms.access_key_secret = s.clear_access_key ? '' : s.access_key_secret?.trim() || existing.access_key_secret || '';
          if (s.enabled && !sms.access_key_id) invalid('SMS_ACCESS_KEY_ID_REQUIRED');
          if (s.enabled && (!sms.access_key_secret || (!!s.access_key_id?.trim() && s.access_key_id.trim() !== existing.access_key_id && !s.access_key_secret?.trim()))) invalid('SMS_ACCESS_KEY_SECRET_REQUIRED');
          // Arbitrary gateway headers/bodies must never travel to the signed Aliyun endpoint.
          sms.headers = {}; sms.body = {};
          if (s.enabled && !sms.sign_name) invalid('SMS_SIGN_REQUIRED');
          if (s.enabled && (!/^SMS_\d+$/.test(sms.registration_template_id || '') || !/^SMS_\d+$/.test(sms.registration_notice_template_id || ''))) invalid('SMS_TEMPLATE_INVALID');
        } else {
          if (sms.endpoint && !validEndpoint(sms.endpoint)) invalid('SMS_ENDPOINT_INVALID');
          try { if (new URL(sms.endpoint || '').hostname === 'dysmsapi.aliyuncs.com') invalid('SMS_ALIYUN_MODE_REQUIRED'); } catch (error) { if (error instanceof RegistrationConfigError) throw error; }
        }
        if (s.enabled && (!sms.registration_template_id || !sms.registration_notice_template_id)) invalid('SMS_TEMPLATE_REQUIRED');
        if (s.enabled && !sms.endpoint) invalid('SMS_ENDPOINT_INVALID');
        if (email.host && !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\])$/i.test(email.host)) invalid('SMTP_HOST_INVALID');
        if (e.enabled) {
          if (!email.username || !email.password?.trim()) invalid('SMTP_CREDENTIALS_REQUIRED');
          if (!z.string().email().safeParse(email.fromEmail).success) invalid('SMTP_SENDER_INVALID');
          if (!registrationReadiness({sms: null, email}).email) invalid('SMTP_HOST_INVALID');
        }
        const value = { revision: old.revision + 1, sms, email }; await tx.write(encrypt(value, deps.key())); return publicView(value, 'managed');
      });
    },
  };
}
export type RegistrationConfigRuntime = ReturnType<typeof createRegistrationConfigRuntime>;
