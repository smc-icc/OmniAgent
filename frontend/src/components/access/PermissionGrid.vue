<template>
  <div class="permission-grid">
    <div class="filters">
      <el-input v-model="keyword" clearable placeholder="输入权限名称或权限值查询" :prefix-icon="Search" aria-label="搜索权限" />
      <el-select v-model="subsystem" aria-label="权限来源" style="width: 170px">
        <el-option label="全部权限" :value="-1" />
        <el-option v-for="category in categories" :key="category.id" :value="category.id" :label="category.name" />
      </el-select>
    </div>
    <p class="hint">{{ readonly ? '继承权限请到对应角色或部门中调整。' : '勾选或取消后立即保存；角色与部门权限合并生效。' }}</p>
    <el-table :data="filtered" stripe border max-height="490" empty-text="暂无匹配权限" row-key="id">
      <el-table-column label="授权" width="65" align="center">
        <template #default="{ row }"><el-checkbox :model-value="ids.includes(row.id)" :disabled="readonly || busy" :aria-label="`${row.name}授权`" @change="emit('change', row.id, Boolean($event))" /></template>
      </el-table-column>
      <el-table-column prop="name" label="权限名称" min-width="170" />
      <el-table-column prop="moduleName" label="模块" width="130" />
      <el-table-column label="数据范围" width="150"><template #default="{ row }">
        <el-select v-if="row.scopes?.length" :model-value="scopeValues?.[row.id] || row.scopes[0]" :disabled="readonly || busy || !ids.includes(row.id)" :aria-label="`${row.name}数据范围`" @change="emit('change', row.id, true, $event)">
          <el-option v-for="scope in row.scopes" :key="scope" :value="scope" :label="scopeLabels[scope as DataScope]" />
        </el-select><span v-else>—</span>
      </template></el-table-column>
      <el-table-column prop="category" label="所属系统" width="145" />
      <el-table-column prop="value" label="权限值" width="80" />
      <el-table-column v-if="sources" label="权限来源" min-width="130"><template #default="{ row }">{{ sources[row.id] || '—' }}</template></el-table-column>
    </el-table>
    <div class="count">已授予 {{ new Set(ids).size }} 项权限</div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import type { Permission, DataScope } from '@/api/access'
const props = defineProps<{ catalog: Permission[]; ids: number[]; busy?: boolean; readonly?: boolean; sources?: Record<number, string>; scopeValues?: Record<number, DataScope> }>()
const emit = defineEmits<{ change: [id: number, granted: boolean, scope?: DataScope] }>()
const scopeLabels: Record<DataScope, string> = { self: '仅本人', group: '本坐席组', department: '本部门', account: '当前租户' }
const keyword = ref(''), subsystem = ref(-1)
const categories = computed(() => Array.from(new Map(props.catalog.map(p => [p.subsystem, { id: p.subsystem, name: p.category }])).values()))
const filtered = computed(() => props.catalog.filter(p => (subsystem.value === -1 || p.subsystem === subsystem.value) && `${p.name} ${p.value}`.toLowerCase().includes(keyword.value.trim().toLowerCase())))
</script>
<style scoped>
.filters { display: flex; gap: 12px; } .filters > .el-input { flex: 1; }
.hint,.count { color: var(--el-text-color-secondary); font-size: 12px; margin: 12px 0; }
@media(max-width: 600px) { .filters { flex-direction: column; } }
</style>
