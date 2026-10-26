<template>
  <div class="pf-panel">
    <el-row :gutter="16">
      <el-col :xs="24" :lg="14">
        <el-card shadow="never">
          <template #header><span class="pf-h">校准 / 复议队列</span></template>
          <el-button type="primary" size="small" :loading="loadCal" class="pf-mb" @click="loadCalibration">刷新</el-button>
          <el-alert v-if="errCal" :title="errCal" type="error" show-icon class="pf-mb" />
          <el-table v-else :data="calItems" border stripe size="small" max-height="280">
            <el-table-column prop="id" label="单号" width="130" />
            <el-table-column prop="agent_name" label="坐席" width="88" />
            <el-table-column prop="team_name" label="团队" width="100" />
            <el-table-column prop="metric" label="指标" width="100" />
            <el-table-column prop="raw_value" label="系统值" width="88" />
            <el-table-column prop="status" label="状态" width="110" />
            <el-table-column prop="dispute_reason" label="事由" min-width="160" show-overflow-tooltip />
          </el-table>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never">
          <template #header><span class="pf-h">下达目标（演示 POST）</span></template>
          <el-form :model="goalForm" label-position="top" size="small">
            <el-form-item label="周期 YYYY-MM">
              <el-input v-model="goalForm.period" />
            </el-form-item>
            <el-form-item label="坐席">
              <el-select v-model="goalForm.agent_id" style="width: 100%">
                <el-option label="张敏 A1001" value="A1001" />
                <el-option label="王磊 A1002" value="A1002" />
                <el-option label="刘洋 A2003" value="A2003" />
                <el-option label="陈静 A3008" value="A3008" />
              </el-select>
            </el-form-item>
            <el-form-item label="KPI">
              <el-select v-model="goalForm.kpi_id" style="width: 100%">
                <el-option label="客户满意度 K_CSAT" value="K_CSAT" />
                <el-option label="FCR K_FCR" value="K_FCR" />
                <el-option label="AHT K_AHT" value="K_AHT" />
                <el-option label="质检 K_QUALITY" value="K_QUALITY" />
              </el-select>
            </el-form-item>
            <el-form-item label="目标值（文本）">
              <el-input v-model="goalForm.target_value" placeholder="如 ≥92% 或 ≤240s" />
            </el-form-item>
            <el-form-item label="责任人">
              <el-input v-model="goalForm.owner" placeholder="班长姓名" />
            </el-form-item>
            <el-button type="primary" :loading="saving" @click="submitGoal">保存目标</el-button>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="pf-mt">
      <template #header>
        <div class="pf-head">
          <span class="pf-h">已下达目标</span>
          <div>
            <el-input v-model="goalPeriod" size="small" style="width: 100px" placeholder="周期筛选" clearable />
            <el-button size="small" class="pf-ml" @click="loadGoals">刷新列表</el-button>
          </div>
        </div>
      </template>
      <el-alert v-if="errGoals" :title="errGoals" type="error" show-icon class="pf-mb" />
      <el-table v-else :data="goalItems" border stripe size="small" max-height="260">
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="period" label="周期" width="88" />
        <el-table-column prop="agent_name" label="坐席" width="88" />
        <el-table-column prop="kpi_name" label="指标" min-width="100" />
        <el-table-column prop="target_value" label="目标" width="100" />
        <el-table-column prop="owner" label="责任人" width="88" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  createPerformanceGoal,
  fetchCalibrationQueue,
  fetchPerformanceGoals,
  type CalibrationItem,
  type PerformanceGoal,
} from '@/api/performance'

const calItems = ref<CalibrationItem[]>([])
const loadCal = ref(false)
const errCal = ref('')

const goalItems = ref<PerformanceGoal[]>([])
const errGoals = ref('')
const goalPeriod = ref('2026-03')

const goalForm = ref({
  period: '2026-03',
  agent_id: 'A1001',
  kpi_id: 'K_CSAT',
  target_value: '≥93%',
  owner: '李班长',
})
const saving = ref(false)

async function loadCalibration() {
  loadCal.value = true
  errCal.value = ''
  try {
    calItems.value = await fetchCalibrationQueue()
  } catch (e) {
    errCal.value = e instanceof Error ? e.message : '加载失败'
    calItems.value = []
  } finally {
    loadCal.value = false
  }
}

async function loadGoals() {
  errGoals.value = ''
  try {
    goalItems.value = await fetchPerformanceGoals(goalPeriod.value || undefined)
  } catch (e) {
    errGoals.value = e instanceof Error ? e.message : '加载失败'
    goalItems.value = []
  }
}

async function submitGoal() {
  saving.value = true
  try {
    await createPerformanceGoal({
      period: goalForm.value.period,
      agent_id: goalForm.value.agent_id,
      kpi_id: goalForm.value.kpi_id,
      target_value: goalForm.value.target_value,
      owner: goalForm.value.owner || undefined,
    })
    ElMessage.success('目标已保存（后端内存）')
    await loadGoals()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await loadCalibration()
  await loadGoals()
})
</script>

<style scoped>
.pf-panel {
  min-height: 360px;
}
.pf-h {
  font-weight: 600;
  font-size: 14px;
}
.pf-mb {
  margin-bottom: 12px;
}
.pf-mt {
  margin-top: 16px;
}
.pf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.pf-ml {
  margin-left: 8px;
}
</style>
