<template>
  <div class="mp-wrap">
    <section class="mp-card mp-id">
      <div class="mp-avatar">{{ productModules.enabled('icc') ? agent.avatarText : (auth.user?.name || '用户').slice(0,1) }}</div>
      <div class="mp-id-body">
        <div class="mp-name">{{ productModules.enabled('icc') ? (agent.profile.name || auth.user?.name || '坐席') : (auth.user?.name || '用户') }}</div>
        <div class="mp-meta">工号 {{ agent.profile.work_no || auth.user?.work_no || '—' }}<template v-if="productModules.enabled('icc')"> · 分机 <ExtensionBindingStatus /></template></div>
      </div>
    </section>

    <LoginVdnPanel />

    <section v-if="productModules.enabled('icc')" class="mp-card">
      <h3 class="mp-sub">话务</h3>
      <div class="mp-row">
        <span class="mp-label">坐席状态</span>
        <span class="mp-value">{{ agent.statusLabel }}</span>
      </div>
      <div class="mp-row">
        <span class="mp-label">在线时长</span>
        <span class="mp-value">{{ agent.durationText }}</span>
      </div>
      <div class="mp-row">
        <span class="mp-label">分机注册</span>
        <span class="mp-value" :class="{ 'is-bad': registration !== 'registered' }">
          {{ regText }}
        </span>
      </div>
      <div class="mp-ops">
        <VoiceSignIn />
        <el-button
          v-if="sipAvailable && agent.agentId"
          size="large"
          :loading="registering"
          @click="reRegister"
        >
          重新注册分机
        </el-button>
        <el-button
          v-if="agent.agentId"
          size="large"
          type="warning"
          :loading="signingOut"
          @click="signOutCcs"
        >
          话务签出
        </el-button>
      </div>
    </section>

    <section v-if="productModules.enabled('icc')" class="mp-card">
      <h3 class="mp-sub">视频配置</h3>
      <AgentVideoConfigDetails
        :config="agent.profile.video_config"
        :registration="videoIdentityActive ? registration : 'unregistered'"
        :registered-extension="videoIdentityActive ? sipIdentity?.username : ''"
      />
      <p v-if="agent.profile.video_config?.mobile_enabled && sip.videoAvailable === false" class="mp-hint">本机当前版本未接入视频能力，保留电话分机注册。</p>
      <p v-if="sipIdentity?.purpose === 'video'" class="mp-hint">当前本机使用视频分机，电话分机由原电话终端接听。</p>
    </section>

    <section v-if="productModules.enabled('icc')" class="mp-card">
      <h3 class="mp-sub">来电推送</h3>
      <div class="mp-row">
        <span class="mp-label">服务端配置</span>
        <span class="mp-value">{{ push.push_configured ? '已启用' : '未配置' }}</span>
      </div>
      <div class="mp-row">
        <span class="mp-label">本机设备</span>
        <span class="mp-value">
          {{ push.devices.length ? push.devices.map((d) => d.provider).join(' / ') : '未注册' }}
        </span>
      </div>
      <p class="mp-hint">
        App 退到后台时来电靠推送唤醒。若长期收不到来电，请在系统设置里允许本应用自启动与后台运行。
      </p>
    </section>

    <section v-if="productModules.enabled('icc') && sipAvailable" class="mp-card">
      <h3 class="mp-sub">联调开关</h3>
      <div class="mp-row">
        <span class="mp-label">应答后补发 CCS 摘机</span>
        <el-switch v-model="ccsAnswer" @change="onCcsAnswerChange" />
      </div>
      <p class="mp-hint">
        软件摘挂机模式下 TAS 通常能从 SIP 200 OK 推出摘机。若实测发现坐席停在振铃不进通话，
        打开本开关让 App 在应答 SIP 之后补发 DoAgentAnswerCall。
      </p>
    </section>

    <section class="mp-card">
      <el-button size="large" class="mp-logout" type="danger" plain @click="onLogout">
        退出登录
      </el-button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules=useProductModulesStore()

