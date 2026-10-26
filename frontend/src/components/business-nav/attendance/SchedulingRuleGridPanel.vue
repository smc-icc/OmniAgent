<template>
  <div class="srg">
    <div class="srg-side">
      <div class="srg-side-hd">
        <el-button size="small" plain>开启多选</el-button>
        <el-button size="small" link type="primary">
          <el-icon class="srg-ico"><Setting /></el-icon>
          {{ groupSettingsLabel }}
        </el-button>
      </div>
      <el-input
        v-if="showSearch"
        v-model="searchText"
        :placeholder="searchPlaceholder"
        size="small"
        clearable
        class="srg-search"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-scrollbar class="srg-tree-wrap">
        <el-tree
          :data="filteredTree"
          :props="{ label: 'label', children: 'children' }"
          node-key="id"
          default-expand-all
          highlight-current
          :current-node-key="selectedId"
          @node-click="onNodeClick"
        />
      </el-scrollbar>
    </div>
    <div class="srg-main">
      <div class="srg-tags">
        <el-button
          v-for="t in tags"
          :key="t"
          size="small"
          :type="activeTag === t ? 'primary' : 'default'"
          plain
          class="srg-tag"
          @click="togglePickTag(t)"
        >
          {{ t }}
        </el-button>
        <el-button link type="primary" size="small" @click="openAddTag">添加标签</el-button>
        <el-button link type="primary" size="small">编辑标签</el-button>
      </div>
      <div class="srg-grid-hd">
        <span class="srg-grid-hd-spacer" />
        <el-radio-group v-model="currentMode" size="small">
          <el-radio-button value="no_schedule">不排课</el-radio-button>
          <el-radio-button value="priority">优先排</el-radio-button>
        </el-radio-group>
        <el-tooltip content="勾选网格或批量选项，将按当前模式标记节次（演示数据会随「保存并下一步」写入后端）" placement="top">
          <el-icon class="srg-info"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
      <div class="srg-table-wrap">
        <table class="srg-table" border="0" cellpadding="0" cellspacing="0">
          <thead>
            <tr>
              <th class="srg-th-corner" />
              <th v-for="d in 5" :key="d" class="srg-th-day">
                <div class="srg-day-name">{{ weekDays[d - 1] }}</div>
                <div class="srg-day-bulk">
                  <el-checkbox
                    :model-value="isDayMorningAll(d - 1)"
                    @update:model-value="onMorningBulk(d - 1, $event)"
                  >
                    上午不排
                  </el-checkbox>
                  <el-checkbox
                    :model-value="isDayAfternoonAll(d - 1)"
                    @update:model-value="onAfternoonBulk(d - 1, $event)"
                  >
                    下午不排
                  </el-checkbox>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(row, ri) in gridRows">
              <tr v-if="row.kind === 'break'" :key="'br-' + ri" class="srg-tr-break">
                <td colspan="6" class="srg-td-break">{{ row.label }}</td>
              </tr>
              <tr v-else :key="'pr-' + ri + '-' + row.period" class="srg-tr-period">
                <td class="srg-td-label">
                  <el-checkbox
                    :model-value="isRowAllDays(row.period)"
                    @update:model-value="onRowBulk(row.period, $event)"
                  >
                    第{{ row.period }}节 不排课
                  </el-checkbox>
                </td>
                <td
                  v-for="d in 5"
                  :key="d"
                  class="srg-td-cell"
                  @click="toggleCell(d - 1, row.period)"
                >
                  <div class="srg-cell" :class="{ 'srg-cell--on': cellOn(d - 1, row.period) }">
                    <span class="srg-cell-hint">{{ currentMode === 'priority' ? '优先' : '不排' }}</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <el-dialog v-model="tagDlg" title="添加标签" width="400px" destroy-on-close @closed="newTagName = ''">
      <el-input v-model="newTagName" maxlength="6" show-word-limit placeholder="请输入最多6个字的标签名称" />
      <template #footer>
        <el-button @click="tagDlg = false">取消</el-button>
        <el-button type="primary" @click="confirmAddTag">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { InfoFilled, Search, Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, ref, watch } from 'vue'
