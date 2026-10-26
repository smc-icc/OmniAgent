<template>
  <div class="soft-dial-pad">
    <div class="soft-dial-display">
      <input
        :value="modelValue"
        class="soft-dial-display-input"
        type="text"
        inputmode="tel"
        :placeholder="placeholder || '请输入被叫号码'"
        :aria-label="inputLabel || '被叫号码'"
        :readonly="!editable"
        @input="onInput"
      />
      <button
        type="button"
        class="soft-dial-backspace"
        title="退格"
        :disabled="!modelValue"
        @click="backspace"
      >
        <el-icon><Delete /></el-icon>
      </button>
    </div>

    <div class="soft-dial-grid">
      <button
        v-for="key in keys"
        :key="key.id"
        type="button"
        class="soft-dial-key"
        @click="append(key.value)"
      >
        <span class="soft-dial-key-main">{{ key.main }}</span>
        <span v-if="key.sub" class="soft-dial-key-sub">{{ key.sub }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Delete } from '@element-plus/icons-vue'

const modelValue = defineModel<string>({ default: '' })
defineProps<{ editable?: boolean; placeholder?: string; inputLabel?: string }>()

/** 通话中按键需要立刻发 DTMF，而不是等号码输完；拨号场景可忽略该事件 */
const emit = defineEmits<{ key: [digit: string] }>()

const keys = [
  { id: '1', main: '1', sub: '', value: '1' },
  { id: '2', main: '2', sub: 'ABC', value: '2' },
  { id: '3', main: '3', sub: 'DEF', value: '3' },
  { id: '4', main: '4', sub: 'GHI', value: '4' },
  { id: '5', main: '5', sub: 'JKL', value: '5' },
  { id: '6', main: '6', sub: 'MNO', value: '6' },
  { id: '7', main: '7', sub: 'PQRS', value: '7' },
  { id: '8', main: '8', sub: 'TUV', value: '8' },
  { id: '9', main: '9', sub: 'WXYZ', value: '9' },
  { id: 'star', main: '*', sub: '', value: '*' },
  { id: '0', main: '0', sub: '+', value: '0' },
  { id: 'hash', main: '#', sub: '', value: '#' },
] as const

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  modelValue.value = raw.replace(/[^\d*#]/g, '').slice(0, 20)
}

function append(ch: string) {
  modelValue.value = `${modelValue.value}${ch}`
  emit('key', ch)
}

function backspace() {
  if (!modelValue.value) return
  modelValue.value = modelValue.value.slice(0, -1)
}
</script>

<style scoped>
.soft-dial-pad {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.soft-dial-display {
  display: flex;
  align-items: center;
  gap: 8px;
}

.soft-dial-display-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 20px;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.06em;
  text-align: center;
  color: #303133;
  background: #f5f7fa;
  outline: none;
}

.soft-dial-backspace {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  cursor: pointer;
}
.soft-dial-backspace:hover:not(:disabled) {
  border-color: #c0c4cc;
  color: var(--oa-primary, #409eff);
}
.soft-dial-backspace:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.soft-dial-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.soft-dial-key {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 6px 4px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: linear-gradient(180deg, #fff 0%, #f5f7fa 100%);
  cursor: pointer;
  line-height: 1.1;
  user-select: none;
}
.soft-dial-key:hover {
  border-color: #c6e2ff;
  background: #ecf5ff;
}
.soft-dial-key:active {
  transform: scale(0.98);
}

.soft-dial-key-main {
  font-size: 22px;
  font-weight: 600;
  color: #303133;
}
.soft-dial-key-sub {
  margin-top: 2px;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: #909399;
}
</style>
