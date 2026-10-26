<template>
  <Teleport to="body">
    <div v-if="visible" class="screenshot-record-bar">
      <span class="rec-dot" />
      <span>正在录屏…</span>
      <el-button type="danger" size="small" @click="$emit('stop')">停止录制</el-button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{ visible: boolean }>()
defineEmits<{ stop: [] }>()
</script>

<style scoped>
.screenshot-record-bar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: rgba(30, 30, 30, 0.92);
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
}
.rec-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f56c6c;
  animation: rec-pulse 1.2s ease-in-out infinite;
}
@keyframes rec-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
