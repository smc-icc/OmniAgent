<template>
  <el-card shadow="never" class="sq-root">
    <template #header>
      <div>
        <span class="sq-head-title">问卷调查管理</span>
        <span class="sq-head-sub">呼叫中心问卷全生命周期：设计 → 投放 → 采集质检 → 预警工单 → 分析 → 激励闭环；可与 CTI、录音、工单及个人绩效看板联动（演示数据）。</span>
      </div>
    </template>
    <div class="sq-layout">
      <aside class="sq-aside">
        <el-menu
          :default-active="activeMenu"
          class="sq-menu"
          @select="(k: string) => (activeMenu = k as PanelKey)"
        >
          <el-menu-item index="overview">驾驶舱</el-menu-item>
          <el-menu-item index="designer">问卷设计</el-menu-item>
          <el-menu-item index="publish">发布与抽样</el-menu-item>
          <el-menu-item index="touch">触点与关联</el-menu-item>
          <el-menu-item index="qc">采集与质检</el-menu-item>
          <el-menu-item index="alert">预警与工单</el-menu-item>
          <el-menu-item index="analytics">数据分析</el-menu-item>
          <el-menu-item index="incentive">激励与闭环</el-menu-item>
        </el-menu>
      </aside>
      <main class="sq-main">
        <component :is="CurrentPanel" />
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import SurveyOverview from './survey/SurveyOverview.vue'
import SurveyDesigner from './survey/SurveyDesigner.vue'
import SurveyPublish from './survey/SurveyPublish.vue'
import SurveyTouch from './survey/SurveyTouch.vue'
import SurveyQc from './survey/SurveyQc.vue'
import SurveyAlert from './survey/SurveyAlert.vue'
import SurveyAnalytics from './survey/SurveyAnalytics.vue'
import SurveyIncentive from './survey/SurveyIncentive.vue'

const panels = {
  overview: markRaw(SurveyOverview),
  designer: markRaw(SurveyDesigner),
  publish: markRaw(SurveyPublish),
  touch: markRaw(SurveyTouch),
  qc: markRaw(SurveyQc),
  alert: markRaw(SurveyAlert),
  analytics: markRaw(SurveyAnalytics),
  incentive: markRaw(SurveyIncentive),
} as const

type PanelKey = keyof typeof panels

const activeMenu = ref<PanelKey>('overview')
const CurrentPanel = computed(() => panels[activeMenu.value])
</script>

<style scoped>
.sq-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.sq-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.sq-head-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.sq-head-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  font-weight: normal;
  line-height: 1.55;
  max-width: 960px;
}
.sq-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 520px;
}
.sq-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.sq-menu {
  border-right: none;
}
.sq-main {
  flex: 1;
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 14px 16px;
  background: #fafbfc;
}
</style>
