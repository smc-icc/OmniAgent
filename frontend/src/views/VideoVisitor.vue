<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Phone, VideoCamera } from '@element-plus/icons-vue'
import VideoCallPane from '@/components/VideoCallPane.vue'
import SoftDialPad from '@/components/SoftDialPad.vue'
import { JsSipEngine } from '@/services/sip/jssip-engine'
import type { SipCall } from '@/services/sip'
import type { SipCredentials } from '@/api/mobile'

const route = useRoute()
const engine = new JsSipEngine()
const call = ref<SipCall | null>(null)
const label = ref('视频客户端')
const error = ref('')
const busy = ref(false)
const loaded = ref(false)
const called = ref('880000')
const dtmfDigits = ref('')
const voice = computed(() => route.name === 'voice-visitor')
const canSendDtmf = computed(() => Boolean(call.value && ['connecting', 'confirmed', 'held'].includes(call.value.state)))
const dialPadValue = computed({
  get: () => call.value ? dtmfDigits.value : called.value,
  set: (value: string) => { if (call.value) dtmfDigits.value = value; else called.value = value },
})
async function sendCallDtmf(digit: string) {
  const current = call.value
  if (!voice.value || !current || !canSendDtmf.value) return
  try { await engine.sendDtmf(digit, current.callId) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '按键发送失败，请重试' }
}
let session: { session_id: string; session_token: string } | null = null
let expiryTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false
let cleaning: Promise<void> | null = null
const off = [engine.on('callStateChanged', value => {
  call.value = value.state === 'disconnected' ? null : value
  if (value.state === 'disconnected') void cleanup()
}), engine.on('incomingCall', value => { void engine.hangup(value.callId) }),
engine.on('error', value => { error.value = value.message })]
function applyMode() {
  label.value = voice.value ? '语音测试' : '视频客户端'
  called.value = voice.value ? '990000' : '880000'
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, credentials: 'omit', cache: 'no-store' })
  if (!response.ok) throw new Error(response.status === 404 ? '被叫号码没有对应的服务路由' : response.status === 429 ? '当前接入繁忙，请稍后重试' : response.status === 503 ? `${voice.value ? '语音' : '视频'}客服尚未开放` : `${voice.value ? '语音' : '视频'}客服连接失败`)
  return response.json()
}
function cleanup(): Promise<void> {
  if (cleaning) return cleaning
  cleaning = Promise.resolve().then(closeSession).finally(() => { cleaning = null })
  return cleaning
}
async function closeSession() {
  const previous = session
  session = null
  call.value = null
  dtmfDigits.value = ''
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  await engine.unregister()
  if (previous) await request(`/public/api/video/sessions/${previous.session_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${previous.session_token}` }, keepalive: true }).catch(() => undefined)
}
async function start() {
  const number = called.value.trim()
  if (!/^[1-9]\d{2,19}$/.test(number)) { error.value = '请输入 3 到 20 位被叫号码'; return }
  if (busy.value || call.value) return
  busy.value = true; error.value = ''; dtmfDigits.value = ''
  try {
    if (cleaning) await cleaning
    const result = await request<{ session_id: string; session_token: string; destination: string; expires_at: string; sip: SipCredentials }>(
      `/public/api/video/entries/${encodeURIComponent(String(route.params.entryId))}/sessions`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ called: number, media_type: voice.value ? 0 : 1 }) })
    session = { session_id: result.session_id, session_token: result.session_token }
    if (disposed) { await cleanup(); return }
    const sip = result.sip
    await engine.register({ username: sip.username, password: sip.password, realm: sip.realm, proxyHost: sip.proxy.host, proxyPort: sip.proxy.port,
      transport: 'tls', srtp: 'required', codecs: sip.codecs, registerExpiresS: sip.register_expires_s, wssUrl: sip.web?.wss_url, iceServers: sip.web?.ice_servers })
    if (disposed) { await cleanup(); return }
    expiryTimer = setTimeout(() => { error.value = voice.value ? '本次语音测试已到期' : '本次视频会话已到期'; void cleanup() }, Math.max(0, Date.parse(result.expires_at) - Date.now()))
    call.value = await engine.call(result.destination, { video: !voice.value })
  } catch (e) { error.value = e instanceof Error ? e.message : '连接失败'; await cleanup() }
  finally { busy.value = false }
}
async function loadEntry() {
  loaded.value = false
  error.value = ''
  applyMode()
  try {
    await request<{ label: string }>(`/public/api/video/entries/${encodeURIComponent(String(route.params.entryId))}`)
    loaded.value = true
  } catch (e) { error.value = e instanceof Error ? e.message : `${voice.value ? '语音' : '视频'}客服不可用` }
}
watch(() => route.fullPath, () => { void loadEntry() })
onMounted(() => { void loadEntry() })
onBeforeUnmount(() => { disposed = true; off.forEach(fn => fn()); void cleanup() })
</script>

