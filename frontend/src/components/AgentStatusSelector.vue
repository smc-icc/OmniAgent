<template>
  <div v-if="productModules.enabled('icc')" class="agent-status-selector">
    <el-popover
      :visible="open"
      placement="bottom-end"
      :width="200"
      trigger="click"
      popper-class="agent-status-popover"
      @update:visible="open = $event"
    >
      <template #reference>
        <button
          type="button"
          class="status-trigger"
          :class="[open ? 'open' : '', `is-${triggerTone}`]"
        >
          <img :src="triggerIcon" alt="" class="status-trigger-icon" />
          <span class="status-trigger-caption">
            <span class="status-trigger-text">{{ triggerLabel }}</span>
            <el-icon class="status-trigger-arrow"><ArrowDown /></el-icon>
          </span>
        </button>
      </template>

      <ul class="status-menu">
        <li v-for="item in statusOptions" :key="item.value">
          <button
            type="button"
            class="status-menu-item"
            :class="{
              active: menuActiveValue === item.value,
              disabled: item.value === 'break' && (displayStatus === 'break' || agent.restPending),
            }"
            :disabled="item.value === 'break' && (displayStatus === 'break' || agent.restPending)"
            @click="onSelect(item.value)"
          >
            <img :src="item.iconSrc" alt="" class="status-menu-icon" />
            <span class="status-menu-divider" />
            <span class="status-menu-label">{{ item.label }}</span>
          </button>
        </li>
      </ul>
    </el-popover>

    <el-dialog
      v-model="restDialogVisible"
      title="申请小休"
      width="420px"
      append-to-body
      :close-on-click-modal="false"
      @closed="onRestDialogClosed"
    >
      <div class="rest-form">
        <label class="rest-label">请输入小休原因</label>
        <el-input
          v-model="restReason"
          type="textarea"
          :rows="3"
          placeholder="例如：用餐 / 洗手间 / 培训"
          maxlength="120"
          show-word-limit
        />
        <div class="rest-duration-row">
          <label class="rest-label">小休时长</label>
          <div class="rest-duration-field">
            <el-input-number
              v-model="restMinutes"
              :min="1"
              :max="240"
              :step="1"
              controls-position="right"
            />
            <span class="rest-duration-unit">分钟</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="restDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="restSubmitting" @click="submitRest">申请</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="acwDialogVisible"
      title="文书处理"
      width="420px"
      append-to-body
      :close-on-click-modal="false"
      @closed="onAcwDialogClosed"
    >
      <div class="rest-form">
        <div class="rest-duration-row">
          <label class="rest-label">文书时长</label>
          <div class="rest-duration-field">
            <el-input-number
              v-model="acwMinutes"
              :min="1"
              :max="240"
              :step="1"
              controls-position="right"
            />
            <span class="rest-duration-unit">分钟</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="acwDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="acwSubmitting" @click="submitAcw">开始</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules = useProductModulesStore()

import { computed, ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { useAgentStore, type AgentUiStatus } from '@/stores/agent'
import showBusyIcon from '@/assets/images/icon/Enable/showBusy.png'
import showIdleIcon from '@/assets/images/icon/Enable/showIdle.png'
import askForRestIcon from '@/assets/images/icon/Enable/askForRest.png'
import inspectionIcon from '@/assets/images/icon/Enable/inspection.png'

const agent = useAgentStore()
const open = ref(false)
const restDialogVisible = ref(false)
const restReason = ref('')
const restMinutes = ref(15)
const restSubmitting = ref(false)
const acwDialogVisible = ref(false)
const acwMinutes = ref(5)
const acwSubmitting = ref(false)

const statusOptions: {
  value: 'ready' | 'busy' | 'break' | 'acw'
  label: string
  shortLabel: string
  iconSrc: string
  tone: 'ready' | 'busy' | 'break' | 'acw'
}[] = [
  { value: 'ready', label: '示闲(F4)', shortLabel: '示闲', iconSrc: showIdleIcon, tone: 'ready' },
  { value: 'busy', label: '示忙(F2)', shortLabel: '示忙', iconSrc: showBusyIcon, tone: 'busy' },
  { value: 'break', label: '小休', shortLabel: '小休', iconSrc: askForRestIcon, tone: 'break' },
  { value: 'acw', label: '文书', shortLabel: '文书', iconSrc: inspectionIcon, tone: 'acw' },
]

const EXT_STATUSES = new Set<AgentUiStatus>([
  'ext_unregistered',
  'ext_unavailable',
  'ext_not_exist',
  'blocked',
])

/** 未签入时按示闲展示；通话相位不映射到菜单项 */
const displayStatus = computed<'ready' | 'busy' | 'break' | 'acw'>(() => {
  const st = agent.uiStatus
  if (st === 'offline' || !st || EXT_STATUSES.has(st)) return 'ready'
  if (st === 'ready' || st === 'busy' || st === 'break' || st === 'acw') return st
  return 'ready'
})

const currentOption = computed(
  () => statusOptions.find((o) => o.value === displayStatus.value) ?? statusOptions[0],
)

const triggerLabel = computed(() => {
  if (EXT_STATUSES.has(agent.uiStatus)) return agent.statusLabel
  if (displayStatus.value === 'break' && agent.restPending) return '申请中'
  if (displayStatus.value === 'break' && agent.restRemainSec > 0) {
    const sec = agent.restRemainSec
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `小休 ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  if (displayStatus.value === 'acw' && agent.acwRemainSec > 0) {
    const sec = agent.acwRemainSec
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `文书 ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return currentOption.value.shortLabel
})

const triggerIcon = computed(() => currentOption.value.iconSrc)
const triggerTone = computed(() =>
  EXT_STATUSES.has(agent.uiStatus) ? 'busy' : currentOption.value.tone,
)
const menuActiveValue = computed<'ready' | 'busy' | 'break' | 'acw' | null>(() =>
  EXT_STATUSES.has(agent.uiStatus) ? null : displayStatus.value,
)

function openRestDialog() {
  restReason.value = ''
  restMinutes.value = 15
  restDialogVisible.value = true
}

function onRestDialogClosed() {
  restSubmitting.value = false
}

function openAcwDialog() {
  acwMinutes.value = 5
  acwDialogVisible.value = true
}

function onAcwDialogClosed() {
  acwSubmitting.value = false
}

async function submitAcw() {
  const minutes = Math.min(240, Math.max(1, Math.floor(Number(acwMinutes.value) || 5)))
  acwSubmitting.value = true
  try {
    await agent.setStatus('acw', { acwMinutes: minutes })
    acwDialogVisible.value = false
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '进入文书失败')
  } finally {
    acwSubmitting.value = false
  }
}

async function submitRest() {
  const reason = restReason.value.trim()
  if (!reason) {
    ElMessage.warning('请填写小休原因')
    return
  }
  const minutes = Math.min(240, Math.max(1, Math.floor(Number(restMinutes.value) || 15)))
  restSubmitting.value = true
  try {
    await agent.setStatus('break', { restReason: reason, restMinutes: minutes })
    restDialogVisible.value = false
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '申请失败')
  } finally {
    restSubmitting.value = false
  }
}

