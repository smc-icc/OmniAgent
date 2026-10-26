<template>
  <div class="vdn-picker">
    <div class="vdn-picker-search">
      <span>VDN</span>
      <input v-model="query" type="search" placeholder="搜索名称或编号" :disabled="disabled" />
      <small>{{ filtered.length }} / {{ choices.length }}</small>
    </div>
    <div class="vdn-picker-list" role="listbox" aria-label="VDN 列表">
      <button
        v-for="choice in filtered"
        :key="keyOf(choice)"
        type="button"
        role="option"
        :aria-selected="modelValue === keyOf(choice)"
        :class="{ 'is-selected': modelValue === keyOf(choice) }"
        :disabled="disabled"
        @click="modelValue = keyOf(choice)"
      >
        <span>{{ choice.name }}</span>
        <small v-if="choice.vdn_id">VDN {{ choice.vdn_id }}</small>
      </button>
      <p v-if="!filtered.length" class="vdn-picker-empty">没有匹配的 VDN</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

export interface VdnChoice {
  user_id: number
  vdn_id: number | null
  name: string
}

const props = defineProps<{ choices: VdnChoice[]; disabled?: boolean }>()
const modelValue = defineModel<string>({ default: '' })
const query = ref('')

function keyOf(choice: VdnChoice) {
  return `${choice.user_id}:${choice.vdn_id ?? 0}`
}

const filtered = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (!text) return props.choices
  return props.choices.filter(choice => choice.name.toLowerCase().includes(text) || String(choice.vdn_id ?? '').includes(text))
})
</script>

<style scoped>
.vdn-picker { border: 1px solid #4069e1; border-radius: 2px; background: #fff; overflow: hidden; }
.vdn-picker-search { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border-bottom: 1px solid #ebeef5; }
.vdn-picker-search span { width: 42px; flex-shrink: 0; font-size: 14px; color: #303133; }
.vdn-picker-search input { flex: 1; min-width: 0; border: none; outline: none; font-size: 14px; color: #303133; background: transparent; }
.vdn-picker-search small { flex-shrink: 0; font-size: 12px; color: #909399; }
.vdn-picker-list { max-height: 220px; overflow: auto; }
.vdn-picker-list button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 8px 14px; border: none; border-bottom: 1px solid #f2f3f5; background: #fff; text-align: left; cursor: pointer; }
.vdn-picker-list button span { font-size: 14px; color: #303133; }
.vdn-picker-list button small { flex-shrink: 0; font-size: 12px; color: #909399; }
.vdn-picker-list button.is-selected { background: #f4f7ff; }
.vdn-picker-list button.is-selected span { color: #4069e1; font-weight: 600; }
.vdn-picker-list button:disabled { cursor: not-allowed; opacity: 0.6; }
.vdn-picker-empty { margin: 0; padding: 12px 14px; font-size: 13px; color: #909399; }
</style>
