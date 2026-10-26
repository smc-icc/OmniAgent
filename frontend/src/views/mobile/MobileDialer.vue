<template>
  <div class="md-wrap">
    <section class="md-status">
      <VoiceSignIn />
      <div class="md-reg" :class="regClass">
        <el-icon :size="14"><Connection /></el-icon>
        <span>{{ regText }}</span>
      </div>
      <el-button
        v-if="agent.agentId && sipAvailable && registration !== 'registered'"
        size="small"
        text
        :loading="registering"
        @click="reRegister"
      >
        重新注册
      </el-button>
    </section>

    <section v-if="inCall" class="md-call">
      <div class="md-peer">{{ peerNumber || '未知号码' }}</div>
      <div class="md-phase">{{ phaseText }}</div>

      <div class="md-actions">
        <el-button
          v-if="agent.callPhase === 'ringing'"
          type="success"
          size="large"
          round
          class="md-act"
          :loading="busy === 'answer'"
          @click="onAnswer"
        >
          接听
        </el-button>
        <el-button
          v-if="agent.callPhase === 'talking'"
          size="large"
          round
          class="md-act"
          :loading="busy === 'hold'"
          @click="onHold(true)"
        >
          保持
        </el-button>
        <el-button
          v-if="agent.callPhase === 'held'"
          size="large"
          round
          class="md-act"
          :loading="busy === 'hold'"
          @click="onHold(false)"
        >
          恢复
        </el-button>
        <el-button
          v-if="agent.callPhase === 'talking' || agent.callPhase === 'held'"
          size="large"
          round
          class="md-act"
          :type="agent.callMuted ? 'warning' : 'default'"
          :loading="busy === 'mute'"
          @click="onMute"
        >
          {{ agent.callMuted ? '取消静音' : '静音' }}
        </el-button>
        <el-button
          v-if="sipAvailable"
          size="large"
          round
          class="md-act"
          :type="speakerOn ? 'primary' : 'default'"
          @click="onSpeaker"
        >
          {{ speakerOn ? '免提中' : '免提' }}
        </el-button>
        <el-button
          type="danger"
          size="large"
          round
          class="md-act"
          :loading="busy === 'hangup'"
          @click="onHangup"
        >
          挂断
        </el-button>
      </div>
    </section>

    <section class="md-pad">
      <SoftDialPad v-model="number" @key="onPadKey" />
      <div v-if="!inCall" class="md-callout-row">
        <el-button
          type="primary"
          size="large"
          class="md-callout"
          :loading="busy === 'callout'"
          :disabled="!number.trim()"
          @click="onCallOut(0)"
        >
          <el-icon class="md-callout-ico"><PhoneFilled /></el-icon>
          语音拨号
        </el-button>
        <el-button
          type="success"
          size="large"
          class="md-callout"
          :loading="busy === 'video-callout'"
          :disabled="!number.trim() || sip.videoAvailable === false"
          @click="onCallOut(1)"
        >
          视频拨号
        </el-button>
      </div>
      <p v-else class="md-pad-hint">通话中按键将作为 DTMF 发送</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import VoiceSignIn from '@/components/auth/VoiceSignIn.vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Connection, PhoneFilled } from '@element-plus/icons-vue'
import SoftDialPad from '@/components/SoftDialPad.vue'
import { useAgentStore } from '@/stores/agent'
import { getNativeShell } from '@/utils/platform'
import { getSipEngine, type SipRegistrationState, type SipCall } from '@/services/sip'
import { ensureSipRegistered } from '@/services/sip/registration'
import { answerActiveCall, hangupActiveCall, muteActiveCall } from '@/services/sip/call-coordinator'

defineOptions({ name: 'MobileDialer' })

const agent = useAgentStore()
const route = useRoute()
const sip = getSipEngine()

const number = ref('')
const busy = ref<'' | 'answer' | 'hangup' | 'hold' | 'mute' | 'callout' | 'video-callout'>('')
const activeSipCall = ref<SipCall | null>(null)
const speakerOn = ref(false)
const registering = ref(false)
const registration = ref<SipRegistrationState>(sip.registrationState())

const sipAvailable = computed(() => sip.available)
const inCall = computed(() => agent.callPhase !== 'idle')

const peerNumber = computed(() => {
  const call = agent.currentCall as Record<string, unknown> | null
  if (!call) return ''
  return String(call.Caller ?? call.sCallerNO ?? call.Called ?? '')
})

const phaseText = computed(() => {
  switch (agent.callPhase) {
    case 'ringing':
      return agent.ringCountdownText ? `振铃 ${agent.ringCountdownText}` : '振铃中'
    case 'talking':
      return `通话中 ${agent.durationText}`
    case 'held':
      return '已保持'
    default:
      return ''
  }
})

