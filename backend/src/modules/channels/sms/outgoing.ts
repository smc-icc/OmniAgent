import { sendAliyunSms } from '../../../shared/services/aliyun-sms.js';
import { prisma } from '../../../plugins/db.js';
import { CHANNEL_TYPES } from '../../../shared/channels/types.js';
import { type SmsProviderConfig, getSmsProviderConfig } from '../../../shared/services/sms-provider.js';

export async function sendSmsText(
  conversationId: number,
  content: string,
): Promise<{ ok: boolean; error?: string }> {
  const conv = await prisma.conversations.findUnique({
    where: { id: conversationId },
    include: { inbox: true },
  });
  if (!conv?.inbox) return { ok: false, error: 'conversation not found' };

  const ci = await prisma.contact_inboxes.findFirst({
    where: { inbox_id: conv.inbox_id, contact_id: conv.contact_id ?? 0 },
  });
  if (!ci?.source_id) return { ok: false, error: 'contact source_id missing' };

  if (conv.inbox.channel_type === CHANNEL_TYPES.TWILIO_SMS) {
    const ch = await prisma.channel_twilio_sms.findUnique({ where: { id: conv.inbox.channel_id } });
    if (!ch?.phone_number) return { ok: false, error: 'twilio phone not configured' };
    return postTwilio(ch.account_sid, ch.auth_token, ci.source_id, ch.phone_number, content);
  }

  if (conv.inbox.channel_type === CHANNEL_TYPES.SMS) {
    const ch = await prisma.channel_sms.findUnique({ where: { id: conv.inbox.channel_id } });
    if (!ch) return { ok: false, error: 'sms channel not found' };
    return sendViaProviderConfig(ch.provider_config, ci.source_id, content, ch.phone_number);
  }

  return { ok: false, error: 'unsupported sms channel type' };
}

export interface SmsSendOptions {
  /** 模板上声明的服务商标记（透传到出站请求体，便于服务商分派） */
  provider?: string | null;
  /** 运营商报备的模板 CODE */
  providerTemplateId?: string | null;
  templateParameters?: Record<string, string>;
  timeoutMs?: number;
  /** Authentication secrets must never use supervisor-maintained channel overrides. */
  platformOnly?: boolean;
  /** Trusted, isolated registration settings; never sourced from an inbox or client payload. */
  registrationConfig?: SmsProviderConfig;
}

/** ITR send_sms 可指定号码，不依赖当前会话渠道 */
export async function sendSmsToNumber(
  accountId: number,
  to: string,
  content: string,
  opts?: SmsSendOptions,
): Promise<{ ok: boolean; error?: string }> {
  const phone = String(to || '').trim();
  if (!phone) return { ok: false, error: 'to required' };
  if (opts?.platformOnly) return sendViaProviderConfig(null, phone, content, undefined, opts);
  const twilio = await prisma.channel_twilio_sms.findFirst({ where: { account_id: accountId } });
  if (twilio?.phone_number) {
    return postTwilio(twilio.account_sid, twilio.auth_token, phone, twilio.phone_number, content, opts?.timeoutMs);
  }
  const sms = await prisma.channel_sms.findFirst({ where: { account_id: accountId } });
  if (sms) {
    return sendViaProviderConfig(sms.provider_config, phone, content, sms.phone_number, opts);
  }
  // 没有渠道记录时，只要平台级配置里给了 endpoint，仍然可以出站
  const platform = getSmsProviderConfig();
  if (platform?.endpoint && platform.endpoint.trim()) {
    return sendViaProviderConfig(null, phone, content, undefined, opts);
  }
  return { ok: false, error: 'no sms channel configured' };
}

async function postTwilio(
  accountSid: string,
  authToken: string,
  to: string,
  from: string,
  content: string,
  timeoutMs?: number,
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: content }),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

function asConfig(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {};
}

async function sendViaProviderConfig(
  raw: unknown,
  to: string,
  content: string,
  from?: string | null,
  opts?: SmsSendOptions,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = asConfig(raw);
  // 渠道级没给地址就回退到平台级（ConfServer 下发）配置
  const platform = opts?.registrationConfig ?? getSmsProviderConfig();
  const effective = cfg.url || cfg.endpoint ? cfg : { ...(platform ?? {}), ...cfg };
  if (platform?.enabled === false) {
    return { ok: false, error: 'sms provider disabled by platform config' };
  }
  if (effective.provider === 'aliyun') {
    return sendAliyunSms(effective as SmsProviderConfig, to,
      String(opts?.providerTemplateId || effective.default_template_id || ''), opts?.templateParameters, opts?.timeoutMs);
  }
  const url = String(effective.url || effective.endpoint || '').trim();
  if (!url) return { ok: false, error: 'sms provider url missing' };
  const method = String(effective.method || 'POST').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (effective.headers && typeof effective.headers === 'object') {
    for (const [k, v] of Object.entries(effective.headers as Record<string, unknown>)) {
      headers[k] = String(v);
    }
  }
  // 报备模板 CODE：模板自身的优先，否则用平台级默认值
  const templateId =
    String(opts?.providerTemplateId ?? '').trim() ||
    String(platform?.default_template_id ?? '').trim() ||
    undefined;
  const provider = String(opts?.provider ?? platform?.provider ?? '').trim() || undefined;
  const extra = {
    to,
    content,
    from: from || undefined,
    text: content,
    template_id: templateId,
    ...(opts?.registrationConfig?.sign_name ? { sign_name: opts.registrationConfig.sign_name } : {}),
    provider,
    ...(opts?.templateParameters ? { template_params: opts.templateParameters } : {}),
  };
  const body =
    effective.body && typeof effective.body === 'object'
      ? JSON.stringify({ ...(effective.body as object), ...extra })
      : JSON.stringify(extra);
  try {
    const res = await fetch(url, { method, headers, body, ...(opts?.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}) });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
