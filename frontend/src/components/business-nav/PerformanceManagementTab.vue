<template>
  <el-card shadow="never" class="pf-root">
    <template #header>
      <div>
        <span class="pf-title">绩效管理</span>
        <span class="pf-sub"
          >呼叫中心绩效：KPI 方案、团队/坐席排名、趋势分析、结果校准与目标下达；数据来自
          <code class="pf-code">/api/performance/*</code>（全媒体会话与 CSAT）。</span
        >
      </div>
    </template>
    <div class="pf-layout">
      <aside class="pf-aside">
        <el-menu :default-active="active" class="pf-menu" @select="onMenuSelect">
          <el-menu-item index="overview">总览</el-menu-item>
          <el-menu-item index="kpis">KPI 方案</el-menu-item>
          <el-menu-item index="teams">团队排名</el-menu-item>
          <el-menu-item index="agents">坐席绩效</el-menu-item>
          <el-menu-item index="trend">趋势分析</el-menu-item>
          <el-menu-item index="calibration">校准与目标</el-menu-item>
        </el-menu>
      </aside>
      <main class="pf-main">
        <component :is="Panel" />
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import PfOverview from './performance/PfOverview.vue'
import PfKpiDefinitions from './performance/PfKpiDefinitions.vue'
import PfTeamRanking from './performance/PfTeamRanking.vue'
import PfAgentRanking from './performance/PfAgentRanking.vue'
import PfTrend from './performance/PfTrend.vue'
import PfCalibrationGoals from './performance/PfCalibrationGoals.vue'

const map = {
  overview: markRaw(PfOverview),
  kpis: markRaw(PfKpiDefinitions),
  teams: markRaw(PfTeamRanking),
  agents: markRaw(PfAgentRanking),
  trend: markRaw(PfTrend),
  calibration: markRaw(PfCalibrationGoals),
} as const

type Key = keyof typeof map

const active = ref<Key>('overview')
const Panel = computed(() => map[active.value])

function onMenuSelect(index: string) {
  if (index in map) active.value = index as Key
}
</script>

<style scoped>
.pf-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.pf-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.pf-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.pf-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 960px;
  font-weight: normal;
}
.pf-code {
  font-size: 11px;
  padding: 1px 6px;
  background: #f4f4f5;
  border-radius: 3px;
}
.pf-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 520px;
}
.pf-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.pf-menu {
  border-right: none;
}
.pf-main {
  flex: 1;
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 14px 16px;
  background: #fff;
}
</style>
