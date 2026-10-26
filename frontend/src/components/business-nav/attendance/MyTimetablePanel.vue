<template>
  <div class="mtp">
    <header class="mtp-hd">
      <h2 class="mtp-title">我的课表</h2>
    </header>

    <div class="mtp-filters">
      <el-select v-model="termId" placeholder="学期" style="width: 220px" @change="onTermChange">
        <el-option v-for="t in meta?.terms ?? []" :key="t.id" :label="t.label" :value="t.id" />
      </el-select>
      <el-select v-model="campusId" placeholder="校区" style="width: 240px" @change="reloadAll">
        <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="weekNumber" placeholder="周次" style="width: 260px" @change="reloadGrid">
        <el-option v-for="w in meta?.weeks ?? []" :key="w.week_number" :label="w.label" :value="w.week_number" />
      </el-select>
    </div>

    <el-tabs v-model="viewTab" class="mtp-tabs" @tab-change="onTabChange">
      <el-tab-pane label="个人课表" name="personal" />
      <el-tab-pane label="班级课表" name="class" />
    </el-tabs>

    <div class="mtp-body" :class="{ 'mtp-body--class': viewTab === 'class' }">
      <aside v-if="viewTab === 'class'" class="mtp-aside">
        <el-input
          v-model="treeFilter"
          clearable
          placeholder="搜索班级名称"
          class="mtp-search"
          @input="onFilterInput"
        />
        <el-tree
          ref="treeRef"
          class="mtp-tree"
          :data="classTree"
          :props="{ label: 'label', children: 'children' }"
          node-key="id"
          highlight-current
          default-expand-all
          :filter-node-method="filterTreeNode"
          @node-click="onTreeNodeClick"
        />
      </aside>

      <div v-loading="gridLoading" class="mtp-scroll">
        <table class="mtp-table" v-if="grid">
          <thead>
            <tr>
              <th class="mtp-th-period">节次</th>
              <th
                v-for="d in grid.days"
                :key="d.iso"
                class="mtp-th-day"
                :class="{ 'mtp-th-day--today': isTodayIso(d.iso) }"
              >
                {{ d.label }}({{ d.date_md }})
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in grid.periods" :key="p.id">
              <td class="mtp-td-period">
                <div class="mtp-pname">{{ p.name }}</div>
                <div v-if="p.start && p.end" class="mtp-ptime">{{ p.start }} - {{ p.end }}</div>
                <div v-else class="mtp-ptime mtp-ptime--muted">—</div>
              </td>
              <td
                v-for="d in grid.days"
                :key="`${p.id}-${d.iso}`"
                class="mtp-td-cell"
                :class="{ 'mtp-td-cell--today': isTodayIso(d.iso) }"
              >
                <template v-for="c in [cellAt(d.dow, p.id)]" :key="d.iso + p.id">
                  <div v-if="c && c.type === 'meeting'" class="mtp-meeting">
                    {{ c.label || '教研' }}
                  </div>
                  <div
                    v-else-if="c && viewTab === 'personal'"
                    class="mtp-card"
                    :style="c.color ? { background: c.color } : undefined"
                  >
                    <div class="mtp-card-line mtp-card-class">{{ c.class_name }}</div>
                    <div class="mtp-card-line mtp-card-subj">{{ c.subject_name }}</div>
                    <div class="mtp-card-line mtp-card-loc">{{ c.location_name }}</div>
                  </div>
                  <div
                    v-else-if="c"
                    class="mtp-subject"
                    :style="c.color ? { background: c.color } : undefined"
                  >
                    {{ c.subject_display || c.subject_name }}
                  </div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { ElTree } from 'element-plus'
import {
  fetchClassTimetable,
  fetchPersonalTimetable,
  fetchTimetableClasses,
  fetchTimetableMeta,
  type ClassTreeNode,
  type TimetableCell,
  type TimetableGridResponse,
  type TimetableMeta,
} from '@/api/timetable'


const meta = ref<TimetableMeta | null>(null)
const termId = ref('')
const campusId = ref('')
const weekNumber = ref(5)
const viewTab = ref<'personal' | 'class'>('personal')

const classTree = ref<ClassTreeNode[]>([])
const treeFilter = ref('')
const treeRef = ref<InstanceType<typeof ElTree>>()
const selectedClassId = ref('cls-g7-1')

const grid = ref<TimetableGridResponse | null>(null)
const gridLoading = ref(false)

const cellMap = computed(() => {
  const m = new Map<string, TimetableCell>()
  const cells = grid.value?.cells ?? []
  for (const c of cells) {
    m.set(`${c.day}-${c.period_id}`, c)
  }
  return m
})

