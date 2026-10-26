import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { SmsProviderConfig } from './sms-provider.js';
import { aliyunSmsEndpoint } from './registration-config.js';

// ACS3 wire format follows Alibaba Cloud OpenAPI's SendSms (2017-05-25) contract.
// https://github.com/aliyun/darabonba-openapi-util/blob/master/ts/src/client.ts
export const ALIYUN_SMS_ERROR_CODES = [
  'ALIYUN_ACCESS_DENIED', 'ALIYUN_SIGN_INVALID', 'ALIYUN_TEMPLATE_INVALID',
  'ALIYUN_TEMPLATE_PARAMS_INVALID', 'ALIYUN_BALANCE_INSUFFICIENT', 'ALIYUN_RATE_LIMITED',
  'ALIYUN_NETWORK_ERROR', 'ALIYUN_REJECTED', 'ALIYUN_PHONE_INVALID', 'ALIYUN_CONFIG_INVALID',
] as const;
const errors: Record<string, typeof ALIYUN_SMS_ERROR_CODES[number]> = {
  'InvalidAccessKeyId.NotFound': 'ALIYUN_ACCESS_DENIED', 'InvalidAccessKeyId': 'ALIYUN_ACCESS_DENIED',
  'SignatureDoesNotMatch': 'ALIYUN_ACCESS_DENIED', 'SignatureMismatch': 'ALIYUN_ACCESS_DENIED',
  'Forbidden.RAM': 'ALIYUN_ACCESS_DENIED', 'Forbidden.AccessDenied': 'ALIYUN_ACCESS_DENIED',
  'isv.RAM_PERMISSION_DENY': 'ALIYUN_ACCESS_DENIED', 'isv.SMS_SIGNATURE_ILLEGAL': 'ALIYUN_SIGN_INVALID',
  'isv.SMS_TEMPLATE_ILLEGAL': 'ALIYUN_TEMPLATE_INVALID',
  'isv.TEMPLATE_MISSING_PARAMETERS': 'ALIYUN_TEMPLATE_PARAMS_INVALID',
  'isv.TEMPLATE_PARAMS_ILLEGAL': 'ALIYUN_TEMPLATE_PARAMS_INVALID',
  'isv.BUSINESS_LIMIT_CONTROL': 'ALIYUN_RATE_LIMITED', 'isv.AMOUNT_NOT_ENOUGH': 'ALIYUN_BALANCE_INSUFFICIENT',
};
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export function aliyunAuthorization(method: string, pathname: string, query: Record<string,string>, headers: Record<string,string>, payloadHash: string, id: string, secret: string) {
  const names = Object.keys(headers).sort();
  const canonicalQuery = Object.keys(query).sort().map(k => encode(k) + '=' + encode(query[k]!)).join('&');
  const canonicalHeaders = names.map(k => k + ':' + headers[k]!.trim() + '\n').join('');
  const canonical = [method, pathname, canonicalQuery, canonicalHeaders, names.join(';'), payloadHash].join('\n');
  const signature = createHmac('sha256',secret).update('ACS3-HMAC-SHA256\n' + sha256(canonical)).digest('hex');
  return { canonicalQuery, authorization: `ACS3-HMAC-SHA256 Credential=${id},SignedHeaders=${names.join(';')},Signature=${signature}` };
}

export async function sendAliyunSms(config: SmsProviderConfig, to: string, templateId: string, params?: Record<string, unknown>, timeoutMs = 8000): Promise<{ok: boolean; error?: string}> {
  if (!aliyunSmsEndpoint(config.endpoint || '') || !config.access_key_id || !config.access_key_secret || !config.sign_name || !/^SMS_\d+$/.test(templateId)) {
    return {ok: false, error: 'ALIYUN_CONFIG_INVALID'};
  }
  const phone = to.trim().replace(/^(?:\+86|0086)/, '');
  if (!/^1[3-9]\d{9}$/.test(phone)) return {ok: false, error:'ALIYUN_PHONE_INVALID'};
  const query: Record<string,string> = { PhoneNumbers: phone, SignName: config.sign_name, TemplateCode: templateId };
  if (params && Object.keys(params).length) query.TemplateParam = JSON.stringify(params);
  const payloadHash = sha256('');
  const headers: Record<string,string> = {
    host: 'dysmsapi.aliyuncs.com', 'content-type': 'application/x-www-form-urlencoded',
    'x-acs-action': 'SendSms', 'x-acs-version': '2017-05-25',
    'x-acs-date': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    'x-acs-signature-nonce': randomUUID(), 'x-acs-content-sha256': payloadHash,
  };
  const signed = aliyunAuthorization('POST', '/', query, headers, payloadHash, config.access_key_id, config.access_key_secret);
  try {
    // No automatic retry: SendSms is billable and is not idempotent.
    const response = await fetch('https://dysmsapi.aliyuncs.com/?' + signed.canonicalQuery, {
      method: 'POST', headers: { ...headers, accept: 'application/json', Authorization: signed.authorization }, body: '',
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json() as { Code?: unknown };
    if (response.ok && data?.Code === 'OK') return {ok: true};
    return {ok: false, error: typeof data?.Code === 'string' && Object.hasOwn(errors, data.Code) ? errors[data.Code]! : 'ALIYUN_REJECTED'};
  } catch { return {ok:false, error:'ALIYUN_NETWORK_ERROR'}; }
}
