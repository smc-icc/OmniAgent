<template>
  <div class="oa-shell">
    <header class="oa-header">
      <div class="oa-header-left">
        <span class="oa-logo">SeaMiCloud</span>
        <template v-if="voiceEnabled">
        <AcdQueuingBar />
        <SkillGroupSelector class="oa-queue" />
        <div class="oa-dial-field">
          <span class="oa-dial-label">主叫</span>
          <el-input
            v-model="caller"
            placeholder="主叫号码"
            size="small"
            class="oa-dial-input"
          />
        </div>
        <div class="oa-dial-field">
          <span class="oa-dial-label">被叫</span>
          <el-input
            v-model="dial"
            placeholder="被叫号码"
            size="small"
            class="oa-dial-input"
            @keyup.enter="openDialDialog"
          >
            <template #suffix>
              <button
                type="button"
                class="oa-dial-phone-btn"
                :class="{ 'is-ringing': agent.callPhase === 'ringing' }"
                :title="dial.trim() ? '外呼' : '输入被叫号码'"
                @click="onCalleePhoneClick"
              >
                <el-icon><Phone /></el-icon>
              </button>
            </template>
          </el-input>
        </div>
        <el-button v-permission="'conversation.create'"
          size="small"
          class="oa-outbound-btn"
          :class="{ 'is-ringing': agent.callPhase === 'ringing' }"
          title="外呼"
          :loading="outboundBusy && agent.callPhase !== 'ringing'"
          :disabled="outboundBusy && agent.callPhase !== 'ringing'"
          @click="onOutboundCall"
        >
          <el-icon class="oa-call-ico" :class="{ 'is-ringing': agent.callPhase === 'ringing' }">
            <PhoneFilled />
          </el-icon>
          <span>{{
            agent.callPhase === 'ringing'
              ? `振铃 ${agent.ringCountdownText || ''}`.trim()
              : outboundBusy
                ? '外呼中'
                : '外呼'
          }}</span>
        </el-button>
        </template>
      </div>
      <div class="oa-header-right">
        <span v-if="voiceEnabled" class="oa-status-line">
          当前状态: <em :class="statusClass">{{ agent.statusLabel }}</em>
        </span>
        <span v-if="voiceEnabled" class="oa-duration">时长: {{ agent.durationText }}</span>
        <AgentStatusSelector v-if="voiceEnabled" class="oa-status-select" />
        <TenantSelector />
        <AgentIdentity />
      </div>
    </header>

    <div class="oa-body">
      <aside class="oa-rail">
        <div class="oa-rail-nav">
          <div
            v-for="item in railItems"
            :key="item.title"
            class="oa-rail-item"
            :class="{ active: isRailActive(item) }"
            :title="item.title"
            @click="goRail(item)"
          >
            <el-icon :size="22"><component :is="item.icon" /></el-icon>
            <span
              v-if="isMessageCenter(item) && voicemailBadge > 0"
              class="oa-rail-badge"
            >{{ voicemailBadge > 9 ? '...' : voicemailBadge }}</span>
          </div>
          <GlobalSearch compact />
        </div>
        <div
          class="oa-rail-item oa-rail-settings"
          :class="{ active: settingsActive }"
          title="设置"
          @click="goSettings"
        >
          <el-icon :size="22"><Setting /></el-icon>
        </div>
      </aside>

      <main class="oa-main" :class="{ 'oa-main--fill': fillMain }">
        <router-view v-slot="{ Component }">
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>
    </div>

    <IncomingCallPopup v-if="modules.enabled('icc') || agent.callPhase !== 'idle'" />
    <VideoCallPane
      v-if="desktopMedia.engine && desktopMedia.call"
      class="desktop-call-audio"
      :engine="desktopMedia.engine"
      :call="desktopMedia.call"
      audio-only
      :show-controls="false"
      :show-status="false"
    />

    <el-dialog
      v-model="dialDialogVisible"
      title="被叫号码"
      width="320px"
      append-to-body
      class="oa-dial-dialog"
      @closed="onDialDialogClosed"
    >
      <SoftDialPad v-model="dialDialogNumber" />
      <template #footer>
        <el-button @click="dialDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmDial">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import {
  HomeFilled,
  Monitor,
  Microphone,
  Grid,
  Phone,
  Document,
  List,
  UserFilled,
  PhoneFilled,
  Setting,
  Tools,
  Reading,
} from '@element-plus/icons-vue'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'
import { useAccessStore } from '@/stores/access'
import { useAgentInternalStore } from '@/stores/agentInternal'
import { useSmsRoleStore } from '@/stores/smsRole'
import AgentStatusSelector from '@/components/AgentStatusSelector.vue'
import SkillGroupSelector from '@/components/SkillGroupSelector.vue'
import AcdQueuingBar from '@/components/AcdQueuingBar.vue'
import AgentIdentity from '@/components/AgentIdentity.vue'
import TenantSelector from '@/components/TenantSelector.vue'
import GlobalSearch from '@/components/GlobalSearch.vue'
import SoftDialPad from '@/components/SoftDialPad.vue'
import IncomingCallPopup from '@/components/IncomingCallPopup.vue'
import VideoCallPane from '@/components/VideoCallPane.vue'
import { useDesktopCallMediaStore } from '@/stores/desktop-call-media'

