<template>
  <el-card shadow="never" class="vom-root">
    <template #header>
      <div>
        <span class="vom-title">留言</span>
        <span v-if="productModules.enabled('icc')" class="vom-sub"
          >统一处理访客留言与离线会话：<b>在线留言</b>（非工作时间或排队溢出时访客留下的问题，来自
          ITR）与 <b>语音留言</b>（IVR）、离线消息。可认领接入会话、指派回电，并与录音、ASR、工单、
          客户 360 对接。</span
        >
      </div>
    </template>
    <div class="vom-layout">
      <aside class="vom-aside">
        <el-menu :default-active="active" class="vom-menu" @select="onMenuSelect">
          <el-menu-item v-if="productModules.enabled('icc')" index="overview">总览</el-menu-item>
          <el-menu-item v-if="productModules.enabled('icc')" index="voicemail">语音留言</el-menu-item>
          <el-menu-item index="online">在线留言</el-menu-item>
          <el-menu-item index="offline">离线消息</el-menu-item>
          <el-menu-item v-if="productModules.enabled('icc')" index="dispatch">回电与指派</el-menu-item>
          <el-menu-item index="history">处理记录</el-menu-item>
          <el-menu-item v-if="productModules.enabled('icc')" index="routing">规则与 SLA</el-menu-item>
        </el-menu>
      </aside>
      <main class="vom-main">
        <component :is="Panel" />
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules=useProductModulesStore()

import { computed, markRaw, ref } from 'vue'
import VomOverview from './voicemail-offline/VomOverview.vue'
import VomVoicemailInbox from './voicemail-offline/VomVoicemailInbox.vue'
import VomOnlineLeave from './voicemail-offline/VomOnlineLeave.vue'
import VomOfflineInbox from './voicemail-offline/VomOfflineInbox.vue'
import VomDispatch from './voicemail-offline/VomDispatch.vue'
import VomHistory from './voicemail-offline/VomHistory.vue'
import VomRouting from './voicemail-offline/VomRouting.vue'

const map = {
  overview: markRaw(VomOverview),
  voicemail: markRaw(VomVoicemailInbox),
  online: markRaw(VomOnlineLeave),
  offline: markRaw(VomOfflineInbox),
  dispatch: markRaw(VomDispatch),
  history: markRaw(VomHistory),
  routing: markRaw(VomRouting),
} as const

type Key = keyof typeof map

const active = ref<Key>(productModules.enabled('icc')?'overview':'online')
const Panel = computed(() => map[!productModules.enabled('icc') && ['overview','voicemail','dispatch','routing'].includes(active.value) ? 'online' : active.value])

function onMenuSelect(index: string) {
  if (index in map) active.value = index as Key
}
</script>

<style scoped>
.vom-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.vom-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.vom-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.vom-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 960px;
  font-weight: normal;
}
.vom-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 520px;
}
.vom-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.vom-menu {
  border-right: none;
}
.vom-main {
  flex: 1;
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 14px 16px;
  background: #fff;
}
</style>