<template>
  <main class="visitor-page">
    <header><strong>SeaMiCloud</strong><span>{{ label }}</span></header>
    <div class="visitor-content">
      <h1><el-icon :aria-label="voice ? '电话' : '摄像头'"><Phone v-if="voice" /><VideoCamera v-else /></el-icon>{{ label }}</h1>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <VideoCallPane :engine="engine" :call="call" :audio-only="voice" :show-keypad="!voice" @hangup="cleanup" @error="error = $event" />
      <div v-if="voice" class="visitor-voice-dial">
        <span class="dial-mode-label">{{ call ? '通话按键（DTMF）' : '被叫号码' }}</span>
        <fieldset :disabled="busy || Boolean(call && !canSendDtmf)" class="visitor-pad">
          <SoftDialPad
            v-model="dialPadValue"
            :editable="!call"
            :placeholder="call ? '点击数字键发送按键' : '请输入被叫号码'"
            :input-label="call ? '已发送的通话按键' : '被叫号码'"
            @key="sendCallDtmf"
          />
        </fieldset>
        <p v-if="call" class="dial-hint">{{ canSendDtmf ? '按语音提示点击数字、* 或 #，按键会直接发送。' : '正在连接，接通后可按键。' }}</p>
      </div>
      <div v-if="!call" class="visitor-start">
        <label v-if="!voice" class="called-field">
          <span>被叫号码</span>
          <el-input v-model="called" maxlength="20" inputmode="numeric" :disabled="busy" @input="called = called.replace(/\D/g, '').slice(0, 20)" />
        </label>
        <el-button type="primary" size="large" :loading="busy" :disabled="!loaded || busy" @click="start">
          <el-icon><Phone v-if="voice" /><VideoCamera v-else /></el-icon>{{ voice ? '语音测试' : '视频呼叫' }}
        </el-button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.visitor-page { min-height: 100dvh; background: #f4f6f5; color: #252a28; }
header { display: flex; align-items: center; flex-wrap: wrap; gap: 20px; padding: 18px 24px; background: white; border-bottom: 1px solid #d8dfdb; }
header strong { font-size: 18px; color: #177b68; }
header span { font-size: 14px; }
.visitor-content { width: min(960px, 100%); box-sizing: border-box; margin: auto; padding: 24px; }
h1 { display: flex; align-items: center; gap: 10px; font-size: 24px; font-weight: 600; margin: 0 0 20px; overflow-wrap: anywhere; }
.visitor-start { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.called-field { display: flex; flex-direction: column; gap: 8px; width: min(320px, 100%); font-size: 14px; color: #5c6662; }
.visitor-voice-dial { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 16px; }
.visitor-pad { box-sizing: border-box; width: min(320px, 100%); min-width: 0; margin: 0; padding: 0; border: 0; }
.dial-mode-label { font-size: 14px; color: #5c6662; }
.dial-hint { margin: 0; font-size: 13px; line-height: 1.6; color: #68736e; text-align: center; }
.visitor-pad:disabled { opacity: 0.55; }
.el-alert { margin-bottom: 16px; }
@media (max-width: 600px) { .visitor-content { padding: 20px 12px; } }
</style>
