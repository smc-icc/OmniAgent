<template>
  <div class="sdp">
    <header class="sdp-hd">
      <h2 class="sdp-title">日程管理</h2>
      <div class="sdp-toolbar">
        <el-select v-model="campusId" class="sdp-sel" @change="onCampusChange">
          <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="weekNumber" class="sdp-sel sdp-sel-week" @change="loadGrid">
          <el-option v-for="w in meta?.weeks ?? []" :key="w.week_number" :label="w.label" :value="w.week_number" />
        </el-select>
        <div class="sdp-actions">
          <el-button type="primary" @click="openDrawer">新建日程</el-button>
          <el-button @click="openBatchDelete">批量删除</el-button>
        </div>
      </div>
    </header>

    <div class="sdp-split">
      <aside class="sdp-aside">
        <div class="sdp-aside-title">选择教师查看忙闲</div>
        <el-input
          v-model="treeFilter"
          clearable
          placeholder="搜索教师名称"
          class="sdp-search"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-tree
          ref="treeRef"
          :data="teacherTree"
          :props="{ label: 'label', children: 'children' }"
          node-key="id"
          show-checkbox
          default-expand-all
          :filter-node-method="filterNode"
          class="sdp-tree"
          @check="onTreeCheck"
        />
      </aside>

      <div v-loading="gridLoading" class="sdp-main">
        <table v-if="grid" class="sdp-tb">
          <thead>
            <tr>
              <th class="sdp-th-p">节次</th>
              <th
                v-for="d in grid.days"
                :key="d.iso"
                class="sdp-th-d"
                :class="{ 'sdp-th-d--today': isTodayIso(d.iso) }"
              >
                {{ d.label }}({{ d.date_md }})
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, pi) in grid.periods" :key="p.id">
              <td class="sdp-td-p">
                <div>{{ p.name }}</div>
                <div v-if="p.start" class="sdp-td-pt">{{ p.start }}-{{ p.end }}</div>
              </td>
              <template v-for="item in displayCells(pi)">
                <td
                  v-if="item.c.render"
                  :key="`${p.id}-${item.d.iso}`"
                  class="sdp-td-c"
                  :class="{ 'sdp-td-c--today': isTodayIso(item.d.iso) }"
                  :rowspan="item.c.rowspan"
                >
                  <template v-if="item.c.kind === 'block' && item.c.block">
                    <div class="sdp-block">
                      <span class="sdp-dot" />
                      <span class="sdp-block-txt">{{ item.c.block.title }}({{ item.c.block.count }})</span>
                    </div>
                  </template>
                  <span v-else class="sdp-free">空闲</span>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <el-drawer v-model="drawerVisible" title="新增日程" size="420px" destroy-on-close @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="formRules" label-position="top" class="sdp-form">
        <el-form-item label="选择校区">
          <el-input :model-value="campusName" readonly />
        </el-form-item>
        <el-form-item label="日程标题" prop="title" required>
          <el-input v-model="form.title" maxlength="10" show-word-limit placeholder="请输入标题" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            maxlength="50"
            show-word-limit
            placeholder="选填"
          />
        </el-form-item>
        <el-form-item label="地点">
          <el-input v-model="form.location" maxlength="10" show-word-limit placeholder="选填" />
        </el-form-item>
        <el-form-item label="星期" prop="day" required>
          <el-select v-model="form.day" placeholder="请选择" style="width: 100%">
            <el-option v-for="o in weekdayOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="开始节次" prop="period_start" required>
          <el-select v-model="form.period_start" placeholder="请选择" style="width: 100%">
            <el-option v-for="p in meta?.period_options ?? []" :key="p.id" :label="p.label" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="结束节次" prop="period_end" required>
          <el-select v-model="form.period_end" placeholder="请选择" style="width: 100%">
            <el-option v-for="p in meta?.period_options ?? []" :key="p.id" :label="p.label" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="重复" prop="repeat" required>
          <el-select v-model="form.repeat" style="width: 100%">
            <el-option v-for="r in meta?.repeat_options ?? []" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="参与教师（与左侧树勾选一致，可在此再选）">
          <el-select
            v-model="form.teacher_ids"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="请选择教师"
            style="width: 100%"
          >
            <el-option v-for="t in flatTeachers" :key="t.id" :label="t.label" :value="t.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-drawer>

    <el-dialog v-model="batchVisible" title="批量删除日程" width="520px" destroy-on-close @open="loadWeekEvents">
      <el-table
        :data="weekEvents"
        max-height="360"
        @selection-change="onBatchSelection"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="title" label="标题" min-width="120" />
        <el-table-column label="星期" width="72">
          <template #default="{ row }">{{ weekdayLabel(row.day) }}</template>
        </el-table-column>
        <el-table-column label="节次" min-width="140">
          <template #default="{ row }">{{ periodRangeLabel(row.period_start, row.period_end) }}</template>
        </el-table-column>
        <el-table-column prop="count" label="人数" width="64" />
      </el-table>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="danger" :loading="batchDeleting" :disabled="!batchSelected.length" @click="doBatchDelete">
          删除选中
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { ElTree, FormInstance } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  fetchScheduleDiaryMeta,
  fetchScheduleDiaryTeacherTree,
  fetchScheduleDiaryGrid,
  postScheduleDiaryEvent,
  fetchScheduleDiaryEventsForWeek,
  postScheduleDiaryBatchDelete,
  type ScheduleDiaryMeta,
  type ScheduleDiaryGrid,
  type ScheduleDiaryTreeNode,
  type ScheduleDiaryBlock,
  type ScheduleDiaryWeekEventRow,
} from '@/api/scheduleDiary'

