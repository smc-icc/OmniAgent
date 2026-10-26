<template>
  <div class="pf-panel">
    <el-alert
      title="KPI 与考核方案"
      type="info"
      show-icon
      :closable="false"
      class="pf-mb"
      description="以下为呼叫中心常见绩效维度：结果类（CSAT/FCR）、效率类（AHT/利用率）、质量合规（质检）、劳动力（遵守率）。权重之和可用于综合分加权（演示）。"
    />
    <el-button type="primary" size="small" :loading="loading" class="pf-mb" @click="load">刷新</el-button>
    <el-alert v-if="error" :title="error" type="error" show-icon class="pf-mb" />
    <el-table v-else :data="items" border stripe size="small" max-height="420">
      <el-table-column prop="id" label="编码" width="110" />
      <el-table-column prop="name" label="指标" min-width="120" />
      <el-table-column prop="category" label="维度" width="100" />
      <el-table-column prop="weight_pct" label="权重%" width="88" />
      <el-table-column prop="unit" label="单位" width="72" />
      <el-table-column prop="source_system" label="数据源" width="120" show-overflow-tooltip />
      <el-table-column prop="formula_hint" label="口径说明" min-width="220" show-overflow-tooltip />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchKpiDefinitions, type KpiDefinition } from '@/api/performance'

const items = ref<KpiDefinition[]>([])
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = await fetchKpiDefinitions()
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
.pf-mb {
  margin-bottom: 12px;
}
</style>
