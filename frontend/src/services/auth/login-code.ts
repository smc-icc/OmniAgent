import { api } from '@/api/client'
import { getOmniDeviceId } from '@/utils/device'
import { authorizationCodeLoginError } from './mobile-login-policy'
import type { SocialAuthResult } from './social-auth'

export async function loginCodeCapabilities(): Promise<boolean> {
  const { data } = await api.get<{ ready: boolean }>('/auth/login-code/capabilities')
  return data.ready === true
}
export async function loginWithAuthorizationCode(code: string): Promise<SocialAuthResult> {
  try {
    const { data } = await api.post<SocialAuthResult>('/auth/login-code/sign_in', { code: code.trim(), device_id: getOmniDeviceId() })
    return data
  } catch (error) { throw new Error(authorizationCodeLoginError(error)) }
}
