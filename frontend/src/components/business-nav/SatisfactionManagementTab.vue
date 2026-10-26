<template>
  <el-card shadow="never" class="sat-root">
    <template #header>
      <div>
        <span class="sat-title">满意度管理</span>
        <span class="sat-sub"
          >统一管理餐后满意度与 NPS：问卷模版、派发策略、回收统计、低分预警与报表；可与 CTI、短信、工单、质检联动（演示数据）。</span
        >
      </div>
    </template>
    <div class="sat-layout">
      <aside class="sat-aside">
        <el-menu :default-active="active" class="sat-menu" @select="onMenuSelect">
          <el-menu-item index="overview">总览</el-menu-item>
          <el-menu-item index="templates">调研模版</el-menu-item>
          <el-menu-item index="triggers">派发策略</el-menu-item>
          <el-menu-item index="results">回收结果</el-menu-item>
          <el-menu-item index="alerts">差评预警</el-menu-item>
          <el-menu-item index="reports">报表中心</el-menu-item>
        </el-menu>
      </aside>
      <main class="sat-main">
        <component :is="Panel" />
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import SatOverview from './satisfaction/SatOverview.vue'
import SatTemplates from './satisfaction/SatTemplates.vue'
import SatTriggers from './satisfaction/SatTriggers.vue'
import SatResults from './satisfaction/SatResults.vue'
import SatAlerts from './satisfaction/SatAlerts.vue'
import SatReports from './satisfaction/SatReports.vue'

const map = {
  overview: markRaw(SatOverview),
  templates: markRaw(SatTemplates),
  triggers: markRaw(SatTriggers),
  results: markRaw(SatResults),
  alerts: markRaw(SatAlerts),
  reports: markRaw(SatReports),
} as const

type Key = keyof typeof map

const active = ref<Key>('overview')
const Panel = computed(() => map[active.value])

function onMenuSelect(index: string) {
  if (index in map) active.value = index as Key
}
</script>

<style scoped>
.sat-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.sat-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.sat-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.sat-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 960px;
  font-weight: normal;
}
.sat-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 520px;
}
.sat-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.sat-menu {
  border-right: none;
}
.sat-main {
  flex: 1;
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 14px 16px;
  background: #fff;
}
</style>
