<template>
  <div class="pf-panel">
    <div class="pf-toolbar">
      <span class="pf-label">周期</span>
      <el-input v-model="period" size="small" style="width: 110px" />
      <span class="pf-label">团队</span>
      <el-select v-model="teamId" clearable placeholder="全中心" size="small" style="width: 140px">
        <el-option label="售后一组" value="T1" />
        <el-option label="售后二组" value="T2" />
        <el-option label="售前咨询" value="T3" />
        <el-option label="投诉专席" value="T4" />
      </el-select>
      <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" show-icon class="pf-mb" />
    <el-table v-else :data="items" border stripe size="small" max-height="440">
      <el-table-column prop="agent_id" label="工号" width="100" />
      <el-table-column prop="name" label="姓名" width="88" />
      <el-table-column prop="team_name" label="团队" width="100" />
      <el-table-column prop="composite_score" label="综合分" width="88" sortable />
      <el-table-column prop="csat_pct" label="CSAT%" width="88" />
      <el-table-column prop="handled" label="处理量" width="88" />
      <el-table-column prop="aht_sec" label="AHT" width="80" />
      <el-table-column prop="quality_avg" label="质检" width="72" />
      <el-table-column prop="adherence_pct" label="遵守率%" width="96" />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchAgentScores, type AgentScoreRow } from '@/api/performance'

const period = ref('2026-03')
const teamId = ref<string | undefined>(undefined)
const items = ref<AgentScoreRow[]>([])
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = await fetchAgentScores(period.value, teamId.value || undefined)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
    items.value = []
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
</style>
