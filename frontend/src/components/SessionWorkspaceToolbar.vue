<template>
  <div v-if="isMedia || productModules.enabled('icc')" class="session-workspace-toolbar">
    <template v-for="item in permittedItems" :key="item.id">
      <el-dropdown
        v-if="item.menu"
        trigger="click"
        popper-class="session-workspace-dropdown"
        @command="onMonitorCommand"
      >
        <button type="button" class="session-workspace-item" :title="item.label">
          <img :src="item.icon" :alt="item.label" class="session-workspace-icon" />
          <span class="session-workspace-caption">
            <span class="session-workspace-label">{{ item.label }}</span>
            <el-icon class="session-workspace-caret"><ArrowDown /></el-icon>
          </span>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="m in item.menu" :key="m.id" :command="m.id">
              <span class="session-workspace-menu-row">
                <img v-if="m.icon" :src="m.icon" alt="" class="session-workspace-menu-icon" />
                <span class="session-workspace-menu-divider" />
                <span class="session-workspace-menu-label">{{ m.label }}</span>
              </span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <button
        v-else
        type="button"
        class="session-workspace-item"
        :title="item.label"
        @click="onAction(item.id)"
      >
        <img :src="item.icon" :alt="item.label" class="session-workspace-icon" />
        <span class="session-workspace-label">{{ item.label }}</span>
      </button>
    </template>
    <WorkspacePickDialog v-model="pickOpen" :mode="pickMode" :channel="channel" />
    <WorkspaceAgentPickDialog
      v-model="agentPickOpen"
      :kind="agentPickKind"
      :monitor-action="monitorAction"
      :channel="channel"
      :conversation-id="conversationId"
      @picked="onPicked"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAccessStore } from '@/stores/access'
import { useProductModulesStore } from '@/stores/product-modules'
import { ArrowDown } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import WorkspacePickDialog from '@/components/WorkspacePickDialog.vue'
import WorkspaceAgentPickDialog, {
  type AgentPickKind,
  type MonitorAction,
} from '@/components/WorkspaceAgentPickDialog.vue'
import type { WorkspaceOnlineAgent } from '@/api/workspace'

const props = withDefaults(
  defineProps<{
    channel?: 'media' | 'phone'
    conversationId?: number | null
  }>(),
  { channel: 'media', conversationId: null },
)

const emit = defineEmits<{
  'contact-agent': [WorkspaceOnlineAgent]
}>()

const isMedia = computed(() => props.channel === 'media')
const access = useAccessStore()
const productModules = useProductModulesStore()
const actionPermission: Record<string, string> = { call_agent: 'organization.read', snatch: 'conversation.snatch', queue_phone: 'conversation.queue', conference: 'conversation.conference', monitor: 'monitor.intervene' }
const permittedItems = computed(() => items.value.filter(item => access.can(actionPermission[item.id])).map(item => ({ ...item, menu: item.menu?.filter(m => access.can(['force_logout', 'force_busy', 'force_idle', 'force_block'].includes(m.id) ? 'monitor.force' : 'monitor.intervene')) })))

const pickOpen = ref(false)
const pickMode = ref<'snatch' | 'queue'>('snatch')
const agentPickOpen = ref(false)
const agentPickKind = ref<AgentPickKind>('call_agent')
const monitorAction = ref<MonitorAction>('barge')

import snatchIcon from '@/assets/images/icon/Enable/agentSnatch.png'
import callAgentIcon from '@/assets/images/icon/Enable/agentSet.png'
import conferenceIcon from '@/assets/images/icon/Enable/conferenceManagement.png'
import queuePhoneIcon from '@/assets/images/icon/Enable/lineUp_phone.png'
import monitorIcon from '@/assets/images/icon/Enable/monitor.png'
import pickplaneIcon from '@/assets/images/icon/Enable/pickplane.png'
import insertIcon from '@/assets/images/icon/Enable/insert.png'
import interceptIcon from '@/assets/images/icon/Enable/intercept.png'
import forceHangupIcon from '@/assets/images/icon/Enable/forceHangup.png'
import forceLogoutIcon from '@/assets/images/icon/Enable/forceLogout.png'
import forceShowBusyIcon from '@/assets/images/icon/Enable/forceShowBusy.png'
import forceShowIdleIcon from '@/assets/images/icon/Enable/forceShowIdle.png'
import forceBlockUpIcon from '@/assets/images/icon/Enable/forceBlockUp.png'

type WorkspaceItem = {
  id: string
  label: string
  icon: string
  menu?: Array<{ id: string; label: string; icon?: string }>
}

const actionLabels: Record<string, string> = {
  snatch: '抢接坐席',
  call_agent: '呼叫坐席',
  conference: '会议管理',
  queue_phone: '排队电话',
}