import type { RestrictionEntityGrid, SchedulingTreeNode } from '@/api/schedulingRulesDefaults'

const props = withDefaults(
  defineProps<{
    treeData: SchedulingTreeNode[]
    groupSettingsLabel: string
    showSearch?: boolean
    searchPlaceholder?: string
  }>(),
  {
    showSearch: false,
    searchPlaceholder: '请输入老师姓名',
  },
)

const selectedId = defineModel<string>('selectedId', { required: true })
const grids = defineModel<Record<string, RestrictionEntityGrid>>('grids', { required: true })
const tags = defineModel<string[]>('tags', { required: true })

const weekDays = ['周一', '周二', '周三', '周四', '周五']
const morningPeriods = [1, 2, 3, 4, 5]
const afternoonPeriods = [6, 7, 8]

type GridRow = { kind: 'period'; period: number } | { kind: 'break'; label: string }

const gridRows: GridRow[] = [
  { kind: 'period', period: 1 },
  { kind: 'period', period: 2 },
  { kind: 'break', label: '大课间' },
  { kind: 'period', period: 3 },
  { kind: 'period', period: 4 },
  { kind: 'period', period: 5 },
  { kind: 'break', label: '午休' },
  { kind: 'period', period: 6 },
  { kind: 'period', period: 7 },
  { kind: 'period', period: 8 },
]

const searchText = ref('')
const activeTag = ref('')
const tagDlg = ref(false)
const newTagName = ref('')

function cellKey(day: number, period: number) {
  return `${day}-${period}`
}

function ensureEntity(id: string) {
  if (!id) return
  if (!grids.value[id]) {
    grids.value[id] = { mode: 'no_schedule', cells: {} }
  }
}

const currentGrid = computed(() => {
  ensureEntity(selectedId.value)
  return grids.value[selectedId.value]
})

const currentMode = computed({
  get: () => currentGrid.value?.mode ?? 'no_schedule',
  set: (m: 'no_schedule' | 'priority') => {
    ensureEntity(selectedId.value)
    grids.value[selectedId.value].mode = m
  },
})

function filterNodes(nodes: SchedulingTreeNode[], q: string): SchedulingTreeNode[] {
  if (!q.trim()) return nodes
  const lower = q.trim().toLowerCase()
  const out: SchedulingTreeNode[] = []
  for (const n of nodes) {
    const hit = n.label.toLowerCase().includes(lower)
    const kids = n.children ? filterNodes(n.children, q) : []
    if (hit || kids.length) {
      out.push({ ...n, children: kids.length ? kids : n.children })
    }
  }
  return out
}

const filteredTree = computed(() => filterNodes(props.treeData, searchText.value))

function onNodeClick(data: SchedulingTreeNode) {
  selectedId.value = data.id
}

function cellOn(day: number, period: number) {
  return !!currentGrid.value?.cells[cellKey(day, period)]
}

function toggleCell(day: number, period: number) {
  ensureEntity(selectedId.value)
  const k = cellKey(day, period)
  const cells = grids.value[selectedId.value].cells
  cells[k] = !cells[k]
}

function isDayMorningAll(day: number) {
  return morningPeriods.every((p) => cellOn(day, p))
}

function isDayAfternoonAll(day: number) {
  return afternoonPeriods.every((p) => cellOn(day, p))
}

function toggleDayMorning(day: number, on: boolean) {
  ensureEntity(selectedId.value)
  const cells = grids.value[selectedId.value].cells
  for (const p of morningPeriods) {
    const k = cellKey(day, p)
    if (on) cells[k] = true
    else delete cells[k]
  }
}

function toggleDayAfternoon(day: number, on: boolean) {
  ensureEntity(selectedId.value)
  const cells = grids.value[selectedId.value].cells
  for (const p of afternoonPeriods) {
    const k = cellKey(day, p)
    if (on) cells[k] = true
    else delete cells[k]
  }
}

