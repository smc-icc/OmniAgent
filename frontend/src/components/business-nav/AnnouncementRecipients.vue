<template>
  <div class="recipient-picker">
    <div class="source-panel">
      <el-tabs v-model="category" class="source-tabs">
        <el-tab-pane v-for="c in categories" :key="c.key" :label="c.label" :name="c.key" />
      </el-tabs>
      <div class="source-columns">
        <div v-if="category !== 'operators'" class="group-column">
          <el-input v-model="groupSearch" placeholder="搜索分组" clearable aria-label="搜索分组" />
          <div class="group-list">
            <button v-for="g in groups" :key="g.id" type="button" :class="['group-item', { active: groupId === g.id }]" @click="groupId = g.id">
              <span>{{ g.name }}</span><small>{{ g.operator_ids.length }}</small>
            </button>
            <el-empty v-if="!groups.length" description="暂无分组" :image-size="44" />
          </div>
        </div>
        <div class="operator-column">
          <el-input v-model="availableSearch" placeholder="搜索姓名或工号" clearable aria-label="搜索可选操作员" />
          <div class="column-title"><span>可选操作员 {{ available.length }}</span><el-button link type="primary" @click="checked = available.map(o => o.id)">选择当前结果</el-button></div>
          <el-checkbox-group v-model="checked" class="operator-list">
            <el-checkbox v-for="o in available" :key="o.id" :value="o.id"><span>{{ o.name }}</span><small>{{ o.work_no }}</small></el-checkbox>
          </el-checkbox-group>
          <el-empty v-if="!available.length" :description="category !== 'operators' && !groupId ? '请选择左侧分组' : '暂无可添加的操作员'" :image-size="44" />
        </div>
      </div>
    </div>
    <div class="transfer-actions"><el-button type="primary" :disabled="!checked.length" @click="add">添加 →</el-button><span>合并后自动去重</span></div>
    <div class="selected-panel">
      <div class="selected-title">已选接收人 <el-tag>{{ modelValue.length }} 人</el-tag></div>
      <el-input v-model="selectedSearch" placeholder="搜索已选人员" clearable aria-label="搜索已选人员" />
      <div class="column-title"><span>姓名 / 工号</span><el-button link type="danger" :disabled="!removed.length" @click="remove">移除选中</el-button></div>
      <el-checkbox-group v-model="removed" class="operator-list">
        <el-checkbox v-for="o in selected" :key="o.id" :value="o.id"><span>{{ o.name }}</span><small>{{ o.work_no }}</small></el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="!selected.length" :description="modelValue.length ? '无匹配人员' : '从左侧添加接收人'" :image-size="48" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RecipientCatalog, Operator } from '@/api/announcements'
const props = defineProps<{ modelValue: number[]; catalog: RecipientCatalog }>()
const emit = defineEmits<{ 'update:modelValue': [value: number[]] }>()
const categories = [{ key: 'groups', label: '坐席组' }, { key: 'skills', label: '坐席技能' }, { key: 'departments', label: '部门' }, { key: 'roles', label: '角色' }, { key: 'custom', label: '自定义分组' }, { key: 'operators', label: '操作员' }]
const category = ref('groups'), groupId = ref<number>(), groupSearch = ref(''), availableSearch = ref(''), selectedSearch = ref('')
const checked = ref<number[]>([]), removed = ref<number[]>([])
const groups = computed(() => (props.catalog.categories[category.value] || []).filter(g => g.name.toLowerCase().includes(groupSearch.value.toLowerCase())))
const matches = (o: Operator, s: string) => `${o.name} ${o.work_no}`.toLowerCase().includes(s.trim().toLowerCase())
const available = computed(() => {
  const members = new Set((props.catalog.categories[category.value] || []).find(g => g.id === groupId.value)?.operator_ids || [])
  const picked = new Set(props.modelValue)
  return props.catalog.operators.filter(o => !picked.has(o.id) && (category.value === 'operators' || members.has(o.id)) && matches(o, availableSearch.value))
})
const selected = computed(() => {
  const operators = new Map(props.catalog.operators.map(o => [o.id, o]))
  return props.modelValue.map(id => operators.get(id) || { id, name: '人员已停用或不可用，请移除', work_no: String(id) }).filter(o => matches(o, selectedSearch.value))
})
watch(category, () => { groupId.value = undefined; groupSearch.value = ''; availableSearch.value = ''; checked.value = [] })
watch(groupId, () => { checked.value = [] })
watch(available, list => { const ids = new Set(list.map(o => o.id)); checked.value = checked.value.filter(id => ids.has(id)) })
watch(() => props.modelValue, ids => { removed.value = removed.value.filter(id => ids.includes(id)) })
function add() { emit('update:modelValue', [...new Set([...props.modelValue, ...checked.value])]); checked.value = [] }
function remove() { emit('update:modelValue', props.modelValue.filter(id => !removed.value.includes(id))); removed.value = [] }
</script>
<style scoped>
.recipient-picker{display:grid;grid-template-columns:minmax(420px,1.5fr) 110px minmax(240px,1fr);width:100%;gap:16px;align-items:stretch;line-height:1.5}
.source-panel,.selected-panel{border:1px solid var(--el-border-color-light);border-radius:6px;min-width:0;background:var(--el-bg-color)}
.source-tabs{padding:0 12px}.source-tabs :deep(.el-tabs__header){margin-bottom:0}.source-tabs :deep(.el-tabs__item){padding:0 12px}
.source-columns{display:flex;min-height:340px;padding:12px;gap:12px}.group-column{width:38%;border-right:1px solid var(--el-border-color-lighter);padding-right:12px}.operator-column{flex:1;min-width:0}.group-list,.operator-list{max-height:290px;overflow:auto}.group-list{padding-top:8px}.group-item{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;border:0;background:transparent;padding:10px;color:var(--el-text-color-primary);cursor:pointer;border-radius:4px}.group-item.active{background:var(--el-color-primary-light-9);color:var(--el-color-primary)}.group-item:hover{background:var(--el-fill-color-light)}
.operator-list{display:flex;flex-direction:column;gap:4px}.operator-list :deep(.el-checkbox){margin:0;padding:0 6px;max-width:100%;height:auto;min-height:32px}.operator-list :deep(.el-checkbox__label){white-space:normal;overflow-wrap:anywhere}.operator-list small{margin-left:8px;color:var(--el-text-color-secondary)}.column-title{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--el-text-color-secondary);margin:10px 0}.transfer-actions{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px}.transfer-actions span{font-size:12px;color:var(--el-text-color-secondary)}.selected-panel{padding:16px}.selected-title{display:flex;justify-content:space-between;margin-bottom:16px;font-weight:600}
@media(max-width:1000px){.recipient-picker{grid-template-columns:1fr}.transfer-actions{flex-direction:row}.source-columns{min-height:220px}.selected-panel .operator-list{max-height:220px}}
</style>
