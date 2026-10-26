<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules = useProductModulesStore()

import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Phone, PhoneFilled } from '@element-plus/icons-vue'
import { useAgentStore } from '@/stores/agent'
import { useDesktopCallMediaStore } from '@/stores/desktop-call-media'
import { answerActiveCall } from '@/services/sip/call-coordinator'
import { useMobileLayout } from '@/utils/platform'
import { callPartyName } from '@/utils/call-display'

const agent = useAgentStore()
const router = useRouter()

const visible = computed(() => {
  if (!agent.currentCall) return false
  const t = Number(agent.currentCall.CallOfferedType ?? 0)
  const data = String(agent.currentCall.CallData ?? '')
  // 坐席互呼 / 强插 / 监听：只进会话列表，不弹「新来电」
  if (t === 2 || t === 5 || t === 6 || t === 9 || data.startsWith('agent_')) return false
  return agent.callPhase === 'ringing' || agent.callPhase === 'talking' || agent.callPhase === 'held'
})

const callerName = computed(() => callPartyName(agent.currentCall?.Caller, agent.currentCall?.MediaType ?? 0))
const mediaLabel = computed(() => Number(agent.currentCall?.MediaType ?? 0) === 1 ? '视频' : '语音')

const offeredType = computed(() => Number(agent.currentCall?.CallOfferedType ?? 0))
const isOutbound = computed(() => offeredType.value === 10)
const title = computed(() => {
  const t = new Date().toLocaleTimeString()
  if (isOutbound.value) return `新去电-${agent.currentCall?.Called ?? ''} ${t}`
  return `新来电-${callerName.value} ${t}`
})
const phaseText = computed(() => {
  if (agent.callPhase === 'talking') return '通话中'
  if (agent.callPhase === 'held') return '保持中'
  if (agent.callPhase === 'ringing' && agent.ringCountdownText) {
    return `${isOutbound.value ? '外呼振铃' : '来电振铃'} ${agent.ringCountdownText}`
  }
  return isOutbound.value ? '外呼振铃' : '来电振铃'
})

function goSession() {
  void router.push(useMobileLayout() ? '/m/dialer' : '/omnichannel')
}

async function onAnswer() {
  if (useMobileLayout()) await answerActiveCall()
  else await useDesktopCallMediaStore().answer()
  goSession()
}
</script>

<template>
  <div v-if="visible && (productModules.enabled('icc') || agent.callPhase !== 'idle')" class="in-call-pop" :class="`phase-${agent.callPhase}`">
    <div class="in-call-pop-head">
      <el-icon class="in-call-pop-ico" :aria-label="mediaLabel === '视频' ? '视频来电' : '语音来电'"><VideoCameraFilled v-if="mediaLabel === '视频'" /><PhoneFilled v-else /></el-icon>
      <strong>{{ title }}</strong>
      <em>{{ phaseText }}</em>
    </div>
    <div class="in-call-pop-body">
      <div>主叫：{{ callerName || '—' }}</div>
      <div>通话类型：{{ mediaLabel }}</div>
      <div>被叫：{{ agent.currentCall?.Called || '—' }}</div>
      <div v-if="agent.currentCall?.SkillGroupName">
        技能组：{{ agent.currentCall.SkillGroupName }}
      </div>
    </div>
    <div class="in-call-pop-actions">
      <el-button size="small" @click="goSession">打开会话</el-button>
      <el-button
        v-if="agent.callPhase === 'ringing' && !isOutbound"
        type="primary"
        size="small"
        @click="onAnswer"
      >
        <el-icon><Phone /></el-icon>
        应答
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.in-call-pop {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 4000;
  width: 320px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 28px rgba(15, 40, 80, 0.22);
  border: 1px solid #c5d5e8;
}
.in-call-pop.phase-ringing {
  border-color: #e6a23c;
  animation: in-call-pulse 1.2s ease-in-out infinite;
}
.phase-ringing .in-call-pop-ico {
  color: #e6a23c;
  animation: phone-ring-shake 0.7s ease-in-out infinite;
  transform-origin: 70% 20%;
}
@keyframes phone-ring-shake {
  0% { transform: rotate(0deg); }
  12% { transform: rotate(16deg); }
  24% { transform: rotate(-14deg); }
  36% { transform: rotate(12deg); }
  48% { transform: rotate(-10deg); }
  60% { transform: rotate(6deg); }
  72% { transform: rotate(-4deg); }
  84%,
  100% { transform: rotate(0deg); }
}
.in-call-pop-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.in-call-pop-head strong {
  flex: 1;
  font-size: 13px;
}
.in-call-pop-head em {
  font-style: normal;
  font-size: 12px;
  color: #e6a23c;
}
.phase-talking .in-call-pop-head em {
  color: #67c23a;
}
.in-call-pop-ico {
  color: #409eff;
}
.in-call-pop-body {
  font-size: 13px;
  line-height: 1.7;
  color: #334;
}
.in-call-pop-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@keyframes in-call-pulse {
  0%,
  100% {
    box-shadow: 0 8px 28px rgba(230, 162, 60, 0.18);
  }
  50% {
    box-shadow: 0 8px 28px rgba(230, 162, 60, 0.45);
  }
}
</style>
