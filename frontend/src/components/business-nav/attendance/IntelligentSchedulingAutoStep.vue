<template>
  <div v-loading="localRunning" class="ias" element-loading-text="算法运行中，请稍候…">
    <div v-if="auto.status === 'success'" class="ias-hero">
      <div class="ias-hero-icon">
        <el-icon :size="56" color="var(--el-color-success)"><CircleCheckFilled /></el-icon>
      </div>
      <p class="ias-hero-title">排课成功</p>
      <p v-if="auto.last_finished_at" class="ias-hero-sub">
        {{ formatTime(auto.last_finished_at) }} · {{ auto.last_message }}
      </p>
    </div>

    <div v-else-if="auto.status === 'failed'" class="ias-hero ias-hero--fail">
      <el-icon :size="48" color="var(--el-color-danger)"><CircleCloseFilled /></el-icon>
      <p class="ias-hero-title">排课未成功</p>
      <p class="ias-hero-sub">{{ auto.last_message || '请检查规则与课务数据后重试' }}</p>
    </div>

    <div v-else-if="auto.status === 'idle'" class="ias-hero ias-hero--idle">
      <el-icon :size="48" color="var(--el-color-info)"><Calendar /></el-icon>
      <p class="ias-hero-title">准备自动排课</p>
      <p class="ias-hero-sub">请选择年级范围与运行时间后，点击下方按钮开始。</p>
    </div>

    <el-card shadow="never" class="ias-card">
      <template #header>
        <span class="ias-card-title">
          设置排课范围
          <el-tooltip content="仅对勾选的年级执行自动排课（演示）" placement="top">
            <el-icon class="ias-info"><InfoFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <el-checkbox-group v-model="auto.grade_ids" class="ias-grades">
        <el-checkbox v-for="g in auto.grade_options" :key="g.id" :value="g.id">{{ g.label }}</el-checkbox>
      </el-checkbox-group>
    </el-card>

    <el-card shadow="never" class="ias-card">
      <template #header>
        <span class="ias-card-title">设置算法参数</span>
      </template>
      <div class="ias-runtime">
        <span class="ias-runtime-label">期望算法运行时间（分钟）：</span>
        <el-select v-model="auto.runtime_minutes" style="width: 120px" size="default">
          <el-option v-for="m in auto.runtime_options" :key="m" :label="String(m)" :value="m" />
        </el-select>
      </div>
      <ul class="ias-tips">
        <li>建议选择适当的运行时间，理论上算法运行时间越长排课结果越符合规则。</li>
        <li>存在部分特殊案例，单纯延长运行时间并不能获得更优结果，建议优化规则限制。</li>
      </ul>
    </el-card>

    <div class="ias-actions">
      <template v-if="auto.status === 'success'">
        <el-button type="primary" size="large" class="ias-btn-main" @click="emit('viewTimetable')">
          查看课表
        </el-button>
        <div class="ias-secondary">
          <el-button link type="primary" @click="runSchedule">重新排课</el-button>
        </div>
        <p class="ias-warn">重新排课时，全部年级的教案信息都会重新安排</p>
      </template>
      <template v-else>
        <el-button type="primary" size="large" class="ias-btn-main" :disabled="!auto.grade_ids.length" @click="runSchedule">
          {{ auto.status === 'failed' ? '重新排课' : '开始自动排课' }}
        </el-button>
        <p v-if="auto.status === 'idle'" class="ias-warn">开始后将按当前范围与参数运行演示算法（约 1 秒内完成）</p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Calendar, CircleCheckFilled, CircleCloseFilled, InfoFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { ref } from 'vue'
import {
  mergeAutoScheduling,
  postIntelligentSchedulingWizardAutoSchedulingRun,
  putIntelligentSchedulingWizardAutoScheduling,
  type AutoSchedulingState,
} from '@/api/intelligentScheduling'

const props = defineProps<{
  taskId: string
}>()

const emit = defineEmits<{
  viewTimetable: []
}>()

const auto = defineModel<AutoSchedulingState>({ required: true })

const localRunning = ref(false)

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

async function runSchedule() {
  if (!props.taskId) return
  if (!auto.value.grade_ids.length) {
    ElMessage.warning('请至少选择一个年级')
    return
  }
  localRunning.value = true
  try {
    await putIntelligentSchedulingWizardAutoScheduling(props.taskId, { ...auto.value })
    const r = await postIntelligentSchedulingWizardAutoSchedulingRun(props.taskId, {
      grade_ids: auto.value.grade_ids,
      runtime_minutes: auto.value.runtime_minutes,
    })
    auto.value = mergeAutoScheduling(r.auto_scheduling)
    ElMessage.success('自动排课已完成（演示）')
  } catch {
    auto.value = { ...auto.value, status: 'failed', last_message: '请求失败，请检查网络或后端服务' }
    ElMessage.error('排课请求失败')
  } finally {
    localRunning.value = false
  }
}
</script>

<style scoped>
.ias {
  max-width: 720px;
  margin: 0 auto;
  padding: 8px 0 24px;
}
.ias-hero {
  text-align: center;
  padding: 16px 16px 24px;
}
.ias-hero-icon {
  margin-bottom: 8px;
}
.ias-hero-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.ias-hero-sub {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.ias-hero--fail .ias-hero-title {
  color: var(--el-color-danger);
}
.ias-hero--idle .ias-hero-title {
  color: var(--el-text-color-regular);
}
.ias-card {
  margin-bottom: 14px;
  border: 1px solid var(--el-border-color-lighter);
}
.ias-card :deep(.el-card__header) {
  padding: 12px 16px;
  font-weight: 600;
}
.ias-card :deep(.el-card__body) {
  padding: 16px;
}
.ias-card-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}
.ias-info {
  color: var(--el-text-color-secondary);
  font-size: 16px;
}
.ias-grades {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.ias-grades :deep(.el-checkbox) {
  margin-right: 0;
}
.ias-runtime {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.ias-runtime-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.ias-tips {
  margin: 0;
  padding-left: 1.2em;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.65;
}
.ias-tips li {
  margin-bottom: 6px;
}
.ias-actions {
  text-align: center;
  margin-top: 28px;
}
.ias-btn-main {
  min-width: 200px;
  padding: 12px 32px;
}
.ias-secondary {
  margin-top: 12px;
}
.ias-warn {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>

