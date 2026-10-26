<template>
  <div class="m-shell">
    <header v-if="modules.enabled('icc')" class="m-header">
      <div class="m-header-main">
        <AgentStatusSelector />
        <SkillGroupSelector class="m-skill" />
      </div>
      <div class="m-header-meta">
        <span class="m-ext" :class="extClass" :title="extTitle">{{ extText }}</span>
        <span class="m-duration">{{ agent.durationText }}</span>
      </div>
    </header>

    <main class="m-main oa-scroll" :class="{ 'm-main--fill': fillMain }">
      <router-view v-slot="{ Component }">
        <keep-alive :include="KEEP_ALIVE">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>

    <nav class="m-tabbar">
      <button
        v-for="tab in visibleTabs"
        :key="tab.path"
        type="button"
        class="m-tab"
        :class="{ active: isActive(tab) }"
        @click="go(tab)"
      >
        <el-icon :size="21"><component :is="tab.icon" /></el-icon>
        <span class="m-tab-label">{{ tab.label }}</span>
        <span v-if="tab.badge?.value" class="m-tab-badge">
          {{ tab.badge.value > 99 ? '99+' : tab.badge.value }}
        </span>
      </button>
    </nav>

    <IncomingCallPopup v-if="modules.enabled('icc') || agent.callPhase !== 'idle'" />
  </div>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
import { computed, onMounted, onUnmounted, ref, watch, type Component, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChatDotRound, Phone, Microphone, User, Reading } from '@element-plus/icons-vue'
import { useAgentStore } from '@/stores/agent'
import { useAccessStore } from '@/stores/access'
import { useAgentInternalStore } from '@/stores/agentInternal'
import AgentStatusSelector from '@/components/AgentStatusSelector.vue'
import SkillGroupSelector from '@/components/SkillGroupSelector.vue'
import IncomingCallPopup from '@/components/IncomingCallPopup.vue'
import { startForegroundSync, stopForegroundSync } from '@/services/mobile-foreground'
import { syncPushDevice } from '@/services/mobile-push'
import { ensureSipRegistered, unregisterSip, watchSipRegistration } from '@/services/sip/registration'
import { getSipEngine } from '@/services/sip'
import { startCallCoordinator, stopCallCoordinator } from '@/services/sip/call-coordinator'
import { harmonyKeepAlive } from '@/services/sip/harmony-bridge'

const modules=useProductModulesStore()
const agent = useAgentStore()
const access = useAccessStore()
const agentIm = useAgentInternalStore()
const route = useRoute()
const router = useRouter()

/** 会话列表与留言列表保留滚动位置；聊天页每次进入都要拉最新消息，故不缓存 */
const KEEP_ALIVE = ['MobileSessionList', 'MobileMessages']

/** 聊天页与拨号盘自行撑满，不让外层再滚一层 */
const fillMain = computed(() => route.meta.mobileFill === true)

const voicemailBadge = ref(0)

interface MobileTab {
  label: string
  path: string
  icon: Component
  permission?: string
  badge?: Ref<number>
}

const allTabs: MobileTab[] = [
  { label: '全媒体', path: '/m/sessions', icon: ChatDotRound, permission: 'conversation.read' },
  { label: '话务', path: '/m/dialer', icon: Phone },
  { label: '留言', path: '/m/messages', icon: Microphone, permission: 'voicemail.read', badge: voicemailBadge },
  { label: '知识库', path: '/m/knowledge', icon: Reading, permission: 'knowledge.read' },
  { label: '我的', path: '/m/profile', icon: User },
]

const visibleTabs = computed(() =>
  allTabs.filter((t) => modules.canVisit(t.path) && (!t.permission || access.can(t.permission))),
)

function isActive(tab: MobileTab): boolean {
  return route.path === tab.path || route.path.startsWith(`${tab.path}/`)
}

function go(tab: MobileTab) {
  if (tab.badge) tab.badge.value = 0
  if (route.path === tab.path) return
  void router.push(tab.path)
}

const EXT_STATE_TEXT: Record<string, string> = {
  ext_unregistered: '分机未注册',
  ext_unavailable: '分机不可用',
  ext_not_exist: '分机不存在',
  offline: '未签入',
}

/** 状态文案由 AgentStatusSelector 负责，390px 的顶栏不重复显示同一句话，这里只报分机号。 */
const extText = computed(() => agent.profile.extension || '—')

const extClass = computed(() => ({
  'is-bad': agent.uiStatus.startsWith('ext_'),
  'is-off': agent.uiStatus === 'offline',
}))