function isRowAllDays(period: number) {
  return [0, 1, 2, 3, 4].every((d) => cellOn(d, period))
}

function toggleRowAllDays(period: number, on: boolean) {
  ensureEntity(selectedId.value)
  const cells = grids.value[selectedId.value].cells
  for (let d = 0; d < 5; d++) {
    const k = cellKey(d, period)
    if (on) cells[k] = true
    else delete cells[k]
  }
}

function onMorningBulk(day: number, v: string | number | boolean | undefined) {
  toggleDayMorning(day, Boolean(v))
}

function onAfternoonBulk(day: number, v: string | number | boolean | undefined) {
  toggleDayAfternoon(day, Boolean(v))
}

function onRowBulk(period: number, v: string | number | boolean | undefined) {
  toggleRowAllDays(period, Boolean(v))
}

function togglePickTag(t: string) {
  activeTag.value = activeTag.value === t ? '' : t
}

function openAddTag() {
  newTagName.value = ''
  tagDlg.value = true
}

function confirmAddTag() {
  const t = newTagName.value.trim()
  if (!t) {
    ElMessage.warning('请输入标签名称')
    return
  }
  if (t.length > 6) {
    ElMessage.warning('最多 6 个字')
    return
  }
  if (!tags.value.includes(t)) {
    tags.value = [...tags.value, t]
  }
  tagDlg.value = false
}

watch(
  () => selectedId.value,
  (id) => {
    if (id) ensureEntity(id)
  },
  { immediate: true },
)
</script>

<style scoped>
.srg {
  display: flex;
  gap: 12px;
  align-items: stretch;
  min-height: 420px;
}
.srg-side {
  width: 240px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: #fff;
  display: flex;
  flex-direction: column;
  padding: 10px;
}
.srg-side-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.srg-ico {
  margin-right: 2px;
  vertical-align: middle;
}
.srg-search {
  margin-bottom: 8px;
}
.srg-tree-wrap {
  flex: 1;
  min-height: 200px;
}
.srg-main {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: #fff;
  padding: 10px;
  display: flex;
  flex-direction: column;
}
.srg-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.srg-tag {
  font-weight: normal;
}
.srg-grid-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.srg-grid-hd-spacer {
  flex: 1;
}
.srg-info {
  color: var(--el-text-color-secondary);
  font-size: 16px;
}
.srg-table-wrap {
  overflow: auto;
  flex: 1;
}
.srg-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.srg-th-corner {
  width: 168px;
  min-width: 168px;
  border: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
}
.srg-th-day {
  border: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
  padding: 6px 8px;
  vertical-align: top;
}
.srg-day-name {
  font-weight: 600;
  margin-bottom: 6px;
  text-align: center;
}
.srg-day-bulk {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.srg-day-bulk :deep(.el-checkbox) {
  height: auto;
  margin-right: 0;
  white-space: nowrap;
}
.srg-tr-break .srg-td-break {
  border: 1px solid var(--el-border-color-lighter);
  background: #f5f7fa;
  text-align: center;
  padding: 6px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}
.srg-td-label {
  border: 1px solid var(--el-border-color-lighter);
  padding: 6px 8px;
  background: #fafafa;
  vertical-align: middle;
  white-space: nowrap;
}
.srg-td-label :deep(.el-checkbox) {
  height: auto;
  align-items: flex-start;
  white-space: normal;
}
.srg-td-cell {
  border: 1px solid var(--el-border-color-lighter);
  padding: 4px;
  cursor: pointer;
  vertical-align: middle;
  text-align: center;
  min-width: 72px;
}
.srg-cell {
  min-height: 44px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  transition: background 0.15s;
}
.srg-cell:hover {
  background: var(--el-fill-color-light);
}
.srg-cell--on {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 500;
}
.srg-cell-hint {
  pointer-events: none;
}
@media (max-width: 1100px) {
  .srg {
    flex-direction: column;
  }
  .srg-side {
    width: 100%;
  }
}
</style>
