<template>
  <div class="ph">
    <el-empty :description="`${title} · 界面占位，可对接具体业务`" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const title = computed(() => (route.meta.title as string) || '模块')
</script>

<style scoped>
.ph {
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--oa-card);
  border-radius: 8px;
}
</style>
