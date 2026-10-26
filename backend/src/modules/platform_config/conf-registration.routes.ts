import { REGISTRATION_CONFIG_ERROR_CODES, RegistrationConfigError, registrationReadiness } from '../../shared/services/registration-config.js';
import { ALIYUN_SMS_ERROR_CODES } from '../../shared/services/aliyun-sms.js';
import type { FastifyError, FastifyInstance } from 'fastify';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import type { RegistrationConfigRuntime } from '../../shared/services/registration-config.js';
import type { SmsProviderConfig } from '../../shared/services/sms-provider.js';
import type { sendSmsToNumber } from '../channels/sms/outgoing.js';
import { requireConfSync } from './conf-tenancy-sync.js';

const BRAND = '细语全媒体智能客服平台';
const TIMEOUT_MS = 8000;
const BASE = '/api/platform-config/conf-registration';
const notices = {
  submitted: '您的注册申请已提交，三天内将通过短信、邮箱进行通知，请注意查收。',
  approved: '您的注册申请已审核通过。',
  rejected: '您的注册申请未通过审核。',
  disabled: '您的管理账号已停用。',
} as const;
const recipient = z.string().min(1).max(254);
const deliverySchema = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('verification'), channel: z.enum(['sms', 'email']), to: recipient, code: z.string().regex(/^[0-9]{6}$/) }).strict(),
  z.object({ purpose: z.enum(['submitted', 'approved', 'rejected', 'disabled']), channel: z.enum(['sms', 'email']), to: recipient }).strict(),
]).superRefine((body, ctx) => {
  const valid = body.channel === 'email' ? z.string().email().safeParse(body.to).success : /^\+?[1-9][0-9]{7,14}$/.test(body.to);
  if (!valid || /[\r\n]/.test(body.to)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid recipient' });
});

export type ConfRegistrationDelivery = z.infer<typeof deliverySchema>;
export interface ConfRegistrationReadiness { sms: boolean; email: boolean; ready: boolean }
export interface ConfRegistrationSmtpConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  fromEmail?: string;
  fromName?: string;
  enabled?: boolean;
  security?: 'tls' | 'starttls';
}
interface TransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}
interface RegistrationTransport {
  sendMail(mail: SendMailOptions): Promise<{ accepted?: unknown[] }>;
  close(): void;
}
export interface ConfRegistrationDependencies {
  getSmsProviderConfig(): SmsProviderConfig | null | Promise<SmsProviderConfig | null>;
  getSmtpConfig(): ConfRegistrationSmtpConfig | Promise<ConfRegistrationSmtpConfig>;
  getConfigRuntime(): Promise<Pick<RegistrationConfigRuntime, 'view' | 'save'>>;
  sendSmsToNumber: typeof sendSmsToNumber;
  createTransport(options: TransportOptions): RegistrationTransport;
}

// Lazy provider imports keep focused tests independent of Prisma initialization.
const defaults: ConfRegistrationDependencies = {
  getSmsProviderConfig: async () => (await (await import('../../shared/services/registration-config-runtime.js')).registrationConfigRuntime.resolve()).sms,
  sendSmsToNumber: async (...args) => (await import('../channels/sms/outgoing.js')).sendSmsToNumber(...args),
  getSmtpConfig: async () => (await (await import('../../shared/services/registration-config-runtime.js')).registrationConfigRuntime.resolve()).email || { host: '', port: 465, enabled: false },
  getConfigRuntime: async () => (await import('../../shared/services/registration-config-runtime.js')).registrationConfigRuntime,
  createTransport: options => nodemailer.createTransport(options),
};

function smsReady(config: SmsProviderConfig | null, purpose?: ConfRegistrationDelivery['purpose']): boolean {
  if (config?.enabled === false || config?.registration_enabled !== true) return false;
  if (config.provider === 'aliyun' && !registrationReadiness({sms: config, email: null}).sms) return false;
  try {
    const endpoint = new URL(config.endpoint ?? '');
    if (!['http:', 'https:'].includes(endpoint.protocol)) return false;
  } catch { return false; }
  const hasTemplate = (value: unknown) => typeof value === 'string' && !!value.trim();
  if (purpose === 'verification') return hasTemplate(config.registration_template_id);
  if (purpose) return hasTemplate(config.registration_notice_template_id);
  return hasTemplate(config.registration_template_id) && hasTemplate(config.registration_notice_template_id);
}

function smtpSender(config: ConfRegistrationSmtpConfig): string | null {
  if (config.enabled === false) return null;
  if (config.username && (typeof config.password !== 'string' || !config.password.trim())) return null;
  const host = config.host.trim().toLowerCase().replace(/\.$/, '');
  if (!host || /[\s/@\\]/.test(host) || ['localhost', '::1', '[::1]', '0.0.0.0', '::', '[::]'].includes(host) ||
      host.endsWith('.localhost') || /^127\./.test(host) || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) return null;
  // An explicitly configured sender must be valid; never synthesize one from a hostname.
  const from = config.fromEmail ?? config.username;
  return typeof from === 'string' && !/[\r\n]/.test(from) && z.string().email().safeParse(from).success ? from : null;
}

async function withTimeout<T>(send: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Delivery timeout')), TIMEOUT_MS); }),
      Promise.resolve().then(send),
    ]);
  } finally { clearTimeout(timer); }
}