const regText = computed(() => {
  if (getNativeShell() === 'web') return '外部话机（由 FS 管理注册）'
  if (!sipAvailable.value) return '本机无语音能力'
  switch (registration.value) {
    case 'registered':
      return `分机已注册 ${agent.profile.extension}`
    case 'registering':
      return '分机注册中'
    case 'failed':
      return '分机注册失败'
    default:
      return '分机未注册'
  }
})

const regClass = computed(() => ({
  'is-ok': registration.value === 'registered',
  'is-bad': registration.value === 'failed' || registration.value === 'unregistered',
}))

async function reRegister() {
  registering.value = true
  try {
    await ensureSipRegistered({ force: true })
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '注册失败')
  } finally {
    registering.value = false
  }
}

async function run(tag: typeof busy.value, fn: () => Promise<unknown>, failMsg: string) {
  if (busy.value) return
  busy.value = tag
  try {
    await fn()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : failMsg)
  } finally {
    busy.value = ''
  }
}

// 接听/挂断/静音统一走协调器：它是 CCS 腿与 SIP 腿的唯一决策点
function onAnswer() {
  void run('answer', () => answerActiveCall(), '接听失败')
}

function onHangup() {
  void run('hangup', hangupActiveCall, '挂断失败')
}

/** 保持要放音乐给对端，必须走 CCS，不能只在本机 hold */
function onHold(on: boolean) {
  void run('hold', () => (on ? agent.holdCall() : agent.retrieveCall()), '操作失败')
}

function onMute() {
  const next = !agent.callMuted
  void run('mute', () => muteActiveCall(next), '静音操作失败')
}

async function onSpeaker() {
  const next = !speakerOn.value
  try {
    await sip.setAudioRoute(next ? 'speaker' : 'earpiece')
    speakerOn.value = next
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '切换免提失败')
  }
}

function onCallOut(mediaType: 0 | 1) {
  const callee = number.value.trim()
  if (!callee) return
  const tag = mediaType === 1 ? 'video-callout' : 'callout'
  void run(tag, async () => {
    await agent.callOut(callee, undefined, mediaType)
    ElMessage.success(`${mediaType === 1 ? '视频' : '语音'}外呼 ${callee} 已发起`)
  }, '外呼失败')
}

/** 通话中按键立即当 DTMF 发出；空闲时只是输号码 */
function onPadKey(digit: string) {
  if (!inCall.value) return
  number.value = ''
  void sip.sendDtmf(digit).catch((e: unknown) => {
    ElMessage.error(e instanceof Error ? e.message : 'DTMF 发送失败')
  })
}

let offReg: (() => void) | null = null
const offCalls: Array<() => void> = []

function syncSipCall(call: SipCall) {
  if (call.state !== 'disconnected') activeSipCall.value = call
  else if (activeSipCall.value?.callId === call.callId) activeSipCall.value = null
}

/** 留言回电、客户资料呼叫都带 ?callee= 过来，直接填进号码框 */
function applyCalleeQuery() {
  const callee = String(route.query.callee ?? '').trim()
  if (callee) number.value = callee
}

watch(() => route.query.callee, applyCalleeQuery)

onMounted(() => {
  applyCalleeQuery()
  registration.value = sip.registrationState()
  offReg = sip.on('registrationChanged', ({ state }) => {
    registration.value = state
  })
  offCalls.push(sip.on('incomingCall', syncSipCall), sip.on('callStateChanged', syncSipCall))
  offCalls.push(sip.on('mediaStateChanged', ({ callId, localVideo, remoteVideo }) => {
    if (activeSipCall.value?.callId === callId) {
      activeSipCall.value = { ...activeSipCall.value, hasVideo: Boolean(localVideo || remoteVideo) }
    }
  }))
  void sip.calls().then(calls => {
    const call = calls.find(item => item.state !== 'disconnected')
    if (call) syncSipCall(call)
  }).catch(() => undefined)
})

onUnmounted(() => {
  offReg?.()
  offCalls.forEach(off => off())
})
</script>

<style scoped>
.md-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 10px calc(12px + var(--oa-safe-right)) 10px calc(12px + var(--oa-safe-left));
  gap: 10px;
  overflow-y: auto;
}

.md-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.md-reg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--oa-muted);
}
.md-reg.is-ok {
  color: #67c23a;
}
.md-reg.is-bad {
  color: #f56c6c;
  font-weight: 600;
}

.md-call {
  flex-shrink: 0;
  background: var(--oa-card);
  border-radius: 10px;
  padding: 14px 12px;
  text-align: center;
}
.md-peer {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.md-phase {
  margin-top: 4px;
  font-size: 13px;
  color: var(--oa-primary);
}
.md-actions {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.md-act {
  width: 100%;
  min-height: 44px;
  margin: 0;
}

.md-pad {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 10px;
  background: var(--oa-card);
  border-radius: 10px;
  padding: 12px;
}
.md-callout-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.md-callout {
  width: 100%;
  min-height: 48px;
}
.md-callout-ico {
  margin-right: 6px;
}
.md-pad-hint {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--oa-muted);
}
</style>
