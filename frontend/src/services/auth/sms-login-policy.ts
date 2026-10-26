export interface SmsCredentials {
  phone: string
}

export interface SmsCapabilities {
  supported: boolean
  ready: boolean
  reason: string
  expires_in: number
  retry_after: number
}

export interface SmsRequestResult {
  request_id: string
  expires_in: number
  retry_after: number
  message: string
}

export interface SmsRequestState {
  generation: number
  sending: boolean
  requestId: string
  expiresAt: number
  requestedAt: number
  retryAt: number
  message: string
}

export const SMS_REQUEST_NOTICE = '验证码将发送至该手机号，请留意短信。'
export const SMS_SERVICE_UNAVAILABLE = '手机号登录服务暂不可用，请刷新状态重试或使用账号登录'

export function smsCredentialsError({ phone }: SmsCredentials): string {
  if (!/^(?:1\d{10}|\+[1-9]\d{6,14})$/.test(phone.trim())) return '请输入有效手机号，国际号码请包含 + 和国家区号'
  return ''
}

export function validSmsCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}

export function emptySmsRequest(): SmsRequestState {
  return { generation: 0, sending: false, requestId: '', expiresAt: 0, requestedAt: 0, retryAt: 0, message: '' }
}

export function smsRetrySeconds(state: SmsRequestState, now: number): number {
  return Math.max(0, Math.ceil((state.retryAt - now) / 1000))
}

export function canRequestSms(state: SmsRequestState, ready: boolean, credentials: SmsCredentials, now: number): boolean {
  return ready && !state.sending && smsRetrySeconds(state, now) === 0 && !smsCredentialsError(credentials)
}

export function invalidateSmsRequest(state: SmsRequestState): SmsRequestState {
  // Keep the cooldown even when fields/modes change or an in-flight request is canceled.
  return { ...state, generation: state.generation + 1, sending: false, requestId: '', expiresAt: 0, requestedAt: 0, message: '' }
}

export function beginSmsRequest(state: SmsRequestState, now: number, retryAfter = 60): SmsRequestState {
  return { ...invalidateSmsRequest(state), sending: true, requestedAt: now, retryAt: now + Math.max(60, retryAfter) * 1000 }
}

export function completeSmsRequest(state: SmsRequestState, generation: number, result: SmsRequestResult, now: number): SmsRequestState {
  if (generation !== state.generation || !state.sending) return state
  // Anchor expiry to the request start so suspended webviews cannot extend the server TTL.
  return { ...state, sending: false, requestId: result.request_id, expiresAt: state.requestedAt + result.expires_in * 1000,
    retryAt: Math.max(state.retryAt, now + result.retry_after * 1000), message: SMS_REQUEST_NOTICE }
}

export function failSmsRequest(state: SmsRequestState, generation: number): SmsRequestState {
  return generation === state.generation ? { ...state, sending: false } : state
}

export function smsRequestValid(state: SmsRequestState, now: number): boolean {
  return !!state.requestId && !state.sending && now < state.expiresAt
}

export function expireSmsRequest(state: SmsRequestState, now: number): SmsRequestState {
  return state.requestId && now >= state.expiresAt ? invalidateSmsRequest(state) : state
}

export function smsCapabilityNotice(capabilities: SmsCapabilities): string {
  if (!capabilities.supported) return '当前服务暂不支持手机号登录，请使用账号登录'
  if (capabilities.ready) return ''
  const reason = capabilities.reason.trim()
  if (!reason || /not[_ -]?configured|unconfigured|missing|disabled/i.test(reason)) {
    return '短信网关尚未配置，暂时无法获取验证码或登录，请使用账号登录'
  }
  return /[\u3400-\u9fff]/.test(reason) ? reason + '，请使用账号登录或刷新状态重试' : SMS_SERVICE_UNAVAILABLE
}

export function smsLoginError(error: unknown): string {
  const failure = (error && typeof error === 'object' ? error : {}) as { response?: { status?: number } }
  switch (failure.response?.status) {
    case 400:
    case 422: return '请检查手机号和六位验证码后重试'
    case 401: return '验证码无效或已过期，请检查验证码或重新获取'
    case 403: return '手机号登录未获授权，请联系本 VDN 管理员或使用账号登录'
    case 410: return '验证码已过期，请重新获取验证码'
    case 429: return '验证码请求或登录尝试过于频繁，请稍后重试'
    case 503: return SMS_SERVICE_UNAVAILABLE
  }
  return failure.response ? '手机号登录失败，请稍后重试或使用账号登录' : '无法连接手机号登录服务，请检查网络后重试'
}