const agent = useAgentStore()
const desktopMedia = useDesktopCallMediaStore()
const auth = useAuthStore()
const agentIm = useAgentInternalStore()
const route = useRoute()
const router = useRouter()

/** 全媒体页需要锁死主区高度（底栏不随内容滚走）；首页等保持可滚动铺满 */
const fillMain = computed(() => route.name === 'omnichannel')

const caller = ref('')
const dial = ref('')
const dialDialogVisible = ref(false)
const dialDialogNumber = ref('')
const outboundBusy = ref(false)

watch(
  () => agent.profile.extension,
  (ext) => {
    if (ext && !caller.value) caller.value = ext
  },
  { immediate: true },
)

function openDialDialog() {
  dialDialogNumber.value = dial.value
  dialDialogVisible.value = true
}

function onCalleePhoneClick() {
  if (dial.value.trim()) {
    void onOutboundCall()
    return
  }
  openDialDialog()
}

function onDialDialogClosed() {
  dialDialogNumber.value = dial.value
}

function confirmDial() {
  const num = dialDialogNumber.value.trim()
  if (!num) {
    ElMessage.warning('请输入被叫号码')
    return
  }
  dial.value = num
  dialDialogVisible.value = false
}

async function onOutboundCall() {
  const callee = dial.value.trim()
  if (!callee) {
    ElMessage.warning('请先输入被叫号码')
    return
  }
  if (outboundBusy.value) return
  if (agent.callPhase === 'talking' || agent.callPhase === 'held') {
    ElMessage.warning('当前已有通话，请结束后再外呼')
    return
  }
  if (!agent.agentId) {
    ElMessage.warning('请先话务签入后再外呼')
    return
  }
  outboundBusy.value = true
  ElMessage.info(`正在外呼 ${callee}…`)
  try {
    const ack = await agent.callOut(callee, caller.value.trim() || agent.profile.extension)
    const msg = typeof ack?.errMsg === 'string' ? ack.errMsg : ''
    if (/timeout/i.test(msg)) {
      ElMessage.warning(`外呼 ${callee} 已发出，等待对端振铃`)
    } else {
      ElMessage.success(`外呼 ${callee} 已发起`)
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '外呼失败')
  } finally {
    outboundBusy.value = false
  }
}

const voicemailBadge = ref(0)

/**
 * 统一的「留言」入口 —— 左侧导航直达留言面板（一级页面）。
 *
 * 原来留言散在三处（左侧「语音留言」页、业务入口的「留言/离线消息处理」、
 * 全媒体客服右侧栏的「在线留言」tab），坐席找不到也容易重复处理，这里收敛成一处。
 * 现在不再走「业务导航 → 留言」两级跳转，点一下就是留言面板。
 */
const MESSAGE_CENTER_ROUTE = '/messages'

function onVoicemailCreated() {
  if (!isMessageCenterRoute()) voicemailBadge.value += 1
}

/** 当前是否停在留言中心 */
function isMessageCenterRoute(): boolean {
  return route.path === MESSAGE_CENTER_ROUTE
}

/** 某个 rail 项是否是留言中心入口 */
function isMessageCenter(item: RailItem): boolean {
  return item.path === MESSAGE_CENTER_ROUTE
}

type RailItem = {
  title: string
  path: string
  icon: Component
  /** 仅班长（administrator）可见 */
  adminOnly?: boolean
  permission?: string
}

