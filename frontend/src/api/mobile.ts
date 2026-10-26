import { api } from './client'

export interface VideoAgentConfig {
  enabled: boolean
  same_extension: boolean
  phone_extension: string
  extension: string
  web_sip_enabled: boolean
  web_video_enabled: boolean
  video_extension_mode: 'shared_phone' | 'independent_video'
  web_enabled: boolean
  mobile_enabled: boolean
  password_configured: boolean
  revision: number
}

export async function fetchAgentVideoConfig(): Promise<VideoAgentConfig> {
  return (await api.get<VideoAgentConfig>('/api/agent/video-config')).data
}

export interface SipCredentials {
  purpose?: 'voice' | 'video'
  allow_video?: boolean
  video_config?: VideoAgentConfig
  binding_version?: number
  login_sid?: string
  username: string
  password: string
  realm: string
  proxy: { host: string; port: number; transport: 'tls' | 'tcp' | 'udp' }
  srtp: 'required' | 'optional' | 'disabled'
  codecs: string[]
  register_expires_s: number
  stun_server: string
  ice_enabled: boolean
  expires_at: string
  video?: { group_ids: number[]; skill_ids: number[] }
  web?: { wss_url: string; ice_servers: RTCIceServer[] }
}

/**
 * 拉取 SIP 注册凭据。密码只允许停留在内存与原生 Keystore，
 * 不得写 localStorage / Pinia 持久化。
 */
export async function fetchSipCredentials(options?: { purpose?: 'voice' | 'video' | 'auto'; client?: 'web' | 'mobile' }) {
  const { data } = options
    ? await api.get<SipCredentials>('/api/agent/sip-credentials', { params: options })
    : await api.get<SipCredentials>('/api/agent/sip-credentials')
  return data
}

export type PushProvider = 'fcm' | 'apns' | 'harmony'

export interface PushDeviceInput {
  provider: PushProvider
  token: string
  /** APNs 的 VoIP token 与普通 token 不同，来电必须走 VoIP */
  voip?: boolean
  platform?: string
  app_version?: string
}

export async function registerPushDevice(input: PushDeviceInput) {
  const { data } = await api.post<{ ok: true; identifier: string }>('/api/agent/push-devices', input)
  return data
}

export async function unregisterPushDevice(token: string) {
  const { data } = await api.delete<{ ok: true }>('/api/agent/push-devices', { data: { token } })
  return data
}
