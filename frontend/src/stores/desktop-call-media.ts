import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, watch } from 'vue'
import { fetchAgentVideoConfig, fetchSipCredentials, type VideoAgentConfig } from '@/api/mobile'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'
import { useExtensionBindingStore } from '@/stores/extension-binding'
import type { SipCall, SipEngine, SipRegistrationState } from '@/services/sip'
import { JsSipEngine } from '@/services/sip/jssip-engine'

/** Desktop browser SIP can keep a voice and an independent video identity registered together. */
export const useDesktopCallMediaStore = defineStore('desktop-call-media', () => {
  const agent = useAgentStore()
  const auth = useAuthStore()
  const binding = useExtensionBindingStore()
  const engine = shallowRef<SipEngine | null>(null)
  const voiceEngine = shallowRef<SipEngine | null>(null)
  const videoEngine = shallowRef<SipEngine | null>(null)
  const call = shallowRef<SipCall | null>(null)
  const registration = ref<SipRegistrationState>('unregistered')
  const error = ref('')
  const config = shallowRef<VideoAgentConfig>({ enabled: false, same_extension: false,
    phone_extension: '', extension: '', web_sip_enabled: false, web_video_enabled: false,
    video_extension_mode: 'shared_phone', web_enabled: false, mobile_enabled: false,
    password_configured: false, revision: 0 })
  const isVideoCall = computed(() => Number(agent.currentCall?.MediaType) === 1
    && config.value.enabled && config.value.web_video_enabled
    && call.value?.videoOffered !== false)
  const ccsCallId = ref(0)
  const conversationId = ref<number | null>(null)
  let started = false
  let epoch = 0
  let identity = ''
  let tail: Promise<void> = Promise.resolve()
  let answerRequested = false
  let answerOperation: Promise<void> | null = null
  let sipAnswer: { id: string; result: Promise<void> } | null = null
  let stopWatch: (() => void) | null = null
  let subscriptions: Array<() => void> = []
  let configTimer: ReturnType<typeof setInterval> | null = null

  function clearCall() {
    call.value = null
    ccsCallId.value = 0
    conversationId.value = null
    answerRequested = false
    answerOperation = null
    sipAnswer = null
  }

  async function disconnect() {
    const previous = [voiceEngine.value, videoEngine.value].filter(Boolean) as SipEngine[]
    subscriptions.forEach(off => off())
    subscriptions = []
    voiceEngine.value = null
    videoEngine.value = null
    engine.value = null
    identity = ''
    registration.value = 'unregistered'
    clearCall()
    await Promise.all(previous.map(item => item.unregister().catch(() => undefined)))
  }

  async function answerSip() {
    const current = call.value
    const media = engine.value
    if (!current || !media || current.direction !== 'inbound'
      || (current.state !== 'incoming' && current.state !== 'early')) return
    if (sipAnswer?.id === current.callId) return sipAnswer.result
    const result = media.answer(current.callId, { video: isVideoCall.value })
    sipAnswer = { id: current.callId, result }
    try { await result } finally { if (sipAnswer?.result === result) sipAnswer = null }
  }

  function updateRegistration() {
    const active = engine.value
    if (active) registration.value = active.registrationState()
    else if (voiceEngine.value?.registrationState() === 'registered' || videoEngine.value?.registrationState() === 'registered') registration.value = 'registered'
    else registration.value = 'unregistered'
  }

  function subscribe(media: SipEngine) {
    subscriptions.push(media.on('registrationChanged', () => {
      if (started) updateRegistration()
    }))
    subscriptions.push(media.on('incomingCall', next => {
      if (!started) return
      engine.value = media
      call.value = { ...next }
      ccsCallId.value = Number(agent.currentCall?.CallID || ccsCallId.value || 0)
      updateRegistration()
      if (answerRequested) void answerSip().catch(cause => {
        answerRequested = false
        error.value = cause instanceof Error ? cause.message : '接听失败，请重试'
      })
    }))
    subscriptions.push(media.on('callStateChanged', next => {
      if (!started) return
      if (call.value && call.value.callId !== next.callId) return
      engine.value = media
      if (next.state === 'disconnected') clearCall()
      else call.value = { ...next }
      updateRegistration()
    }))
    subscriptions.push(media.on('error', event => {
      if (started) error.value = event.message
    }))
  }

  async function registerBrowserIdentity(raw: Awaited<ReturnType<typeof fetchSipCredentials>>, role: 'voice' | 'video') {
    if (!raw.web?.wss_url) throw new Error('浏览器 SIP 接入地址尚未配置，请联系管理员')
    if (role === 'video' && raw.allow_video !== true) throw new Error('浏览器视频能力未返回，请联系管理员')
    const media = markRaw(new JsSipEngine())
    if (!media.available) throw new Error('浏览器话机需要在支持麦克风的 HTTPS 页面中打开')
    subscribe(media)
    await media.register({ allowVideo: raw.allow_video, username: raw.username, password: raw.password, realm: raw.realm,
      proxyHost: raw.proxy.host, proxyPort: raw.proxy.port, transport: raw.proxy.transport,
      srtp: raw.srtp, codecs: raw.codecs, registerExpiresS: raw.register_expires_s,
      stunServer: raw.stun_server || undefined, iceEnabled: raw.ice_enabled,
      displayName: agent.profile.work_no, wssUrl: raw.web.wss_url, iceServers: raw.web.ice_servers })
    if (role === 'voice') voiceEngine.value = media
    else videoEngine.value = media
    if (!engine.value) engine.value = media
    updateRegistration()
  }

  function connect(): Promise<void> {
    const attempt = ++epoch
    voiceEngine.value?.cancelPendingRegistration?.()
    videoEngine.value?.cancelPendingRegistration?.()
    const operation = async () => {
      if (!started || attempt !== epoch) return
      const sid = auth.user?.session_id
      const version = binding.binding.version
      try {
        if (!sid) { await disconnect(); return }
        const next = await fetchAgentVideoConfig()
        if (!started || attempt !== epoch) return
        config.value = { ...next }
        const wantVoice = next.web_sip_enabled
        const wantVideo = next.enabled && next.web_video_enabled
        if (!wantVoice && !wantVideo) {
          await disconnect()
          error.value = ''
          return
        }
        if (wantVoice && !binding.binding.extension) throw new Error('浏览器话机需要先绑定电话分机')
        if (wantVideo && next.video_extension_mode === 'independent_video' && !next.extension) {
          throw new Error('独立视频分机尚未配置，请联系 VDN 管理员')
        }
        const nextIdentity = `${sid}:${version}:${next.phone_extension}:${next.extension}:${next.revision}:${wantVoice}:${wantVideo}:${next.video_extension_mode}`
        if (identity === nextIdentity && (voiceEngine.value?.registrationState() === 'registered' || videoEngine.value?.registrationState() === 'registered' || call.value)) return
        await disconnect()
        if (wantVoice) {
          const raw = await fetchSipCredentials({ purpose: 'voice', client: 'web' })
          if (!started || attempt !== epoch) return
          if (sid !== auth.user?.session_id || version !== binding.binding.version || raw.login_sid !== sid || (raw.binding_version != null && raw.binding_version !== version) || raw.purpose !== 'voice') {
            throw new Error('浏览器话机配置或分机绑定已变化，请重新连接')
          }
          await registerBrowserIdentity(raw, 'voice')
        }
        if (wantVideo && (!wantVoice || next.video_extension_mode === 'independent_video')) {
          const raw = await fetchSipCredentials({ purpose: 'video', client: 'web' })
          if (!started || attempt !== epoch) return
          if (sid !== auth.user?.session_id || version !== binding.binding.version || raw.login_sid !== sid || (raw.binding_version != null && raw.binding_version !== version) || raw.purpose !== 'video') {
            throw new Error('Web 视频配置或分机绑定已变化，请重新连接')
          }
          await registerBrowserIdentity(raw, 'video')
        }
        identity = nextIdentity
        updateRegistration()
        error.value = ''
      } catch (cause) {
        if (attempt !== epoch) return
        await disconnect().catch(() => undefined)
        error.value = cause instanceof Error ? cause.message : '通话连接失败，请重试'
      }
    }
    tail = tail.then(operation, operation)
    return tail
  }

  function onOffered(event: Event) {
    const id = Number((event as CustomEvent<{ CallID?: number }>).detail?.CallID || 0)
    if (ccsCallId.value && ccsCallId.value !== id) clearCall()
    ccsCallId.value = id
  }
  function onConversation(event: Event) {
    const detail = (event as CustomEvent<{ call_id?: number; conversation_id?: number }>).detail
    if (Number(detail?.call_id) === ccsCallId.value && detail?.conversation_id) conversationId.value = Number(detail.conversation_id)
  }
  function onEnded(event: Event) {
    const id = Number((event as CustomEvent<{ CallID?: number }>).detail?.CallID || 0)
    if (id && ccsCallId.value && id !== ccsCallId.value) return
    const ended = call.value
    clearCall()
    if (ended) void engine.value?.hangup(ended.callId).catch(() => undefined)
  }

  function refreshConfig() { if (started) void connect() }

  async function start() {
    if (started) return
    started = true
    window.addEventListener('ccs:phone-offered', onOffered)
    window.addEventListener('ccs:phone-ended', onEnded)
    window.addEventListener('omni:phone-conversation', onConversation)
    window.addEventListener('focus', refreshConfig)
    configTimer = setInterval(refreshConfig, 30000)
    stopWatch = watch([() => auth.user?.session_id, () => binding.binding.version], () => {
      epoch++
      voiceEngine.value?.cancelPendingRegistration?.()
      videoEngine.value?.cancelPendingRegistration?.()
      const closing = disconnect().catch(() => undefined)
      tail = tail.then(() => closing, () => closing)
      void connect()
    }, { flush: 'sync' })
    await binding.refresh().catch(() => undefined)
    if (started) await connect()
  }

  async function stop() {
    started = false
    epoch++
    stopWatch?.()
    stopWatch = null
    voiceEngine.value?.cancelPendingRegistration?.()
    videoEngine.value?.cancelPendingRegistration?.()
    const closing = disconnect().catch(() => undefined)
    window.removeEventListener('ccs:phone-offered', onOffered)
    window.removeEventListener('ccs:phone-ended', onEnded)
    window.removeEventListener('omni:phone-conversation', onConversation)
    window.removeEventListener('focus', refreshConfig)
    if (configTimer) clearInterval(configTimer)
    configTimer = null
    tail = tail.then(() => closing, () => closing)
    await tail
  }

  async function answer() {
    if (!engine.value) return agent.answerCall()
    if (answerOperation) return answerOperation
    answerRequested = true
    const operation = (async () => {
      try {
        if (agent.callPhase === 'ringing') await agent.answerCall()
        await answerSip()
      } catch (cause) { answerRequested = false; throw cause }
    })()
    answerOperation = operation
    try { await operation } finally { if (answerOperation === operation) answerOperation = null }
  }
  async function release() {
    answerRequested = false
    const current = call.value
    if (current) await engine.value?.hangup(current.callId).catch(() => undefined)
    await agent.releaseCall()
    clearCall()
  }
  async function setMuted(next: boolean) {
    const previous = agent.callMuted
    const media = call.value ? engine.value : null
    if (media) await media.mute(next)
    try { await agent.setCallMuted(next) }
    catch (cause) { if (media) await media.mute(previous).catch(() => undefined); throw cause }
  }
  function matchesSession(sessionId: string | null, selectedConversationId: number | null) {
    if (!call.value || !ccsCallId.value) return false
    return sessionId === `ccs-phone-${ccsCallId.value}` || (conversationId.value != null && selectedConversationId === conversationId.value)
  }

  return { engine, call, registration, error, config, isVideoCall, ccsCallId, conversationId, start, stop, connect, answer, release, setMuted, matchesSession }
})
