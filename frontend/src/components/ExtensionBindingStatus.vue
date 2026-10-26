<template>
  <button
    v-if="productModules.enabled('icc') && !access.systemSuperuser"
    type="button"
    class="extension-status"
    @click="store.panelOpen = true"
    aria-label="查看和管理分机绑定"
  >
    <span>{{ store.binding.extension || '分机' }}</span>
    <el-icon :color="store.binding.extension ? '#15803d' : '#64748b'"
      ><CircleCheck v-if="store.binding.extension" /><Minus v-else
    /></el-icon>
    <span>{{
      store.snapshot
        ? store.binding.extension
          ? '已绑定'
          : '未绑定'
        : store.error
          ? '查询失败'
          : '查询中'
    }}</span>
    <el-tag v-if="store.snapshot?.operation" size="small" type="warning">处理中</el-tag>
    <el-tag v-else-if="store.snapshot?.request" size="small" type="warning">待审批</el-tag>
  </button>
</template>
<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules = useProductModulesStore()

import { onMounted } from 'vue'
import { CircleCheck, Minus } from '@element-plus/icons-vue'
import { useExtensionBindingStore } from '@/stores/extension-binding'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
const store = useExtensionBindingStore(),
  access = useAccessStore(),
  auth = useAuthStore()
onMounted(() => {
  if (productModules.enabled('icc') && auth.isLoggedIn && !access.systemSuperuser) void store.refresh().catch(() => undefined)
})
</script>
<style scoped>
.extension-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  min-height: 36px;
  padding: 4px 6px;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.extension-status:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
  border-radius: 4px;
}
</style>