function cellAt(day: number, periodId: string): TimetableCell | undefined {
  return cellMap.value.get(`${day}-${periodId}`)
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function isTodayIso(iso: string) {
  const t = new Date()
  const local = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`
  return local === iso
}

function onTermChange() {
  reloadAll()
}

async function loadMeta() {
  meta.value = await fetchTimetableMeta(termId.value || undefined)
  if (!termId.value && meta.value.current_term_id) {
    termId.value = meta.value.current_term_id
  }
  if (!campusId.value && meta.value.campuses.length) {
    campusId.value = meta.value.campuses[0]!.id
  }
  if (meta.value.weeks.length) {
    const w5 = meta.value.weeks.find((w) => w.week_number === 5)
    weekNumber.value = w5 ? 5 : meta.value.weeks[0]!.week_number
  }
}

async function loadClassTree() {
  if (!campusId.value) {
    classTree.value = []
    return
  }
  classTree.value = await fetchTimetableClasses(campusId.value)
  await nextTick()
  treeRef.value?.filter(treeFilter.value)
  treeRef.value?.setCurrentKey(selectedClassId.value)
}

function filterTreeNode(value: string, data: ClassTreeNode) {
  if (!value) return true
  return data.label.includes(value)
}

function onFilterInput() {
  treeRef.value?.filter(treeFilter.value)
}

function onTreeNodeClick(data: ClassTreeNode) {
  if (data.is_class && data.id) {
    selectedClassId.value = data.id
    reloadGrid()
  }
}

function onTabChange() {
  reloadGrid()
}

async function reloadAll() {
  await loadMeta()
  await loadClassTree()
  await reloadGrid()
}

async function reloadGrid() {
  if (!campusId.value || !termId.value) return
  gridLoading.value = true
  try {
    if (viewTab.value === 'personal') {
      grid.value = await fetchPersonalTimetable({
        campus_id: campusId.value,
        term_id: termId.value,
        week_number: weekNumber.value,
      })
    } else {
      if (!selectedClassId.value) {
        grid.value = null
        return
      }
      grid.value = await fetchClassTimetable({
        campus_id: campusId.value,
        term_id: termId.value,
        week_number: weekNumber.value,
        class_id: selectedClassId.value,
      })
    }
  } finally {
    gridLoading.value = false
  }
}

onMounted(async () => {
  await loadMeta()
  await loadClassTree()
  await reloadGrid()
})
</script>

<style scoped>
.mtp {
  padding: 16px 20px 24px;
  min-height: 480px;
}
.mtp-hd {
  margin-bottom: 14px;
}
.mtp-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.mtp-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}
.mtp-tabs {
  margin-bottom: 12px;
}
.mtp-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.mtp-body {
  display: flex;
  align-items: stretch;
  gap: 0;
  min-height: 400px;
}
.mtp-body--class .mtp-scroll {
  flex: 1;
  min-width: 0;
}
.mtp-aside {
  width: 220px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 10px;
  margin-right: 12px;
  background: #fafafa;
}
.mtp-search {
  margin-bottom: 10px;
}
.mtp-tree {
  background: transparent;
  max-height: 520px;
  overflow: auto;
}
.mtp-scroll {
  overflow: auto;
  flex: 1;
}
.mtp-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
  border: 1px solid #ebeef5;
}
.mtp-table th,
.mtp-table td {
  border: 1px solid #e4e7ed;
  vertical-align: middle;
  text-align: center;
}
.mtp-th-period {
  width: 100px;
  background: #f5f7fa;
  padding: 10px 6px;
  font-weight: 600;
  color: #606266;
}
.mtp-th-day {
  background: #f5f7fa;
  padding: 10px 4px;
  font-weight: 600;
  color: #606266;
}
.mtp-th-day--today {
  background: #ecf5ff;
  color: var(--el-color-primary);
  box-shadow: inset 0 -2px 0 var(--el-color-primary);
}
.mtp-td-period {
  background: #fafafa;
  padding: 8px 6px;
  text-align: center;
}
.mtp-pname {
  font-weight: 600;
  color: #303133;
}
.mtp-ptime {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.mtp-ptime--muted {
  color: #c0c4cc;
}
.mtp-td-cell {
  padding: 6px 4px;
  min-height: 72px;
  min-width: 96px;
  background: #fff;
}
.mtp-td-cell--today {
  box-shadow: inset 3px 0 0 var(--el-color-primary);
  background: #fafcff;
}
.mtp-card {
  border-radius: 6px;
  padding: 8px 6px;
  text-align: center;
  line-height: 1.35;
  border: 1px solid rgba(0, 0, 0, 0.04);
}
.mtp-card-line {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mtp-card-class {
  font-weight: 600;
  color: #303133;
}
.mtp-card-subj {
  color: #606266;
  margin-top: 2px;
}
.mtp-card-loc {
  color: #909399;
  font-size: 11px;
  margin-top: 2px;
}
.mtp-subject {
  border-radius: 6px;
  padding: 10px 6px;
  font-size: 12px;
  font-weight: 500;
  color: #303133;
  line-height: 1.4;
  border: 1px solid rgba(0, 0, 0, 0.04);
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.mtp-meeting {
  font-size: 13px;
  color: #606266;
  padding: 12px 4px;
}
</style>
