import { api } from '@/api/client'
import { getOmniDeviceId } from '@/utils/device'
import { SMS_SERVICE_UNAVAILABLE, smsCredentialsError, smsLoginError, validSmsCode,
  type SmsCapabilities, type SmsCredentials, type SmsRequestResult } from './sms-login-policy'
import type { SocialAuthResult } from './social-auth'

export type SmsAuthenticated = SocialAuthResult & { status: 'authenticated' }
export interface SmsVdnSelection { status: 'select_vdn'; selection_ticket: string; expires_in: number; vdns: { vdn_id: number; name: string }[] }
export interface SmsUnbound { status: 'unbound'; message: string }
export type SmsLoginResult = SmsAuthenticated | SmsVdnSelection | SmsUnbound
const ticket = /^[A-Za-z0-9_-]{43}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const positiveSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

export async function smsCapabilities(signal?: AbortSignal): Promise<SmsCapabilities> {
  let data: unknown
  try { ({ data } = await api.get<unknown>('/auth/phone/capabilities', { signal })) }
  catch { throw new Error(SMS_SERVICE_UNAVAILABLE) }
  if (!record(data) || typeof data.supported !== 'boolean' || typeof data.ready !== 'boolean' ||
    typeof data.reason !== 'string' || !positiveSeconds(data.expires_in) || !positiveSeconds(data.retry_after)) {
    throw new Error(SMS_SERVICE_UNAVAILABLE)
  }
  return { supported: data.supported, ready: data.supported && data.ready, reason: data.reason,
    expires_in: data.expires_in, retry_after: data.retry_after }
}

export async function requestSmsCode(credentials: SmsCredentials, signal?: AbortSignal): Promise<SmsRequestResult> {
  const error = smsCredentialsError(credentials)
  if (error) throw new Error(error)
  let data: unknown
  try {
    ({ data } = await api.post<unknown>('/auth/phone/request', {
      phone: credentials.phone.trim(), device_id: getOmniDeviceId(),
    }, { signal }))
  } catch (failure) { throw new Error(smsLoginError(failure)) }
  if (!record(data) || typeof data.request_id !== 'string' || !uuid.test(data.request_id) ||
    !positiveSeconds(data.expires_in) || !positiveSeconds(data.retry_after) || typeof data.message !== 'string') {
    throw new Error('手机号登录服务返回无效验证信息，请刷新状态后重试')
  }
  return { request_id: data.request_id, expires_in: data.expires_in, retry_after: data.retry_after, message: data.message }
}

export async function loginWithSms(input: SmsCredentials & { requestId: string; code: string }, signal?: AbortSignal): Promise<SmsLoginResult> {
  const error = smsCredentialsError(input)
  if (error) throw new Error(error)
  if (!uuid.test(input.requestId) || !validSmsCode(input.code)) throw new Error('请先获取验证码，再输入六位数字验证码')
  let data: unknown
  try {
    ({ data } = await api.post<unknown>('/auth/phone/sign_in', {
      request_id: input.requestId, phone: input.phone.trim(),
      code: input.code, device_id: getOmniDeviceId(),
    }, { signal }))
  } catch (failure) { throw new Error(smsLoginError(failure)) }
  if (record(data) && data.status === 'unbound' && typeof data.message === 'string') return { status: 'unbound', message: '未绑定 VDN，请联系 VDN 管理员关联手机号' }
  if (record(data) && data.status === 'select_vdn' && typeof data.selection_ticket === 'string' && ticket.test(data.selection_ticket) &&
    positiveSeconds(data.expires_in) && data.expires_in <= 300 && Array.isArray(data.vdns) && data.vdns.length > 1 &&
    data.vdns.every(v => record(v) && positiveSeconds(v.vdn_id) && typeof v.name === 'string' && !!v.name.trim()) &&
    new Set(data.vdns.map(v => v.vdn_id)).size === data.vdns.length) return data as unknown as SmsVdnSelection
  return authenticated(data)
}
function authenticated(data: unknown): SmsAuthenticated {
  if (!record(data) || data.status !== 'authenticated' || !record(data.data) || data.data.authentication_method !== 'sms' ||
    !record(data.headers) || typeof data.headers['access-token'] !== 'string' || !data.headers['access-token'].trim()) {
    throw new Error('手机号登录会话无效，请重新获取验证码后登录')
  }
  return data as unknown as SmsAuthenticated
}
export async function selectSmsVdn(input: SmsCredentials & { selectionTicket: string; vdnId: number }, signal?: AbortSignal): Promise<SmsAuthenticated> {
  const error = smsCredentialsError(input)
  if (error) throw new Error(error)
  if (!ticket.test(input.selectionTicket) || !positiveSeconds(input.vdnId)) throw new Error('VDN 选择已失效，请重新验证手机号')
  let data: unknown
  try {
    ({ data } = await api.post<unknown>('/auth/phone/select_vdn', { phone: input.phone.trim(), selection_ticket: input.selectionTicket,
      vdn_id: input.vdnId, device_id: getOmniDeviceId() }, { signal }))
  } catch (failure) { throw new Error(smsLoginError(failure)) }
  return authenticated(data)
}
