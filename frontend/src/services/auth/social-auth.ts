import { api } from '@/api/client'
import { getNativeShell } from '@/utils/platform'
import { getOmniDeviceId } from '@/utils/device'
import { createAuthorizationProof, validateAuthorizationResult } from './authorization-proof'

export type SocialProviderId = 'wechat' | 'alipay' | 'feishu' | 'dingtalk' | 'wecom'
export type AuthPlatform = 'android' | 'ios' | 'harmonyos' | 'web'
export interface SocialProvider {
  id: SocialProviderId
  label: string
  ready: boolean
  mode: 'native' | 'browser'
  requiresOrganization: boolean
}
export interface SocialAuthorization {
  transactionId: string
  mode: 'native' | 'browser'
  provider: SocialProviderId
  authorizationUrl?: string
  nativePayload?: string
}
export interface SocialAuthResult {
  status: 'authenticated' | 'binding_required'
  bindingTicket?: string
  data?: Record<string, unknown>
  headers?: { 'access-token'?: string }
}
export interface NativeAuthBridge {
  capabilities(): Promise<{ providers: SocialProviderId[] }>
  authorize(options: SocialAuthorization): Promise<unknown>
  cancel(): Promise<void>
}

function nativeBridge(): NativeAuthBridge | null {
  const candidate = (window as unknown as { Capacitor?: { Plugins?: { OmniAuth?: NativeAuthBridge } } }).Capacitor?.Plugins?.OmniAuth
  return candidate ?? null
}
export function socialPlatform(): AuthPlatform {
  if (getNativeShell() === 'harmonyos') return 'harmonyos'
  const platform = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.()
  return platform === 'android' || platform === 'ios' ? platform : 'web'
}
export async function socialCapabilities(): Promise<SocialProviderId[]> {
  const native = nativeBridge()
  if (!native) return []
  const available = (await native.capabilities()).providers
  return Array.isArray(available) ? available.filter(id => ['wechat', 'alipay', 'feishu', 'dingtalk', 'wecom'].includes(id)) : []
}
export async function socialProviders(organizationCode: string): Promise<SocialProvider[]> {
  const supported = await socialCapabilities()
  if (!supported.length) return []
  const { data } = await api.get<{ providers: SocialProvider[] }>('/auth/social/providers', {
    params: { platform: socialPlatform(), organization_code: organizationCode.trim() },
  })
  return data.providers.filter(provider => provider.ready && supported.includes(provider.id))
}
let bindingProof: { ticket: string; state: string; verifier: string } | null = null
let activeTransaction = ''
export async function socialLogin(provider: SocialProviderId, organizationCode: string): Promise<SocialAuthResult> {
  const native = nativeBridge()
  if (!native) throw new Error('当前安装包未接入第三方授权')
  bindingProof = null
  const proof = await createAuthorizationProof()
  const { data: authorization } = await api.post<SocialAuthorization>('/auth/social/authorize', {
    provider, platform: socialPlatform(), organization_code: organizationCode.trim(),
    proof_challenge: proof.challenge, device_id: getOmniDeviceId(),
  })
  activeTransaction = authorization.transactionId
  try {
    const result = validateAuthorizationResult(await native.authorize(authorization), authorization.transactionId)
    const ticket = 'ticket' in result ? result.ticket : (await api.post<{ ticket: string }>('/auth/social/callback/' + provider, {
      state: result.state, code: result.code,
    })).data.ticket
    const { data } = await api.post<SocialAuthResult>('/auth/social/exchange', {
      ticket, transaction_id: authorization.transactionId, proof_verifier: proof.verifier,
    })
    if (data.status === 'binding_required' && data.bindingTicket) {
      bindingProof = { ticket: data.bindingTicket, state: authorization.transactionId, verifier: proof.verifier }
    }
    return data
  } catch (error) {
    await api.post('/auth/social/cancel', { transaction_id: authorization.transactionId }).catch(() => undefined)
    throw error
  } finally {
    activeTransaction = ''
  }
}
export async function bindSocialIdentity(bindingTicket: string, email: string, password: string): Promise<SocialAuthResult> {
  const pending = bindingProof
  if (!pending || pending.ticket !== bindingTicket) throw new Error('授权已失效，请重新授权')
  const { data } = await api.post<SocialAuthResult>('/auth/social/bind', { binding_ticket: bindingTicket, email, password,
    transaction_id: pending.state, proof_verifier: pending.verifier })
  bindingProof = null
  return data
}
export async function cancelSocialLogin(): Promise<void> {
  bindingProof = null
  const transaction = activeTransaction
  activeTransaction = ''
  await nativeBridge()?.cancel().catch(() => undefined)
  if (transaction) await api.post('/auth/social/cancel', { transaction_id: transaction }).catch(() => undefined)
}