// 高亮已改为按 path 匹配（见 isRailActive），调整顺序不会再影响高亮，
// 因此数组顺序可以自由安排；带 adminOnly 的项按需放置即可（当前无此类项）。
const allRailItems: RailItem[] = [
  { title: '个人看板', path: '/', icon: HomeFilled },
  { title: '全媒体客服', path: '/omnichannel', icon: Monitor, permission: 'conversation.read' },
  { title: '留言', path: MESSAGE_CENTER_ROUTE, icon: Microphone, permission: 'conversation.read' },
  { title: '智能外呼', path: '/outbound', icon: Phone, permission: 'outbound.read' },
  { title: '坐席监控', path: '/monitor', icon: List, permission: 'monitor.read' },
  { title: '智能检测', path: '/inspection', icon: Document, permission: 'inspection.read' },
  { title: '质检管理', path: '/inspection-manage', icon: Tools, permission: 'inspection.read' },
  { title: '业务导航', path: '/business-nav', icon: Grid },
  { title: '知识库', path: '/knowledge', icon: Reading, permission: 'knowledge.read' },
  { title: '角色权限管理', path: '/access-management', icon: UserFilled, permission: 'access.manage' },
  // 「短信模板」不再单列 rail 入口：已并入 功能入口 → 短信管理 → 模板管理
]

const smsRole = useSmsRoleStore()
const access = useAccessStore()
const modules=useProductModulesStore()
const managementOnly = computed(() => access.systemSuperuser || (access.can('access.manage') && access.agentId === 0))
const voiceEnabled = computed(() => modules.enabled('icc') && !managementOnly.value)
const railItems = computed(() =>
  allRailItems.filter((it) => modules.canVisit(it.path) && (!it.adminOnly || smsRole.isAdministrator) && (!it.permission || access.can(it.permission) || (it.path === '/access-management' && (access.can('extension.assign') || access.can('extension.approve'))))),
)

/**
 * 左侧导航高亮：按 path 匹配，而不是按数组索引。
 *
 * 原来用 route.meta.rail 与 v-for 的 idx 比较，导致「调整导航顺序」必须同步改
 * 每个路由的 meta.rail，漏改就会出现「点了 A 却高亮 B」。改成 path 匹配后，
 * 顺序随便调都不会错位（路由可按需保留 meta.rail，但已不再被读取）。
 */
function isRailActive(item: RailItem): boolean {
  const p = item.path.split('?')[0] ?? item.path
  if (p === '/') return route.path === '/'
  return route.path === p || route.path.startsWith(`${p}/`)
}

const settingsActive = computed(() => route.name === 'settings')

const statusClass = computed(() => ({
  'st-off': agent.uiStatus === 'offline',
  'st-on': agent.uiStatus === 'ready',
  'st-busy':
    agent.uiStatus === 'busy'
    || agent.uiStatus === 'blocked'
    || agent.uiStatus === 'ext_unregistered'
    || agent.uiStatus === 'ext_unavailable'
    || agent.uiStatus === 'ext_not_exist',
  'st-acw': agent.uiStatus === 'acw',
  'st-break': agent.uiStatus === 'break',
}))

function goRail(item: RailItem) {
  if (isMessageCenter(item)) voicemailBadge.value = 0
  router.push(item.path)
}

function goSettings() {
  router.push({ name: 'settings' })
}

function onPhoneOffered() {
  if (route.path !== '/omnichannel') {
    void router.push('/omnichannel')
  }
}

function onMediaAssigned(e: Event) {
  const d = (e as CustomEvent<{
    conversation_id?: number
    assignee_id?: number
    omni_lifecycle?: string
  }>).detail
  const convId = Number(d?.conversation_id)
  if (!Number.isFinite(convId) || convId <= 0) return
  if (d?.omni_lifecycle && d.omni_lifecycle !== 'assigned') return
  const me = Number(auth.user?.id)
  if (d?.assignee_id != null && me > 0 && Number(d.assignee_id) !== me) return
  ElNotification({
    title: '新的在线会话',
    message: '访客已转到本席，请在全媒体客服中接待',
    type: 'success',
    duration: 6000,
  })
  void router.push({ name: 'omnichannel', query: { conv: String(convId) } })
}