import ExtensionBindingStatus from '@/components/ExtensionBindingStatus.vue'
import AgentVideoConfigDetails from '@/components/AgentVideoConfigDetails.vue'
import LoginVdnPanel from '@/components/auth/LoginVdnPanel.vue'
import VoiceSignIn from '@/components/auth/VoiceSignIn.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAgentStore } from '@/stores/agent'
import { getNativeShell } from '@/utils/platform'
import { useAuthStore } from '@/stores/auth'
import { getSipEngine, type SipRegistrationState } from '@/services/sip'
import { ensureSipRegistered, unregisterSip, registeredSipIdentity } from '@/services/sip/registration'
import { requireCcsAnswer, setRequireCcsAnswer } from '@/services/sip/call-coordinator'
import { api } from '@/api/client'

defineOptions({ name: 'MobileProfile' })

interface PushStatus {
  push_configured: boolean
  devices: Array<{ provider: string; voip: boolean; platform: string; token_tail: string }>
}

const agent = useAgentStore()
const auth = useAuthStore()
const router = useRouter()
const sip = getSipEngine()
const sipIdentity = ref(registeredSipIdentity())
const updateSipIdentity = () => { sipIdentity.value = registeredSipIdentity() }
const videoIdentityActive = computed(() => agent.profile.video_config?.enabled
  && agent.profile.video_config?.mobile_enabled && sipIdentity.value?.allowVideo === true && sip.videoAvailable !== false)

const registration = ref<SipRegistrationState>(sip.registrationState())
const registering = ref(false)
const signingOut = ref(false)
const push = ref<PushStatus>({ push_configured: false, devices: [] })
const ccsAnswer = ref(requireCcsAnswer())

const sipAvailable = computed(() => sip.available)

const regText = computed(() => {
  if (getNativeShell() === 'web') return '外部话机（由 FS 管理注册）'
  if (!sipAvailable.value) return '本机无语音能力'
  switch (registration.value) {
    case 'registered':
      return '已注册'
    case 'registering':
      return '注册中'
    case 'failed':
      return '注册失败'
    default:
      return '未注册'
  }
})

async function reRegister() {
  registering.value = true
  try {
    await ensureSipRegistered({ force: true })
    ElMessage.success('已重新发起注册')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '注册失败')
  } finally {
    registering.value = false
  }
}

async function signOutCcs() {
  signingOut.value = true
  try {
    await agent.setStatus('offline')
    await unregisterSip()
    ElMessage.success('已话务签出')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '签出失败')
  } finally {
    signingOut.value = false
  }
}

async function onLogout() {
  try {
    await ElMessageBox.confirm('退出登录会同时话务签出，确定继续？', '退出登录', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  if (agent.agentId) await agent.setStatus('offline').catch(() => undefined)
  await unregisterSip()
  await auth.logout()
  void router.push({ name: 'login' })
}

function onCcsAnswerChange(value: string | number | boolean) {
  setRequireCcsAnswer(value === true)
}

async function loadPush() {
  try {
    const { data } = await api.get<PushStatus>('/api/agent/push-devices')
    push.value = data
  } catch {
    /* 推送未配置时接口可能不可用，静默即可 */
  }
}

let offReg: (() => void) | null = null

onMounted(() => {
  if (!productModules.enabled('icc')) return
  window.addEventListener('omni:sip-identity-changed', updateSipIdentity)
  registration.value = sip.registrationState()
  offReg = sip.on('registrationChanged', ({ state }) => {
    registration.value = state
  })
  void loadPush()
  void agent.hydrateProfile()
})

onUnmounted(() => {
  window.removeEventListener('omni:sip-identity-changed', updateSipIdentity)
  offReg?.()
})
</script>

<style scoped>
.mp-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mp-card {
  background: var(--oa-card);
  border-radius: 8px;
  padding: 12px;
}

.mp-id {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mp-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--oa-primary);
  color: #fff;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mp-id-body {
  min-width: 0;
}
.mp-name {
  font-size: 17px;
  font-weight: 700;
}
.mp-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--oa-muted);
}

.mp-sub {
  margin: 0 0 8px;
  font-size: 14px;
}

.mp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 0;
  font-size: 13px;
  border-bottom: 1px solid #f0f2f5;
}
.mp-row:last-of-type {
  border-bottom: none;
}
.mp-label {
  color: var(--oa-muted);
}
.mp-value {
  font-weight: 600;
}
.mp-value.is-bad {
  color: #f56c6c;
}

.mp-ops {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mp-ops .el-button {
  width: 100%;
  margin: 0;
}

.mp-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--oa-muted);
}

.mp-logout {
  width: 100%;
}
</style>
