<template>
  <div class="pf-panel">
    <div class="pf-toolbar">
      <span class="pf-label">周期</span>
      <el-input v-model="period" size="small" style="width: 110px" placeholder="YYYY-MM" />
      <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" show-icon class="pf-mb" />
    <el-table v-else :data="items" border stripe size="small" max-height="440">
      <el-table-column type="index" label="排名" width="64" />
      <el-table-column prop="team_name" label="团队/技能组" min-width="120" />
      <el-table-column prop="headcount" label="人数" width="72" />
      <el-table-column prop="composite_score" label="综合分" width="88" sortable />
      <el-table-column prop="csat_pct" label="CSAT%" width="88" />
      <el-table-column prop="fcr_pct" label="FCR%" width="88" />
      <el-table-column prop="aht_sec" label="AHT(秒)" width="96" />
      <el-table-column prop="quality_avg" label="质检均分" width="96" />
      <el-table-column prop="utilization_pct" label="利用率%" width="96" />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchTeamScores, type TeamScoreRow } from '@/api/performance'

const period = ref('2026-03')
const items = ref<TeamScoreRow[]>([])
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = await fetchTeamScores(period.value)
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