let accessRefreshTimer: ReturnType<typeof setInterval> | undefined
const refreshAccess = () => { void access.refresh(); void modules.refresh() }
onMounted(() => {
  void access.refresh()
  accessRefreshTimer = setInterval(refreshAccess, 30000)
  window.addEventListener('focus', refreshAccess)
  if (voiceEnabled.value) { agent.hydrate(); agent.startCcsPresenceWatch() }
  if (voiceEnabled.value) void desktopMedia.start()
  // 班长小休申请：全局挂监听，不依赖是否打开全媒体页
  agentIm.wireEvents()
  if (!managementOnly.value) void agentIm.refresh()
  // 取当前账号角色，用于决定「短信模板」管理入口是否显示（写权限由后端 403 兜底）
  void smsRole.load()
  window.addEventListener('ccs:phone-offered', onPhoneOffered)
  window.addEventListener('omni:conversation-lifecycle-changed', onMediaAssigned as EventListener)
  window.addEventListener('omni:voicemail-created', onVoicemailCreated)
  window.addEventListener('omni:rest-request', onRestRequest)
})
onUnmounted(() => {
  if (accessRefreshTimer) clearInterval(accessRefreshTimer)
  window.removeEventListener('focus', refreshAccess)
  agent.stopCcsPresenceWatch()
  void desktopMedia.stop()
  window.removeEventListener('ccs:phone-offered', onPhoneOffered)
  window.removeEventListener('omni:conversation-lifecycle-changed', onMediaAssigned as EventListener)
  window.removeEventListener('omni:voicemail-created', onVoicemailCreated)
  window.removeEventListener('omni:rest-request', onRestRequest)
})

function onRestRequest() {
  if (route.path !== '/omnichannel') {
    void router.push('/omnichannel')
  }
}
</script>

<style scoped>
.desktop-call-audio { position: fixed; right: 20px; bottom: 20px; width: auto; z-index: 2100; }
.desktop-call-audio :deep(.play-audio) { position: static; }

.oa-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100vh;
}

.oa-header {
  height: 52px;
  background: linear-gradient(180deg, #fff 0%, #f0f6fc 100%);
  border-bottom: 1px solid #c5d5e8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
}

.oa-header-left,
.oa-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.oa-logo {
  font-weight: 800;
  font-size: 20px;
  color: var(--oa-primary);
  margin-right: 8px;
}

.oa-dial-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.oa-dial-label {
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
}
.oa-dial-input {
  width: 148px;
}
.oa-dial-input :deep(.el-input__wrapper) {
  padding-right: 4px;
}
.oa-dial-phone-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #909399;
  cursor: pointer;
}
.oa-dial-phone-btn:hover {
  color: var(--oa-primary);
  background: rgba(64, 158, 255, 0.08);
}
.oa-outbound-btn {
  flex-shrink: 0;
}
.oa-outbound-btn :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.oa-dial-phone-btn.is-ringing,
.oa-call-ico.is-ringing {
  color: #e6a23c;
  animation: oa-phone-ring 0.7s ease-in-out infinite;
  transform-origin: 70% 20%;
}
.oa-outbound-btn.is-ringing {
  --el-button-text-color: #e6a23c;
  --el-button-hover-text-color: #e6a23c;
  --el-button-border-color: #f3d19e;
  --el-button-hover-border-color: #e6a23c;
  --el-button-hover-bg-color: #fdf6ec;
}
@keyframes oa-phone-ring {
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

.oa-status-line em {
  font-style: normal;
  font-weight: 600;
}
.st-off {
  color: #909399;
}
.st-on {
  color: #409eff;
}
.st-busy {
  color: #f56c6c;
}
.st-acw {
  color: #e6a23c;
}
.st-break {
  color: #79bbff;
}

.oa-duration {
  color: var(--oa-primary);
  font-weight: 600;
}

.oa-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.oa-rail {
  width: 56px;
  background: var(--oa-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 4px;
  flex-shrink: 0;
  position: relative;
  min-height: 0;
}
.oa-rail-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
}
.oa-rail-settings {
  flex-shrink: 0;
  margin-top: auto;
}

.oa-rail-item {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  position: relative;
}
/* 留言未读角标：个位数显示数字，超过 9 显示省略号，避免角标越撑越宽把图标挤变形 */
.oa-rail-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 8px;
  background: #f56c6c;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--oa-primary, #1a5fb4);
}
.oa-rail-item:hover {
  background: rgba(255, 255, 255, 0.12);
}
.oa-rail-item.active {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.oa-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}
/* 仅全媒体：禁止主区整体滚动，子页撑满视口 */
.oa-main--fill {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.oa-main--fill > * {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
}
</style>
