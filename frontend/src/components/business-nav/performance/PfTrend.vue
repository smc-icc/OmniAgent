<template>
  <div class="pf-panel">
    <div class="pf-toolbar">
      <span class="pf-label">指标</span>
      <el-select v-model="metric" size="small" style="width: 140px" @change="load">
        <el-option label="AHT（秒）" value="aht" />
        <el-option label="CSAT（%）" value="csat" />
        <el-option label="质检均分" value="quality" />
        <el-option label="处理量" value="handled" />
      </el-select>
      <span class="pf-label">周期</span>
      <el-input v-model="period" size="small" style="width: 110px" />
      <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" show-icon class="pf-mb" />
    <template v-else-if="series">
      <p class="pf-hint">指标：{{ series.metric }}，单位：{{ series.unit }}（演示按日序列）</p>
      <el-table :data="series.points" border stripe size="small" max-height="360">
        <el-table-column prop="day" label="日期" width="120" />
        <el-table-column prop="value" label="数值" width="100" />
        <el-table-column label="条形">
          <template #default="{ row }">
            <el-progress
              :percentage="barPct(row.value)"
              :stroke-width="12"
              :show-text="false"
              :color="progressColor"
            />
          </template>
        </el-table-column>
      </el-table>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchPerformanceTrend } from '@/api/performance'

const metric = ref('aht')
const period = ref('2026-03')
const series = ref<{ metric: string; unit: string; points: { day: string; value: number }[] } | null>(null)
const loading = ref(false)
const error = ref('')
const maxVal = ref(1)

function barPct(v: number) {
  if (!maxVal.value) return 0
  return Math.min(100, Math.round((v / maxVal.value) * 100))
}

const progressColor = '#409eff'

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchPerformanceTrend(metric.value, period.value)
    series.value = data
    const vals = data.points.map((p) => p.value)
    maxVal.value = Math.max(...vals, 1)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    series.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.pf-panel {
  min-height: 360px;
}
.pf-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.pf-label {
  font-size: 12px;
  color: #909399;
}
.pf-mb {
  margin-bottom: 12px;
}
.pf-hint {
  font-size: 13px;
  color: #606266;
  margin: 0 0 10px;
}
</style>
