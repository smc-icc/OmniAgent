<template>
  <el-card shadow="never" class="rb-root">
    <template #header>
      <div>
        <span class="rb-title">红黑名单管理</span>
        <span class="rb-sub"
          >防御性黑名单与 VIP 红名单统一运营：路由联动、生命周期、申诉洗白、合规审计；支撑差异化服务与坐席绩效归因（演示数据）。</span
        >
      </div>
    </template>
    <div class="rb-layout">
      <aside class="rb-aside">
        <el-menu
          :default-active="activeMenu"
          class="rb-menu"
          @select="(k: string) => (activeMenu = k as PanelKey)"
        >
          <el-menu-item index="overview">总览与报表</el-menu-item>
          <el-menu-item index="blacklist">黑名单</el-menu-item>
          <el-menu-item index="redlist">红名单</el-menu-item>
          <el-menu-item index="gray">灰名单与生命周期</el-menu-item>
          <el-menu-item index="linkage">策略联动</el-menu-item>
          <el-menu-item index="compliance">合规与审计</el-menu-item>
        </el-menu>
      </aside>
      <main class="rb-main">
        <component :is="CurrentPanel" />
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import RbOverview from './red-black/RbOverview.vue'
import RbBlacklist from './red-black/RbBlacklist.vue'
import RbRedlist from './red-black/RbRedlist.vue'
import RbGrayLifecycle from './red-black/RbGrayLifecycle.vue'
import RbLinkage from './red-black/RbLinkage.vue'
import RbCompliance from './red-black/RbCompliance.vue'

const panels = {
  overview: markRaw(RbOverview),
  blacklist: markRaw(RbBlacklist),
  redlist: markRaw(RbRedlist),
  gray: markRaw(RbGrayLifecycle),
  linkage: markRaw(RbLinkage),
  compliance: markRaw(RbCompliance),
} as const

type PanelKey = keyof typeof panels

const activeMenu = ref<PanelKey>('overview')
const CurrentPanel = computed(() => panels[activeMenu.value])
</script>

<style scoped>
.rb-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.rb-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.rb-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.rb-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  font-weight: normal;
  line-height: 1.55;
  max-width: 900px;
}
.rb-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 520px;
}
.rb-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.rb-menu {
  border-right: none;
}
.rb-main {
  flex: 1;
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 14px 16px;
  background: #fff;
}
</style>