async function applyStatus(next: AgentUiStatus) {
  if (next === 'break') {
    if (agent.restPending) {
      ElMessage.warning('小休申请审批中，请勿重复申请')
      return
    }
    if (agent.uiStatus === 'break') {
      ElMessage.warning('当前已在小休，无需再次申请')
      return
    }
    openRestDialog()
    return
  }
  if (next === 'acw') {
    openAcwDialog()
    return
  }
  await agent.setStatus(next)
}

function onSelect(next: AgentUiStatus) {
  open.value = false
  void applyStatus(next)
}

function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
  if (e.key === 'F2') {
    e.preventDefault()
    void applyStatus('busy')
  } else if (e.key === 'F4') {
    e.preventDefault()
    void applyStatus('ready')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.agent-status-selector {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}
.status-trigger {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #303133;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}
.status-trigger:hover,
.status-trigger.open {
  border-color: #c0c4cc;
}
.status-trigger.is-ready.open,
.status-trigger.is-ready:hover {
  border-color: #67c23a;
  background: #f0f9eb;
}
.status-trigger.is-busy {
  border-color: #f56c6c;
  color: #f56c6c;
}
.status-trigger.is-busy.open,
.status-trigger.is-busy:hover {
  background: #fef0f0;
}
.status-trigger.is-break {
  border-color: #409eff;
  background: #409eff;
  color: #fff;
}
.status-trigger.is-break .status-trigger-arrow {
  color: #fff;
}
.status-trigger.is-acw {
  border-color: #e6a23c;
  color: #e6a23c;
}
.status-trigger.is-acw.open,
.status-trigger.is-acw:hover {
  background: #fdf6ec;
}
.status-trigger-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
}
.status-trigger-caption {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.status-trigger-text {
  font-weight: 500;
  font-size: 12px;
  line-height: 1.1;
  white-space: nowrap;
}
.status-trigger-arrow {
  font-size: 10px;
  color: #909399;
}

.status-menu {
  list-style: none;
  margin: 0;
  padding: 2px 0;
}
.status-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 2px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  min-height: 26px;
}
.status-menu-item:hover:not(:disabled),
.status-menu-item.active {
  background: #f5f7fa;
}
.status-menu-item:disabled,
.status-menu-item.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.status-menu-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex-shrink: 0;
}
.status-menu-divider {
  width: 1px;
  height: 20px;
  background: #ebeef5;
  margin: 0 8px;
  flex-shrink: 0;
}
.status-menu-label {
  font-size: 12px;
  line-height: 1.2;
  color: #303133;
  white-space: nowrap;
}
.status-menu-item.active .status-menu-label {
  color: var(--el-color-primary);
  font-weight: 600;
}

.rest-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rest-label {
  display: block;
  font-size: 14px;
  color: #606266;
  margin-bottom: 6px;
}
.rest-duration-row {
  display: flex;
  flex-direction: column;
}
.rest-duration-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rest-duration-unit {
  font-size: 13px;
  color: #606266;
}
</style>

<style>
.agent-status-popover.el-popover {
  padding: 0;
}
</style>
