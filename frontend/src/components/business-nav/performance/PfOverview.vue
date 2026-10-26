<template>
  <div class="pf-panel">
    <div class="pf-toolbar">
      <span class="pf-label">考核周期</span>
      <el-select v-model="period" size="small" style="width: 160px" @change="load">
        <el-option
          v-for="p in periodOptions"
          :key="p.id"
          :label="p.label"
          :value="periodApiValue(p.id)"
        />
      </el-select>
      <el-button type="primary" size="small" :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" show-icon class="pf-mb" />
    <template v-else-if="data">
      <el-row :gutter="12">
        <el-col :xs="24" :sm="8">
          <el-card shadow="never" class="pf-stat">
            <div class="pf-stat-label">中心综合均分</div>
            <div class="pf-stat-val">{{ data.center_avg_score }}</div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="8">
          <el-card shadow="never" class="pf-stat">
            <div class="pf-stat-label">在岗坐席（演示）</div>
            <div class="pf-stat-val">{{ data.active_agents }}</div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="8">
          <el-card shadow="never" class="pf-stat">
            <div class="pf-stat-label">技能组数量</div>
            <div class="pf-stat-val">{{ data.teams_count }}</div>
          </el-card>
        </el-col>
      </el-row>
      <el-row :gutter="12" class="pf-mt">
        <el-col v-for="k in data.kpis" :key="k.key" :xs="24" :sm="12" :lg="6">
          <el-card shadow="hover" class="pf-kpi">
            <div class="pf-kpi-label">{{ k.label }}</div>
            <div class="pf-kpi-val">
              {{ k.value }}<span class="pf-kpi-unit">{{ k.unit }}</span>
            </div>
            <div class="pf-kpi-sub">环比 {{ k.trend }}</div>
          </el-card>
        </el-col>
      </el-row>
      <el-card shadow="never" class="pf-mt">
        <template #header><span class="pf-h">管理摘要</span></template>
        <ul class="pf-list">
          <li v-for="(h, i) in data.highlights" :key="i">{{ h }}</li>
        </ul>
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchAssessmentPeriods, fetchPerformanceOverview, type PerformanceOverview } from '@/api/performance'

const period = ref('2026-03')
const periodOptions = ref<{ id: string; label: string }[]>([])
const data = ref<PerformanceOverview | null>(null)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await fetchPerformanceOverview(period.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请确认后端已启动（/api 代理 8000）'
    data.value = null
  } finally {
    loading.value = false
  }
}

function periodApiValue(id: string) {
  const m = id.match(/P(\d{4})(\d{2})/)
  return m ? `${m[1]}-${m[2]}` : '2026-03'
}

onMounted(async () => {
  try {
    periodOptions.value = await fetchAssessmentPeriods()
    if (periodOptions.value.length && periodOptions.value[0]) {
      period.value = periodApiValue(periodOptions.value[0].id)
    }
  } catch {
    periodOptions.value = [{ id: 'P202603', label: '2026 年 3 月' }]
  }
  await load()
})
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
.pf-mt {
  margin-top: 12px;
}
.pf-stat :deep(.el-card__body) {
  padding: 14px 16px;
}
.pf-stat-label {
  font-size: 12px;
  color: #909399;
}
.pf-stat-val {
  margin-top: 8px;
  font-size: 26px;
  font-weight: 700;
  color: var(--oa-primary, #0066b3);
}
.pf-kpi :deep(.el-card__body) {
  padding: 14px 16px;
}
.pf-kpi-label {
  font-size: 12px;
  color: #909399;
}
.pf-kpi-val {
  margin-top: 6px;
  font-size: 20px;
  font-weight: 700;
  color: #303133;
}
.pf-kpi-unit {
  font-size: 13px;
  color: #909399;
  margin-left: 4px;
}
.pf-kpi-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #a8abb2;
}
.pf-h {
  font-weight: 600;
  font-size: 14px;
}
.pf-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.75;
  font-size: 13px;
  color: #606266;
}
</style>