const meta = ref<ScheduleDiaryMeta | null>(null)
const campusId = ref('')
const weekNumber = ref(5)
const teacherTree = ref<ScheduleDiaryTreeNode[]>([])
const treeFilter = ref('')
const treeRef = ref<InstanceType<typeof ElTree>>()

const grid = ref<ScheduleDiaryGrid | null>(null)
const gridLoading = ref(false)

const drawerVisible = ref(false)
const formRef = ref<FormInstance>()
const submitting = ref(false)
const form = ref({
  title: '',
  description: '',
  location: '',
  day: 1 as number,
  period_start: '',
  period_end: '',
  repeat: 'none',
  teacher_ids: [] as string[],
})

const weekdayOptions = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

const formRules = {
  title: [{ required: true, message: '请填写日程标题', trigger: 'blur' }],
  day: [{ required: true, message: '请选择星期', trigger: 'change' }],
  period_start: [{ required: true, message: '请选择开始节次', trigger: 'change' }],
  period_end: [{ required: true, message: '请选择结束节次', trigger: 'change' }],
  repeat: [{ required: true, message: '请选择重复方式', trigger: 'change' }],
}

const batchVisible = ref(false)
const weekEvents = ref<ScheduleDiaryWeekEventRow[]>([])
const batchSelected = ref<ScheduleDiaryWeekEventRow[]>([])
const batchDeleting = ref(false)
const campusName = computed(() => meta.value?.campuses.find((c) => c.id === campusId.value)?.name ?? '')