const monitorLabels: Record<string, string> = {
  barge: '强插',
  intercept: '拦截',
  listen: '监听',
  force_hangup: '强制挂机',
  force_logout: '强制注销',
  force_busy: '强制示忙',
  force_idle: '强制示闲',
  force_block: '强制闭塞',
}

const items = computed<WorkspaceItem[]>(() => [
  { id: 'call_agent', label: isMedia.value ? '联系坐席' : '呼叫坐席', icon: callAgentIcon },
  { id: 'snatch', label: isMedia.value ? '抢接会话' : '抢接坐席', icon: snatchIcon },
  { id: 'queue_phone', label: isMedia.value ? '排队会话' : '排队电话', icon: queuePhoneIcon },
  { id: 'conference', label: isMedia.value ? '会话协作' : '会议管理', icon: conferenceIcon },
  {
    id: 'monitor',
    label: isMedia.value ? '会话监控' : '监控',
    icon: monitorIcon,
    menu: [
      { id: 'barge', label: isMedia.value ? '加入会话' : '强插', icon: insertIcon },
      { id: 'intercept', label: isMedia.value ? '接管会话' : '拦截', icon: interceptIcon },
      { id: 'listen', label: isMedia.value ? '旁观会话' : '监听', icon: pickplaneIcon },
      { id: 'force_hangup', label: isMedia.value ? '强制结束' : '强制挂机', icon: forceHangupIcon },
      { id: 'force_logout', label: '强制注销', icon: forceLogoutIcon },
      { id: 'force_busy', label: '强制示忙', icon: forceShowBusyIcon },
      { id: 'force_idle', label: '强制示闲', icon: forceShowIdleIcon },
      { id: 'force_block', label: '强制闭塞', icon: forceBlockUpIcon },
    ],
  },
])

const monitorMethods: Record<string, MonitorAction> = {
  barge: 'barge',
  intercept: 'intercept',
  listen: 'listen',
  force_hangup: 'force_hangup',
  force_logout: 'force_logout',
  force_busy: 'force_busy',
  force_idle: 'force_idle',
  force_block: 'force_block',
}

async function onAction(id: string) {
  if (id === 'snatch' || id === 'queue_phone') {
    pickMode.value = id === 'snatch' ? 'snatch' : 'queue'
    pickOpen.value = true
    return
  }
  if (id === 'call_agent' || id === 'conference') {
    if (id === 'conference' && isMedia.value && !props.conversationId) {
      ElMessage.info('请先选中一通全媒体会话')
      return
    }
    agentPickKind.value = id === 'call_agent'
      ? (isMedia.value ? 'im' : 'call_agent')
      : 'conference'
    agentPickOpen.value = true
    return
  }
  ElMessage.info(`${actionLabels[id] ?? id}：功能对接中`)
}

function onPicked(a: WorkspaceOnlineAgent) {
  emit('contact-agent', a)
}

async function onMonitorCommand(cmd: string | number) {
  const key = String(cmd) as MonitorAction
  if (!monitorMethods[key]) {
    ElMessage.info(`监控 · ${monitorLabels[key] ?? key}：功能对接中`)
    return
  }
  monitorAction.value = monitorMethods[key]
  agentPickKind.value = 'monitor'
  agentPickOpen.value = true
}
</script>

<style scoped>
.session-workspace-toolbar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  padding: 6px 10px 8px;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #f8fbff 0%, #f1f5f9 100%);
  flex-shrink: 0;
}

.session-workspace-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  padding: 4px 2px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  line-height: 1;
}

.session-workspace-item:hover {
  background: rgba(255, 255, 255, 0.75);
  border-color: #d0dbe8;
}

.session-workspace-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  display: block;
}

.session-workspace-caption {
  position: relative;
  display: inline-block;
  text-align: center;
}

.session-workspace-label {
  display: block;
  font-size: 10px;
  color: #303133;
  white-space: nowrap;
  line-height: 1.2;
  transform: scale(0.95);
}

.session-workspace-caret {
  position: absolute;
  left: 100%;
  top: 50%;
  margin-left: 1px;
  transform: translateY(-50%);
  font-size: 8px;
  color: #909399;
}

.session-workspace-menu-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 26px;
}

.session-workspace-menu-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex-shrink: 0;
}

.session-workspace-menu-divider {
  width: 1px;
  height: 20px;
  background: #ebeef5;
  margin: 0 8px;
  flex-shrink: 0;
}

.session-workspace-menu-label {
  font-size: 12px;
  line-height: 1.2;
  color: #303133;
  white-space: nowrap;
}
</style>

<style>
.session-workspace-dropdown.el-popper {
  padding: 2px 0;
}
.session-workspace-dropdown .el-dropdown-menu__item {
  padding: 2px 8px;
  line-height: normal;
}
</style>
