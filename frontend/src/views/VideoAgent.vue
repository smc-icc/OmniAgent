<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Connection, SwitchButton } from '@element-plus/icons-vue'
import VideoCallPane from '@/components/VideoCallPane.vue'
import SkillGroupSelector from '@/components/SkillGroupSelector.vue'
import { useAgentStore } from '@/stores/agent'
import { getSipEngine, type SipCall } from '@/services/sip'
import { JsSipEngine } from '@/services/sip/jssip-engine'
import { fetchSipCredentials } from '@/api/mobile'
import { useAuthStore } from '@/stores/auth'
import { useExtensionBindingStore } from '@/stores/extension-binding'
import { getNativeShell } from '@/utils/platform'
import { onCcsEvt } from '@/services/ccs-agent'
import { signOutAllSkillGroups, updateAgentSkillGroups } from '@/api/skillGroups'

const router = useRouter()
const agent = useAgentStore()
const engine = getNativeShell() === 'web' ? new JsSipEngine() : getSipEngine()
const registration = ref(engine.registrationState())
const call = ref<SipCall | null>(null)
let answerRequested = false
const displayedCall = computed<SipCall | null>(() => call.value ?? (agent.currentCall ? {
  callId: `ccs:${agent.currentCall.CallID ?? 'pending'}`, sipCallId: '',
  remoteNumber: String(agent.currentCall.Caller ?? ''), remoteDisplayName: '视频客户',
  direction: 'inbound', state: 'incoming', connectedAt: 0, videoOffered: false, hasVideo: false,
} : null))
watch(() => agent.currentCall, value => { if (!value && !call.value) answerRequested = false })
const error = ref('')
const busy = ref(false)
let disposed = false
let connectedHere = false
const ready = computed(() => registration.value === 'registered' && Boolean(agent.agentId))
const off = [onCcsEvt('OnAgentOnCallEndEvt', () => {
  answerRequested = false
  const ended = call.value
  call.value = null
  if (ended) void engine.hangup(ended.callId).catch(() => undefined)
}), engine.on('registrationChanged', value => { registration.value = value.state }),
  engine.on('incomingCall', value => {
    call.value = value
    if (answerRequested) void engine.answer(value.callId, { video: value.videoOffered === true })
      .catch(e => { answerRequested = false; error.value = e instanceof Error ? e.message : '视频接听失败' })
  }),
  engine.on('callStateChanged', value => { call.value = value.state === 'disconnected' ? null : value }),
  engine.on('error', value => { error.value = value.message })]