const flatTeachers = computed(() => {
  const out: { id: string; label: string }[] = []
  function walk(nodes: ScheduleDiaryTreeNode[]) {
    for (const n of nodes) {
      if (n.is_teacher && n.id.startsWith('t-')) out.push({ id: n.id, label: n.label })
      if (n.children?.length) walk(n.children)
    }
  }
  walk(teacherTree.value)
  return out
})

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function isTodayIso(iso: string) {
  const t = new Date()
  const local = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`
  return local === iso
}

function periodIndex(periods: { id: string }[], id: string) {
  const i = periods.findIndex((p) => p.id === id)
  return i < 0 ? -1 : i
}

type CellInfo =
  | { render: true; rowspan: number; kind: 'free' }
  | { render: true; rowspan: number; kind: 'block'; block: ScheduleDiaryBlock }
  | { render: false; rowspan: number; kind: 'block'; block: ScheduleDiaryBlock }

function cellAt(pi: number, dow: number): CellInfo {
  const g = grid.value
  if (!g?.periods?.length) return { render: true, rowspan: 1, kind: 'free' }
  const periods = g.periods
  const blocks = g.blocks.filter((b) => b.day === dow)
  let hit: ScheduleDiaryBlock | null = null
  for (const b of blocks) {
    const s = periodIndex(periods, b.period_start)
    const e = periodIndex(periods, b.period_end)
    if (s < 0 || e < 0) continue
    const lo = Math.min(s, e)
    const hi = Math.max(s, e)
    if (pi >= lo && pi <= hi) {
      hit = b
      break
    }
  }
  if (!hit) return { render: true, rowspan: 1, kind: 'free' }
  const s = periodIndex(periods, hit.period_start)
  const e = periodIndex(periods, hit.period_end)
  const lo = Math.min(s, e)
  const hi = Math.max(s, e)
  if (pi === lo) return { render: true, rowspan: hi - lo + 1, kind: 'block', block: hit }
  return { render: false, rowspan: 1, kind: 'block', block: hit }
}

function displayCells(pi: number) {
  const g = grid.value
  if (!g) return []
  return g.days.map((d) => ({ d, c: cellAt(pi, d.dow) }))
}

function filterNode(value: string, data: ScheduleDiaryTreeNode) {
  if (!value) return true
  return data.label.includes(value)
}

watch(treeFilter, (v) => {
  treeRef.value?.filter(v)
})

async function loadMeta() {
  meta.value = await fetchScheduleDiaryMeta()
  if (!campusId.value && meta.value.campuses.length) {
    campusId.value = meta.value.campuses[0].id
  }
  if (meta.value.weeks.length && !meta.value.weeks.some((w) => w.week_number === weekNumber.value)) {
    weekNumber.value = meta.value.weeks[0].week_number
  }
}

async function loadTeacherTree() {
  if (!campusId.value) {
    teacherTree.value = []
    return
  }
  teacherTree.value = await fetchScheduleDiaryTeacherTree(campusId.value)
  await nextTick()
  treeRef.value?.filter(treeFilter.value)
}

function checkedTeacherIds(): string[] {
  const keys = (treeRef.value?.getCheckedKeys(false) as string[]) ?? []
  return keys.filter((k) => typeof k === 'string' && k.startsWith('t-'))
}

function onTreeCheck() {
  loadGrid()
}

async function loadGrid() {
  if (!campusId.value) return
  gridLoading.value = true
  try {
    const ids = checkedTeacherIds()
    grid.value = await fetchScheduleDiaryGrid(campusId.value, weekNumber.value, ids)
  } finally {
    gridLoading.value = false
  }
}

async function onCampusChange() {
  await loadTeacherTree()
  await loadGrid()
}

function openDrawer() {
  const opts = meta.value?.period_options ?? []
  const checked = checkedTeacherIds()
  form.value = {
    title: '',
    description: '',
    location: '',
    day: 1,
    period_start: opts[0]?.id ?? '',
    period_end: opts[0]?.id ?? '',
    repeat: 'none',
    teacher_ids: checked.length ? [...checked] : flatTeachers.value.slice(0, 1).map((t) => t.id),
  }
  drawerVisible.value = true
}

function resetForm() {
  formRef.value?.resetFields()
}

async function submitForm() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  if (!campusId.value) return
  submitting.value = true
  try {
    await postScheduleDiaryEvent({
      campus_id: campusId.value,
      title: form.value.title,
      description: form.value.description,
      location: form.value.location,
      day: form.value.day,
      period_start: form.value.period_start,
      period_end: form.value.period_end,
      repeat: form.value.repeat,
      teacher_ids: form.value.teacher_ids.length ? form.value.teacher_ids : ['t-zxm'],
    })
    ElMessage.success('已新建日程')
    drawerVisible.value = false
    await loadGrid()
  } finally {
    submitting.value = false
  }
}

function weekdayLabel(d: number) {
  return weekdayOptions.find((x) => x.value === d)?.label ?? `周${d}`
}

function periodRangeLabel(start: string, end: string) {
  const opts = meta.value?.period_options ?? []
  const a = opts.find((p) => p.id === start)?.label ?? start
  const b = opts.find((p) => p.id === end)?.label ?? end
  return `${a} ~ ${b}`
}

async function openBatchDelete() {
  batchVisible.value = true
}

async function loadWeekEvents() {
  batchSelected.value = []
  if (!campusId.value) {
    weekEvents.value = []
    return
  }
  weekEvents.value = await fetchScheduleDiaryEventsForWeek(campusId.value, weekNumber.value)
}

function onBatchSelection(rows: ScheduleDiaryWeekEventRow[]) {
  batchSelected.value = rows
}

async function doBatchDelete() {
  const ids = batchSelected.value.map((r) => r.id)
  if (!ids.length) return
  batchDeleting.value = true
  try {
    const r = await postScheduleDiaryBatchDelete(ids)
    ElMessage.success(`已删除 ${r.removed} 条`)
    batchVisible.value = false
    await loadGrid()
  } finally {
    batchDeleting.value = false
  }
}

onMounted(async () => {
  await loadMeta()
  await loadTeacherTree()
  await loadGrid()
})
</script>

<style scoped>
.sdp {
  padding: 16px 20px 24px;
  min-height: 480px;
}
.sdp-hd {
  margin-bottom: 16px;
}
.sdp-title {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 700;
  color: var(--oa-text, #303133);
}
.sdp-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.sdp-sel {
  width: 220px;
}
.sdp-sel-week {
  width: 260px;
}
.sdp-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.sdp-split {
  display: flex;
  align-items: stretch;
  gap: 16px;
  min-height: 420px;
}
.sdp-aside {
  width: 260px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px;
  background: #fafafa;
}
.sdp-aside-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
}
.sdp-search {
  margin-bottom: 10px;
}
.sdp-tree {
  max-height: 520px;
  overflow: auto;
  background: transparent;
  font-size: 13px;
}
.sdp-tree :deep(.el-tree-node__content) {
  height: 32px;
}

.sdp-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.sdp-tb {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}
.sdp-tb th,
.sdp-tb td {
  border: 1px solid #ebeef5;
  padding: 8px 6px;
  vertical-align: middle;
}
.sdp-th-p {
  width: 88px;
  background: #f5f7fa;
  font-weight: 600;
  color: #606266;
}
.sdp-th-d {
  text-align: center;
  background: #f5f7fa;
  font-weight: 600;
  color: #606266;
}
.sdp-th-d--today {
  background: var(--el-color-primary);
  color: #fff;
}
.sdp-td-p {
  background: #fafafa;
  text-align: center;
  color: #606266;
}
.sdp-td-pt {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}
.sdp-td-c {
  min-height: 44px;
  text-align: left;
  background: #fff;
}
.sdp-td-c--today {
  background: var(--el-color-primary-light-9);
  box-shadow: inset 2px 0 0 var(--el-color-primary);
}
.sdp-block {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--el-color-primary);
  line-height: 1.4;
}
.sdp-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  margin-top: 5px;
  flex-shrink: 0;
}
.sdp-block-txt {
  word-break: break-all;
}
.sdp-free {
  color: #909399;
  font-size: 12px;
}

.sdp-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
</style>