/** Internal bounded delivery only: authorization cannot be replaced through dependency injection. */
export function createConfRegistrationRoutes(overrides: Partial<ConfRegistrationDependencies> = {}) {
  const deps: ConfRegistrationDependencies = { ...defaults, ...overrides };
  return async function confRegistrationRoutes(app: FastifyInstance) {
    app.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!requireConfSync(request, reply)) return;
    });
    // Includes authentication, JSON parser, size-limit and provider failures. Never echo input/config.
    app.addHook('onSend', async (_request, reply, payload) => {
      if (reply.statusCode < 400) return payload;
      const error = reply.statusCode === 401 ? 'Unauthorized'
        : [400, 413, 415].includes(reply.statusCode) ? 'Invalid registration delivery'
        : reply.statusCode === 503 ? 'Registration delivery unavailable' : 'Registration delivery failed';
      let code: unknown;
      try { code = JSON.parse(String(payload)).error_code; } catch { /* parser/transport errors stay generic */ }
      const codes: readonly string[] = [...REGISTRATION_CONFIG_ERROR_CODES, ...ALIYUN_SMS_ERROR_CODES];
      return JSON.stringify({ error, ...(typeof code === 'string' && codes.includes(code) ? { error_code: code } : {}) });
    });
    app.setErrorHandler<FastifyError>((error, _request, reply) => {
      const status = error.statusCode && [400, 413, 415].includes(error.statusCode) ? error.statusCode : 500;
      return reply.code(status).send({ error: 'Registration delivery failed' });
    });

    app.get<{ Reply: ConfRegistrationReadiness | { error: string } }>(`${BASE}/readiness`, async (_request, reply) => {
      try {
        const sms = smsReady(await deps.getSmsProviderConfig());
        const email = smtpSender(await deps.getSmtpConfig()) !== null;
        return { sms, email, ready: sms && email };
      } catch { return reply.code(503).send({ error: 'Registration delivery unavailable' }); }
    });

    async function deliver(body: ConfRegistrationDelivery, reply: import('fastify').FastifyReply, isTest = false) {
      const text = (isTest ? '【测试】' : '') + (body.purpose === 'verification'
        ? `【${BRAND}】您的注册验证码为 ${body.code}，请勿向他人提供验证码。`
        : `【${BRAND}】${notices[body.purpose]}`);
      try {
        if (body.channel === 'sms') {
          const config = await deps.getSmsProviderConfig();
          if (!smsReady(config, body.purpose)) return reply.code(503).send({ error: 'Registration delivery unavailable' });
          const result = await withTimeout(() => deps.sendSmsToNumber(0, body.to, text, {
            providerTemplateId: body.purpose === 'verification' ? config!.registration_template_id : config!.registration_notice_template_id,
            ...(body.purpose === 'verification' ? { templateParameters: { code: body.code } } : {}),
            platformOnly: true, registrationConfig: config!, timeoutMs: TIMEOUT_MS,
          }));
          // A generic SMS gateway confirms provider acceptance, not handset delivery.
          if (!result.ok) return reply.code(502).send({ error: 'Registration delivery failed', error_code: result.error });
        } else {
          const config = await deps.getSmtpConfig();
          const from = smtpSender(config);
          if (!from) return reply.code(503).send({ error: 'Registration delivery unavailable' });
          const transport = deps.createTransport({
            host: config.host, port: config.port, secure: config.security ? config.security === 'tls' : config.port === 465,
            ...(config.security === 'starttls' ? { requireTLS: true } : {}),
            ...(config.username ? { auth: { user: config.username, pass: config.password ?? '' } } : {}),
            connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
          });
          try {
            const result = await withTimeout(() => transport.sendMail({
              from: { name: config.fromName || BRAND, address: from }, to: body.to,
              subject: `${isTest ? '【测试】' : ''}${BRAND}${body.purpose === 'verification' ? '注册验证码' : '注册账号通知'}`, text,
            }));
            const accepted = result.accepted?.some(value => {
              const address = typeof value === 'string' ? value : value && typeof value === 'object' && 'address' in value ? value.address : undefined;
              return typeof address === 'string' && address.toLowerCase() === body.to.toLowerCase();
            });
            if (!accepted) return reply.code(502).send({ error: 'Registration delivery failed' });
          } finally { transport.close(); }
        }
        return { success: true };
      } catch { return reply.code(502).send({ error: 'Registration delivery failed' }); }
    }

    app.post(`${BASE}/deliver`, { bodyLimit: 2048 }, async (request, reply) => {
      const parsed = deliverySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid registration delivery' });
      return deliver(parsed.data, reply);
    });
    app.get(`${BASE}/config`, async (_request, reply) => {
      try { return await (await deps.getConfigRuntime()).view(); }
      catch { return reply.code(503).send({ error: 'Registration configuration unavailable' }); }
    });
    app.put(`${BASE}/config`, { bodyLimit: 32768 }, async (request, reply) => {
      try { return await (await deps.getConfigRuntime()).save(request.body); }
      catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        return reply.code(status && [400, 409, 503].includes(status) ? status : 503).send({ error: 'Registration configuration unavailable', ...(error instanceof RegistrationConfigError ? {error_code: error.code} : {}) });
      }
    });
    const testSchema = z.object({ channel: z.enum(['sms', 'email']), purpose: z.enum(['verification', 'approved']), to: recipient }).strict();
    const lastTest = new Map<string, number>();
    app.post(`${BASE}/test`, { bodyLimit: 2048 }, async (request, reply) => {
      const test = testSchema.safeParse(request.body);
      if (!test.success) return reply.code(400).send({ error: 'Invalid registration delivery' });
      const parsed = deliverySchema.safeParse({ ...test.data, ...(test.data.purpose === 'verification' ? { code: String(randomInt(100000, 1000000)) } : {}) });
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid registration delivery' });
      const key = `${test.data.channel}:${test.data.purpose}`, now = Date.now();
      if (now - (lastTest.get(key) || 0) < 30000) { reply.header('Retry-After', '30'); return reply.code(429).send({ error: 'Registration test rate limited' }); }
      lastTest.set(key, now);
      return deliver(parsed.data, reply, true);
    });
  };
}