async function action(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await fn() } catch (e) { error.value = e instanceof Error ? e.message : '操作失败' }
  finally { busy.value = false }
}
async function connect() {
  await action(async () => {
    await useAuthStore().startSocket()
    await agent.hydrate()
    const binding = useExtensionBindingStore()
    await binding.refresh()
    const credentials = await fetchSipCredentials({ purpose: 'video', client: 'web' })
    if (credentials.login_sid !== useAuthStore().user?.session_id || credentials.binding_version !== binding.binding.version)
      throw new Error('视频身份或分机绑定已变化，请重新连接')
    if (disposed) return
    await engine.register({ username: credentials.username, password: credentials.password, realm: credentials.realm,
      proxyHost: credentials.proxy.host, proxyPort: credentials.proxy.port, transport: credentials.proxy.transport,
      srtp: credentials.srtp, codecs: credentials.codecs, registerExpiresS: credentials.register_expires_s,
      stunServer: credentials.stun_server || undefined, iceEnabled: credentials.ice_enabled,
      displayName: agent.profile.work_no, wssUrl: credentials.web?.wss_url, iceServers: credentials.web?.ice_servers })
    if (disposed) { await engine.unregister(); return }
    if (!agent.agentId) await agent.ccsSignIn()
    connectedHere = true
    if (credentials.video?.group_ids.length && credentials.video.skill_ids.length) {
      await signOutAllSkillGroups()
      await updateAgentSkillGroups(credentials.video.group_ids.map(String))
      const signed = await agent.invokeAgent('DoAgentSignInSkill', {
        count: credentials.video.skill_ids.length, agentSkillIDs: credentials.video.skill_ids,
      })
      // ACD 的错误码里 9 = ACD_SkillAlreadySignIn「技能已经签入」，
      // 目标状态已达成，属于成功。原来只判 === 0 会把 9 当失败抛出
      // 「视频技能签入失败」，导致 connect() 中断、页面停在半连接状态。
      const signCode = Number(signed.Result ?? signed.Status ?? 0)
      if (signCode !== 0 && signCode !== 9) throw new Error('视频技能签入失败')
      await agent.setStatus('ready')
      window.dispatchEvent(new Event('omni:skill-groups-changed'))
    }
    if (disposed || engine.registrationState() !== 'registered') { await disconnect(); throw new Error('分机注册已断开') }
  })
}
async function disconnect() {
  // Leave dispatch before stopping the browser transport.
  if (call.value) await hangupVideoCall().catch(() => undefined)
  if (connectedHere && agent.agentId) {
    await signOutAllSkillGroups().catch(() => undefined)
    await agent.setStatus('offline').catch(() => undefined)
  }
  await engine.unregister()
  connectedHere = false
}
async function answerVideoCall() {
  answerRequested = true
  if (call.value) {
    await engine.answer(call.value.callId, { video: call.value.videoOffered === true })
    if (localStorage.getItem('omni_sip_require_ccs_answer') === '1') await agent.answerCall()
  } else if (agent.currentCall) {
    // CCS offered first: request the software-phone leg, then answer only that
    // incoming SIP leg in this page's engine listener. No shared coordinator.
    await agent.answerCall()
  }
}
async function hangupVideoCall() {
  answerRequested = false
  const active = call.value
  if (active) await engine.hangup(active.callId).catch(() => undefined)
  if (agent.currentCall) await agent.releaseCall()
}
onMounted(async () => {
  await useAuthStore().startSocket()
  await agent.hydrate()
})
onBeforeUnmount(() => { disposed = true; off.forEach(fn => fn()); void disconnect() })
</script>

<template>
  <main class="agent-video-page">
    <header><el-button text title="返回工作台" @click="router.push('/omnichannel')"><el-icon><ArrowLeft /></el-icon></el-button><h1>视频坐席</h1><span>{{ agent.profile.work_no }} / {{ agent.profile.extension || '未绑定分机' }}</span><el-tag :type="ready ? 'success' : 'info'">{{ ready ? agent.statusLabel : registration === 'registering' ? '注册中' : '未接入' }}</el-tag></header>
    <div class="agent-video-content">
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <div class="agent-video-tools">
        <template v-if="!ready"><el-button type="primary" :loading="busy" @click="connect"><el-icon><Connection /></el-icon>接入分机</el-button></template>
        <template v-else><SkillGroupSelector /><el-button :disabled="busy || Boolean(call)" @click="action(() => agent.setStatus(agent.uiStatus === 'ready' ? 'busy' : 'ready'))">{{ agent.uiStatus === 'ready' ? '示忙' : '示闲' }}</el-button><el-button @click="action(disconnect)"><el-icon><SwitchButton /></el-icon>签出</el-button></template>
      </div>
      <VideoCallPane :engine="engine" :call="displayedCall" answerable @answer="action(answerVideoCall)" @hangup="action(hangupVideoCall)" @error="error = $event" />
    </div>
  </main>
</template>

<style scoped>
.agent-video-page { min-height: 100dvh; background: #f4f6f5; color: #252a28; }
header { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; padding: 12px 20px; background: white; border-bottom: 1px solid #d8dfdb; }
header h1 { margin: 0; font-size: 20px; font-weight: 600; }
header span { font-size: 13px; overflow-wrap: anywhere; }
.agent-video-content { width: min(1120px, 100%); box-sizing: border-box; margin: auto; padding: 20px; }
.agent-video-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-height: 48px; margin-bottom: 16px; }
.agent-video-tools .el-input { width: 220px; max-width: 100%; }
.el-alert { margin-bottom: 16px; }
@media (max-width: 600px) { .agent-video-content { padding: 16px 12px; } }
</style>

