<template>
  <div class="screenshot-menu">
    <button
      v-for="item in mainItems"
      :key="item.action"
      type="button"
      class="screenshot-menu-item"
      @click="onPick(item.action)"
    >
      <span class="item-icon" v-html="item.icon" />
      <span class="item-label">{{ item.label }}</span>
      <span v-if="item.shortcut" class="item-shortcut">{{ item.shortcut }}</span>
    </button>

    <div class="screenshot-menu-divider" />

    <label class="screenshot-menu-item screenshot-menu-check">
      <el-checkbox v-model="hideWindowModel" />
      <span class="item-label">隐藏当前窗口</span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ScreenshotAction } from './screenshot-context'

const props = defineProps<{
  hideWindow: boolean
}>()

const emit = defineEmits<{
  action: [action: ScreenshotAction]
  'update:hideWindow': [value: boolean]
}>()

const hideWindowModel = computed({
  get: () => props.hideWindow,
  set: (v: boolean) => emit('update:hideWindow', v),
})

const mainItems: Array<{
  action: ScreenshotAction
  label: string
  shortcut?: string
  icon: string
}> = [
  {
    action: 'screenshot',
    label: '截图',
    shortcut: 'Ctrl + Alt + A',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><path d="M8 6h5a4 4 0 0 1 4 4v2M8 18h8a4 4 0 0 0 4-4v-2"/><path d="M12 12h4"/></svg>',
  },
  {
    action: 'record',
    label: '录屏',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>',
  },
  {
    action: 'long',
    label: '长截图',
    shortcut: 'Ctrl + Alt + C',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 4v16M17 4v16"/><path d="M5 8h4M5 16h4M15 8h4M15 16h4"/></svg>',
  },
  {
    action: 'ocr',
    label: '提取文字',
    shortcut: 'Ctrl + Alt + O',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8M8 16h5"/><path d="M9 8h1"/></svg>',
  },
  {
    action: 'translate',
    label: '屏幕翻译',
    shortcut: 'Ctrl + Alt + F',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h6M7 12h4"/><path d="M14 8l3 8M17 8l-3 8"/></svg>',
  },
]

function onPick(action: ScreenshotAction) {
  emit('action', action)
}
</script>

<style scoped>
.screenshot-menu {
  min-width: 220px;
  padding: 6px 0;
}
.screenshot-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: #303133;
  text-align: left;
  box-sizing: border-box;
}
.screenshot-menu-item:hover {
  background: rgba(0, 0, 0, 0.04);
}
.screenshot-menu-check {
  cursor: default;
  padding-left: 10px;
}
.screenshot-menu-check:hover {
  background: transparent;
}
.item-icon {
  display: inline-flex;
  width: 20px;
  justify-content: center;
  color: #606266;
  flex-shrink: 0;
}
.item-label {
  flex: 1;
}
.item-shortcut {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}
.screenshot-menu-divider {
  height: 1px;
  margin: 4px 10px;
  background: #ebeef5;
}
</style>
