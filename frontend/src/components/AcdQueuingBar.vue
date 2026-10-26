<template>
  <div v-if="productModules.enabled('icc')" class="oa-queuing-bar">
    <span class="oa-queuing-label">模式</span>
    <el-select
      v-model="mediaQueuingMode"
      size="small"
      class="oa-queuing-select"
      placeholder="请选择"
      :disabled="saving"
      :fit-input-width="false"
      @change="onModeChange"
    >
      <el-option
        v-for="opt in mqmOptions"
        :key="opt.value"
        :label="opt.label"
        :value="opt.value"
      />
    </el-select>
    <template v-if="showSessionCount">
      <span class="oa-queuing-label">会话数</span>
      <el-input-number
        v-model="callerCount"
        class="oa-queuing-count"
        size="small"
        :min="1"
        :max="20"
        :disabled="saving"
        controls-position="right"
        @change="onCallerCountChange"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules = useProductModulesStore()

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchAcdQueuing, updateAcdQueuing } from '@/api/skillGroups'
import { onCcsEvt } from '@/services/ccs-agent'

/** 仅话务不展示会话数；其余模式含全媒体 */
const MQM_TAS_ONLY = 3

const mqmOptions = [
  { value: 0, label: '全部媒体' },
  { value: 1, label: '同时一种' },
  { value: 2, label: '仅线上' },
  { value: 3, label: '仅话务' },
  { value: 4, label: '线上优先' },
  { value: 5, label: '话务优先' },
]

const mediaQueuingMode = ref<number | undefined>(undefined)
const callerCount = ref(10)
const confirmed = ref(false)
const saving = ref(false)
let offCcsSkillGroups: (() => void) | null = null

const showSessionCount = computed(
  () => mediaQueuingMode.value != null && mediaQueuingMode.value !== MQM_TAS_ONLY,
)

function notifyChanged() {
  window.dispatchEvent(new CustomEvent('omni:acd-queuing-changed'))
}

async function load() {
  try {
    const q = await fetchAcdQueuing()
    confirmed.value = !!q.queuing_confirmed
    if (confirmed.value) {
      mediaQueuingMode.value = q.media_queuing_mode
      callerCount.value = q.caller_count > 0 ? q.caller_count : 10
    } else {
      mediaQueuingMode.value = undefined
      callerCount.value = 10
    }
  } catch {
    mediaQueuingMode.value = undefined
  }
}

async function onModeChange(mode: number | undefined) {
  if (mode == null) {
    confirmed.value = false
    notifyChanged()
    return
  }
  if (mode !== MQM_TAS_ONLY && !(callerCount.value > 0)) {
    callerCount.value = 10
  }
  saving.value = true
  try {
    const payload: { media_queuing_mode: number; caller_count?: number } = {
      media_queuing_mode: mode,
    }
    if (mode !== MQM_TAS_ONLY) {
      payload.caller_count = callerCount.value > 0 ? callerCount.value : 10
    }
    const q = await updateAcdQueuing(payload)
    confirmed.value = !!q.queuing_confirmed
    mediaQueuingMode.value = q.media_queuing_mode
    if (q.caller_count > 0) callerCount.value = q.caller_count
    notifyChanged()
  } catch {
    ElMessage.error('接听模式更新失败')
  } finally {
    saving.value = false
  }
}

async function onCallerCountChange(val: number | undefined) {
  const n = Number(val)
  if (!Number.isFinite(n) || n < 1) return
  if (mediaQueuingMode.value == null || mediaQueuingMode.value === MQM_TAS_ONLY) return
  saving.value = true
  try {
    const q = await updateAcdQueuing({ caller_count: n })
    confirmed.value = !!q.queuing_confirmed
    callerCount.value = q.caller_count > 0 ? q.caller_count : n
    notifyChanged()
  } catch {
    ElMessage.error('会话数更新失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void load()
  window.addEventListener('omni:skill-groups-changed', load)
  offCcsSkillGroups = onCcsEvt('omni.skillGroupsChanged', () => { void load() })
})
onUnmounted(() => {
  window.removeEventListener('omni:skill-groups-changed', load)
  offCcsSkillGroups?.()
})
</script>

<style scoped>
.oa-queuing-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 6px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  flex-shrink: 0;
}
.oa-queuing-label {
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
}
.oa-queuing-select {
  width: 88px;
}
.oa-queuing-select :deep(.el-select__wrapper) {
  padding-left: 6px;
  padding-right: 4px;
  min-height: 24px;
  font-size: 12px;
}
.oa-queuing-select :deep(.el-select__placeholder),
.oa-queuing-select :deep(.el-select__selected-item) {
  font-size: 12px;
}
/* EP 默认 150px，顶栏只显示 1–20 */
.oa-queuing-count.el-input-number {
  width: 64px;
}
.oa-queuing-count :deep(.el-input__wrapper) {
  padding-left: 4px;
  padding-right: 20px;
}
.oa-queuing-count :deep(.el-input__inner) {
  font-size: 12px;
  text-align: center;
}
.oa-queuing-count :deep(.el-input-number__increase),
.oa-queuing-count :deep(.el-input-number__decrease) {
  width: 18px;
}
</style>