const extTitle = computed(() => {
  const base = `分机 ${agent.profile.extension || '未绑定'}`
  const state = EXT_STATE_TEXT[agent.uiStatus]
  return state ? `${base}（${state}）` : base
})

function onVoicemailCreated() {
  if (!route.path.startsWith('/m/messages')) voicemailBadge.value += 1
}

/** 来电：不管当前在哪个 Tab，都跳到话务页由来电卡片接管 */
function onPhoneOffered() {
  if (!route.path.startsWith('/m/dialer')) void router.push('/m/dialer')
}

/**
 * 原生移动端在话务启动阶段注册分机；本监听对齐后续签入/签出。
 * 签出时反向注销，让 VDN 的 SipExtStatusSupport 把坐席摘出队列。
 */
watch(
  () => agent.agentId,
  (id, prev) => {
    // 鸿蒙的长时任务与签入状态绑定，值机才申请，签出立即释放
    if (!modules.enabled('icc')) return
    harmonyKeepAlive(Boolean(id))
    if (!getSipEngine().available) return
    if (id && !prev) {
      void ensureSipRegistered({ displayName: agent.profile.work_no }).catch((e: unknown) => {
        console.warn('[sip] register after sign-in failed', (e as Error).message)
      })
    } else if (!id && prev) {
      void unregisterSip()
    }
  },
  { immediate: true },
)

onMounted(() => {
  void access.refresh()
  if (modules.enabled('icc')) { agent.hydrate(); agent.startCcsPresenceWatch() }
  agentIm.wireEvents()
  startForegroundSync()
  if (modules.enabled('icc')) { watchSipRegistration(); startCallCoordinator() }
  void syncPushDevice()
  window.addEventListener('ccs:phone-offered', onPhoneOffered)
  window.addEventListener('omni:voicemail-created', onVoicemailCreated)
})

onUnmounted(() => {
  agent.stopCcsPresenceWatch()
  stopForegroundSync()
  stopCallCoordinator()
  window.removeEventListener('ccs:phone-offered', onPhoneOffered)
  window.removeEventListener('omni:voicemail-created', onVoicemailCreated)
})
</script>

<style scoped>
.m-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100dvh;
  background: var(--oa-bg);
}

.m-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: calc(var(--oa-mobile-header-h) + var(--oa-safe-top));
  padding: var(--oa-safe-top) calc(12px + var(--oa-safe-right)) 0 calc(12px + var(--oa-safe-left));
  background: linear-gradient(180deg, #fff 0%, #f0f6fc 100%);
  border-bottom: 1px solid #c5d5e8;
}

.m-header-main,
.m-header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.m-skill {
  min-width: 0;
}

.m-ext {
  font-size: 11px;
  color: var(--oa-muted);
  white-space: nowrap;
}
.m-ext.is-bad {
  color: #f56c6c;
  font-weight: 600;
}
.m-ext.is-off {
  color: #909399;
}

.m-duration {
  font-size: 12px;
  font-weight: 600;
  color: var(--oa-primary);
  font-variant-numeric: tabular-nums;
}

.m-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px calc(8px + var(--oa-safe-right)) 8px calc(8px + var(--oa-safe-left));
}
.m-main--fill {
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.m-main--fill > * {
  flex: 1 1 auto;
  min-height: 0;
}

.m-tabbar {
  flex-shrink: 0;
  display: flex;
  height: calc(var(--oa-mobile-tabbar-h) + var(--oa-safe-bottom));
  padding-bottom: var(--oa-safe-bottom);
  background: #fff;
  border-top: 1px solid #e4e7ed;
}

.m-tab {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: none;
  background: transparent;
  color: var(--oa-muted);
  /* 触控目标不小于 44px，避免误触相邻 Tab */
  min-height: 44px;
  cursor: pointer;
}
.m-tab.active {
  color: var(--oa-primary);
}
.m-tab-label {
  font-size: 11px;
  line-height: 1;
}
.m-tab-badge {
  position: absolute;
  top: 4px;
  left: 50%;
  margin-left: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 8px;
  background: #f56c6c;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}
</style>

<style>
/* 桌面组件里写死的 420px 弹窗在 390px 机型上会横向溢出，移动壳内统一收窄 */
.m-shell ~ .el-overlay .el-dialog,
body:has(.m-shell) .el-dialog {
  width: min(92vw, 420px) !important;
  margin-top: 12vh !important;
}
</style>
