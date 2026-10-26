<template>
  <el-card shadow="never" class="sug-root">
    <template #header>
      <div>
        <span class="sug-title">建议管理</span>
        <span class="sug-sub"
          >客户之声（VOC）统一入口：多渠道登记与检索、自动分拣与部门处置、热点洞察与导出审计；可与工单、满意度、需求池联动（演示数据）。</span
        >
      </div>
    </template>
    <div class="sug-layout">
      <aside class="sug-aside">
        <el-menu :default-active="active" class="sug-menu" @select="onMenuSelect">
          <el-menu-item index="overview">总览</el-menu-item>
          <el-menu-item index="inbox">建议池</el-menu-item>
          <el-menu-item index="routing">分类与路由</el-menu-item>
          <el-menu-item index="desk">部门处置台</el-menu-item>
          <el-menu-item index="insights">热点洞察</el-menu-item>
          <el-menu-item index="reports">报表导出</el-menu-item>
        </el-menu>
      </aside>
      <main class="sug-main">
        <component :is="Panel" />
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import SugOverview from './suggestion/SugOverview.vue'
import SugInbox from './suggestion/SugInbox.vue'
import SugRouting from './suggestion/SugRouting.vue'
import SugDesk from './suggestion/SugDesk.vue'
import SugInsights from './suggestion/SugInsights.vue'
import SugReports from './suggestion/SugReports.vue'

const map = {
  overview: markRaw(SugOverview),
  inbox: markRaw(SugInbox),
  routing: markRaw(SugRouting),
  desk: markRaw(SugDesk),
  insights: markRaw(SugInsights),
  reports: markRaw(SugReports),
} as const

type Key = keyof typeof map

const active = ref<Key>('overview')
const Panel = computed(() => map[active.value])

function onMenuSelect(index: string) {
  if (index in map) active.value = index as Key
}
</script>

<style scoped>
.sug-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.sug-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.sug-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.sug-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 960px;
  font-weight: normal;
}
.sug-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 520px;
}
.sug-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.sug-menu {
  border-right: none;
}
.sug-main {
  flex: 1;
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 14px 16px;
  background: #fff;
}
</style>
