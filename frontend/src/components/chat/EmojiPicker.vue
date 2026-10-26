<template>
  <div class="emoji-picker">
    <div class="emoji-picker-head">
      <span class="emoji-count">共 {{ total }} 个表情</span>
    </div>
    <div v-for="group in groups" :key="group.label" class="emoji-group">
      <div class="emoji-group-label">{{ group.label }}</div>
      <div class="emoji-grid">
        <button
          v-for="emoji in group.items"
          :key="`${group.label}-${emoji}`"
          type="button"
          class="emoji-btn"
          :title="emoji"
          @click="$emit('pick', emoji)"
        >
          {{ emoji }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { emojiGroups, emojiTotalCount } from './emoji-data'

defineEmits<{ pick: [emoji: string] }>()

const groups = emojiGroups
const total = emojiTotalCount
</script>

<style scoped>
.emoji-picker {
  width: 100%;
  max-height: 320px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 4px 2px 8px;
  box-sizing: border-box;
}
.emoji-picker-head {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 4px 2px 8px;
  background: var(--el-bg-color-overlay, #fff);
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 4px;
}
.emoji-count {
  font-size: 12px;
  color: #909399;
}
.emoji-group-label {
  font-size: 12px;
  font-weight: 500;
  color: #606266;
  margin: 10px 0 6px;
  padding-left: 2px;
}
.emoji-group:first-of-type .emoji-group-label {
  margin-top: 4px;
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 40px);
  gap: 4px;
  justify-content: start;
}
.emoji-btn {
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  width: 40px;
  height: 40px;
  padding: 0;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.emoji-btn:hover {
  background: #f0f2f5;
}
</style>
