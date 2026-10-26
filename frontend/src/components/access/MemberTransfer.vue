<template>
  <div class="member-transfer">
    <section v-for="side in sides" :key="side.key" class="member-side">
      <h4>{{ side.label }} <span>{{ side.items.length }}</span></h4>
      <el-input v-model="search[side.key]" clearable placeholder="输入姓名或工号查询" :prefix-icon="Search" :aria-label="`${side.label}搜索`" />
      <el-table :data="visible[side.key]" row-key="id" stripe border height="365" empty-text="暂无人员" @selection-change="selected[side.key] = $event.map((u: Operator) => u.id)">
        <el-table-column type="selection" width="42" :selectable="() => !busy" />
        <el-table-column prop="work_no" label="登录工号" min-width="105" />
        <el-table-column prop="name" label="坐席姓名" min-width="110" />
      </el-table>
      <el-button :type="side.key === 'available' ? 'primary' : 'default'" :disabled="busy || !selected[side.key].length" :icon="side.key === 'available' ? Right : Back" @click="emit('change', side.key === 'available' ? 'add' : 'remove', selected[side.key])">
        {{ side.key === 'available' ? '加入' : '移除' }}已选人员（{{ selected[side.key].length }}）
      </el-button>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Search, Right, Back } from '@element-plus/icons-vue'
import type { Operator } from '@/api/access'
const props = defineProps<{ users: Operator[]; ids: number[]; busy: boolean }>()
const emit = defineEmits<{ change: [action: 'add' | 'remove', ids: number[]] }>()
type Side = 'available' | 'assigned'
const search = reactive({ available: '', assigned: '' })
const selected = reactive<Record<Side, number[]>>({ available: [], assigned: [] })
const sides = computed(() => [
  { key: 'available' as const, label: '可选择的坐席', items: props.users.filter(u => !props.ids.includes(u.id)) },
  { key: 'assigned' as const, label: '已选择的坐席', items: props.users.filter(u => props.ids.includes(u.id)) },
])
const visible = computed(() => Object.fromEntries(sides.value.map(side => {
  const kw = search[side.key].trim().toLowerCase()
  return [side.key, side.items.filter(u => `${u.work_no} ${u.name}`.toLowerCase().includes(kw))]
})) as Record<Side, Operator[]>)
watch(() => props.ids, () => { selected.available = []; selected.assigned = [] })
</script>
<style scoped>
.member-transfer { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.member-side { min-width: 0; } h4 { margin: 0 0 12px; font-size: 14px; } h4 span { color: var(--el-text-color-secondary); margin-left: 8px; font-weight: 400; }
.el-table { margin: 12px 0; } @media(max-width: 800px) { .member-transfer { grid-template-columns: 1fr; } }
</style>
