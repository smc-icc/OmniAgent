import { useProductModulesStore } from '@/stores/product-modules'
import { fetchSipCredentials } from '@/api/mobile'
import { signOutAllSkillGroups } from '@/api/skillGroups'
import { getSipEngine, type SipConfig, type SipRegistrationState } from '@/services/sip'

/**
 * SIP 注册生命周期。
 *
 * 密码只在本函数的调用栈与原生插件内存里出现，不写入 localStorage / Pinia，
 * 也不回传给任何日志。凭据过期前会自动重新拉取。
 */

let credentialsExpireAt = 0
let registeredIdentity: {sid?:string;version?:number;username?:string;purpose?:'voice'|'video';allowVideo?:boolean;videoRevision?:number} | null = null
export function registeredSipIdentity() { return registeredIdentity ? { ...registeredIdentity } : null }
function identityChanged() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('omni:sip-identity-changed')) }
let inFlight: Promise<void> | null = null
let watching = false
let registrationEpoch = 0
let engineTail: Promise<unknown> = Promise.resolve()
function serializeEngine<T>(command: () => Promise<T>): Promise<T> { const next=engineTail.then(command); engineTail=next.catch(()=>undefined); return next }
/** 已因注册失败退过队，避免反复对后端刷签出请求 */
let queueLeftForFailure = false

function toConfig(raw: Awaited<ReturnType<typeof fetchSipCredentials>>, displayName: string): SipConfig {
  return {
    allowVideo: raw.allow_video,
    username: raw.username,
    password: raw.password,
    realm: raw.realm,
    proxyHost: raw.proxy.host,
    proxyPort: raw.proxy.port,
    transport: raw.proxy.transport,
    srtp: raw.srtp,
    codecs: raw.codecs,
    registerExpiresS: raw.register_expires_s,
    stunServer: raw.stun_server || undefined,
    iceEnabled: raw.ice_enabled,
    displayName,
    wssUrl: raw.web?.wss_url,
    iceServers: raw.web?.ice_servers,
  }
}

/**
 * 确保已注册。凭据未过期且已是 registered 时直接返回。
 * force=true 用于「重新注册」按钮与网络恢复后的重试。
 */
export async function ensureSipRegistered(opts?: { force?: boolean; displayName?: string }): Promise<void> {
  if (!useProductModulesStore().enabled('icc')) return
  const engine = getSipEngine()
  if (!engine.available) throw new Error('当前平台未接入原生 SIP 语音能力')

  if (inFlight) return inFlight
  const epoch = registrationEpoch
  const operation: Promise<void> = (async () => {
      let sameIdentity = true
      const identity = registeredIdentity
      if (identity) {
        const { useAuthStore } = await import('@/stores/auth')
        const { useExtensionBindingStore } = await import('@/stores/extension-binding')
        sameIdentity = !useExtensionBindingStore().snapshot || (identity.sid === useAuthStore().user?.session_id && identity.version === useExtensionBindingStore().binding.version)
      }
      if (epoch !== registrationEpoch) throw new Error('SIP registration cancelled')
      if (sameIdentity && !opts?.force && engine.registrationState() === 'registered' && credentialsExpireAt > Date.now()) return
      const calls = await engine.calls()
      if (epoch !== registrationEpoch) throw new Error('SIP registration cancelled')
      if (calls.some(call => call.state !== 'disconnected')) throw new Error('当前仍有活动通话，请通话结束后重试')
      const raw = await fetchSipCredentials({ purpose: 'voice', client: 'mobile' })
      if (epoch !== registrationEpoch) throw new Error('SIP registration cancelled')
      if(raw.login_sid || raw.binding_version!=null){
        const {useAuthStore}=await import('@/stores/auth')
        const {useExtensionBindingStore}=await import('@/stores/extension-binding')
        if(raw.login_sid!==useAuthStore().user?.session_id || raw.binding_version!==useExtensionBindingStore().binding.version)throw new Error('SIP 凭据已过时，请刷新后重试')
      }
      await serializeEngine(async()=>{if(epoch!==registrationEpoch)throw new Error('SIP registration cancelled');await engine.register(toConfig(raw, opts?.displayName ?? raw.username))})
      if (epoch !== registrationEpoch) throw new Error('SIP registration cancelled')
      registeredIdentity={sid:raw.login_sid,version:raw.binding_version,username:raw.username,purpose:raw.purpose,allowVideo:raw.allow_video,videoRevision:raw.video_config?.revision}
      identityChanged()
      credentialsExpireAt = Date.parse(raw.expires_at) || Date.now() + 3600_000
      queueLeftForFailure = false
  })().finally(() => { if (inFlight === operation) inFlight = null })
  inFlight = operation
  return operation
}

export async function unregisterSip(): Promise<void> {
  registrationEpoch++
  inFlight = null
  credentialsExpireAt = 0
  registeredIdentity = null
  identityChanged()
  queueLeftForFailure = false
  getSipEngine().cancelPendingRegistration?.()
  await serializeEngine(()=>getSipEngine().unregister()).catch(() => undefined)
}

/**
 * 分机注册掉了就必须立刻退出 ACD 队列。
 *
 * VDN 的 SipExtStatusSupport 会在 CCS 侧做同样的判断，但那依赖 FreeSWITCH 的注册态上报，
 * 有秒级延迟；App 自己知道得更早，先退队能少派一通接不起来的电话。
 */
async function leaveQueueOnRegistrationLost(state: SipRegistrationState) {
  // Losing the optional video identity must not sign out the physical telephone/IMS groups.
  if (registeredIdentity?.purpose === 'video') return
  if (queueLeftForFailure) return
  queueLeftForFailure = true
  const { useAgentStore } = await import('@/stores/agent')
  const agent = useAgentStore()
  if (!agent.agentId) return
  try {
    await signOutAllSkillGroups()
  } catch {
    /* 后端不可达时 CCS 侧的 SipExtStatusSupport 仍会兜底 */
  }
  await agent.setStatus('busy').catch(() => undefined)
  console.warn('[sip] registration lost → left ACD queue', state)
}

/** 挂一次全局监听：注册失败/断网立刻退队，网络恢复重新注册。 */
export function watchSipRegistration(): void {
  if (watching) return
  watching = true
  const engine = getSipEngine()
  if (!engine.available) return

  engine.on('registrationChanged', ({ state }) => {
    if (state === 'failed' || state === 'unregistered') {
      void leaveQueueOnRegistrationLost(state)
    }
  })

  window.addEventListener('online', () => {
    void import('@/stores/agent').then(({ useAgentStore }) => {
      if (useAgentStore().agentId) return ensureSipRegistered({ force: true })
    }).catch(() => undefined)
  })
  window.addEventListener('offline', () => {
    void leaveQueueOnRegistrationLost('unregistered')
  })
}
