<template>
  <div class="isp" :class="{ 'isp--wizard': wizardOpen }">
    <template v-if="!wizardOpen">
    <div class="isp-hd">
      <div class="isp-crumb">
        <span>智能排课</span>
        <span class="isp-crumb-div">/</span>
        <span>排课列表</span>
        <span class="isp-crumb-div">/</span>
        <span>排课安排</span>
      </div>
      <div class="isp-actions">
        <el-button type="primary" @click="openCreateDrawer">
          <el-icon class="isp-mi"><Plus /></el-icon>
          新建排课任务
        </el-button>
        <el-button type="primary" :disabled="selection.length !== 1" @click="openEditDrawer">修改排课任务</el-button>
        <el-button :disabled="selection.length === 0" @click="onDelete">删除排课任务</el-button>
      </div>
    </div>

    <div class="isp-filter">
      <el-select v-model="campusId" style="width: 280px" placeholder="请选择校区" @change="loadList">
        <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-button type="primary" @click="loadList">查询</el-button>
    </div>

    <div v-loading="loading" class="isp-groups">
      <el-table
        v-if="flatRows.length"
        ref="tableRef"
        :data="flatRows"
        row-key="id"
        border
        size="small"
        class="isp-table"
        :span-method="spanMethod"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="48" :reserve-selection="true" />
        <el-table-column prop="group_name" label="" width="200" class-name="isp-col-group">
          <template #default="{ row }">
            <div v-if="row._groupHead" class="isp-group-cell">
              <span class="isp-group-bar" />
              <span>{{ row.group_name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="排课任务名称" min-width="200">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditByRow(row)">{{ row.name }}</el-button>
          </template>
        </el-table-column>
        <el-table-column prop="campus_name" label="校区" min-width="180" />
        <el-table-column label="年级" min-width="200">
          <template #default="{ row }">{{ row.grades.join('、') }}</template>
        </el-table-column>
        <el-table-column label="起止时间" min-width="220">
          <template #default="{ row }">{{ formatRangeCn(row.date_start, row.date_end) }}</template>
        </el-table-column>
        <el-table-column prop="schedule_type_label" label="排课类型" width="120" />
        <el-table-column label="排课状态" width="160">
          <template #default="{ row }">
            <span :class="statusClass(row.status_code)">{{ row.status_label }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="last_applied_label" label="应用记录" width="130" />
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="runTask(row)">排课</el-button>
            <el-button link type="primary" @click="viewResult(row)">查看结果</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!loading" description="暂无排课任务" />
    </div>
    </template>

    <IntelligentSchedulingWizard
      v-else
      v-model="wizardOpen"
      :task-id="wizardTaskId"
      @done="loadList"
    />

    <el-drawer v-model="drawerVisible" :title="drawerTitle" size="480px" destroy-on-close @closed="resetDrawer">
      <el-form label-position="top" class="isp-form">
        <el-form-item label="校区">
          <el-radio-group v-model="form.campus_id" :disabled="drawerMode === 'edit'">
            <el-radio v-for="c in meta?.campuses ?? []" :key="c.id" :value="c.id">{{ c.name }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="学年学期">
          <el-input :model-value="semesterReadonlyText" readonly />
        </el-form-item>
        <el-form-item label="任务名称" required>
          <el-input v-model="form.name" placeholder="请输入任务名称" maxlength="60" show-word-limit />
        </el-form-item>
        <el-form-item label="排课起止日期" required>
          <el-date-picker
            v-model="formDateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="课表类型">
          <el-radio-group v-model="form.schedule_type">
            <el-radio value="admin">行政班排课</el-radio>
            <el-radio value="rolling">走班排课</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="drawerMode === 'create'" label="排课任务">
          <el-radio-group v-model="form.task_source">
            <el-radio value="new">新建排课</el-radio>
            <el-radio value="reuse">复用任务</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="选择年级">
          <div class="isp-grade-all">
            <el-checkbox v-model="gradeAll" :indeterminate="gradeInd" @change="onGradeAllChange">全选</el-checkbox>
          </div>
          <el-checkbox-group v-model="form.grades" class="isp-grade-grid">
            <el-checkbox v-for="g in gradeLabels" :key="g" :value="g">{{ g }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="drawerSaving" @click="submitDrawer">确定</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import {
  deleteIntelligentSchedulingTasks,
  fetchIntelligentSchedulingMeta,
  fetchIntelligentSchedulingTaskDetail,
  fetchIntelligentSchedulingTasks,
  postIntelligentSchedulingTask,
  putIntelligentSchedulingTask,
  type IntelligentSchedulingGroup,
} from '@/api/intelligentScheduling'
import IntelligentSchedulingWizard from './IntelligentSchedulingWizard.vue'

type RowItem = IntelligentSchedulingGroup['items'][number]
type FlatRow = RowItem & { group_name: string; _groupHead?: boolean; _groupRows?: number }

const meta = ref<Awaited<ReturnType<typeof fetchIntelligentSchedulingMeta>> | null>(null)
const tableRef = ref<{ clearSelection: () => void } | null>(null)
const campusId = ref('')
const loading = ref(false)
const groups = ref<IntelligentSchedulingGroup[]>([])
const selection = ref<RowItem[]>([])

const flatRows = computed<FlatRow[]>(() => {
  const out: FlatRow[] = []
  for (const g of groups.value) {
    g.items.forEach((it, idx) => {
      out.push({
        ...it,
        group_name: g.group_name,
        _groupHead: idx === 0,
        _groupRows: g.items.length,
      })
    })
  }
  return out
})

function spanMethod({ row, columnIndex }: { row: FlatRow; rowIndex: number; columnIndex: number }) {
  if (columnIndex === 1) {
    if (row._groupHead) {
      return { rowspan: row._groupRows ?? 1, colspan: 1 }
    }
    return { rowspan: 0, colspan: 0 }
  }
  return { rowspan: 1, colspan: 1 }
}

const drawerVisible = ref(false)
const drawerMode = ref<'create' | 'edit'>('create')
const drawerSaving = ref(false)
const editingId = ref('')

const wizardOpen = ref(false)
const wizardTaskId = ref('')

const form = ref({
  campus_id: '',
  semester_id: '',
  name: '',
  date_start: '',
  date_end: '',
  schedule_type: 'admin' as 'admin' | 'rolling',
  task_source: 'new' as 'new' | 'reuse',
  grades: [] as string[],
})

const gradeLabels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级']
const gradeAll = ref(false)
const gradeInd = ref(false)

const drawerTitle = computed(() => (drawerMode.value === 'create' ? '新建排课任务' : '修改排课任务'))

const semesterReadonlyText = computed(() => {
  const s = meta.value?.semesters.find((x) => x.id === form.value.semester_id)
  return s?.label_detail ?? '—'
})

const formDateRange = computed({
  get: (): [string, string] | null => {
    if (form.value.date_start && form.value.date_end) {
      return [form.value.date_start, form.value.date_end]
    }
    return null
  },
  set: (v: [string, string] | null) => {
    if (v && v.length === 2) {
      form.value.date_start = v[0]
      form.value.date_end = v[1]
    } else {
      form.value.date_start = ''
      form.value.date_end = ''
    }
  },
})

watch(
  () => [...form.value.grades],
  (g) => {
    const n = gradeLabels.length
    gradeAll.value = g.length === n && n > 0
    gradeInd.value = g.length > 0 && g.length < n
  },
)

function onGradeAllChange(val: boolean | string | number | undefined) {
  const on = val === true
  form.value.grades = on ? [...gradeLabels] : []
}

function statusClass(code: string) {
  if (code === 'applied') return 'isp-st-applied'
  if (code === 'pending_application') return 'isp-st-pending'
  return 'isp-st-muted'
}

function formatRangeCn(start: string, end: string) {
  const f = (s: string) => {
    const [y, m, d] = s.split('-')
    return `${y}年${m}月${d}日`
  }
  return `${f(start)} ~ ${f(end)}`
}

function onSelectionChange(rows: RowItem[]) {
  selection.value = rows
}

async function loadList() {
  if (!campusId.value) return
  loading.value = true
  try {
    const data = await fetchIntelligentSchedulingTasks(campusId.value)
    groups.value = data.groups
    selection.value = []
    tableRef.value?.clearSelection()
  } finally {
    loading.value = false
  }
}

function resetDrawer() {
  editingId.value = ''
  form.value = {
    campus_id: campusId.value,
    semester_id: meta.value?.semesters.find((s) => s.is_current)?.id ?? meta.value?.semesters[0]?.id ?? '',
    name: '',
    date_start: '',
    date_end: '',
    schedule_type: 'admin',
    task_source: 'new',
    grades: [],
  }
  const cur = meta.value?.semesters.find((s) => s.id === form.value.semester_id)
  if (cur) {
    form.value.date_start = cur.date_start
    form.value.date_end = cur.date_end
  }
  gradeAll.value = false
  gradeInd.value = false
}

function openCreateDrawer() {
  drawerMode.value = 'create'
  resetDrawer()
  drawerVisible.value = true
}

async function openEditDrawer() {
  const row = selection.value[0]
  if (!row) return
  await openEditByRow(row)
}

async function openEditByRow(row: RowItem) {
  drawerMode.value = 'edit'
  editingId.value = row.id
  drawerVisible.value = true
  const d = await fetchIntelligentSchedulingTaskDetail(row.id)
  form.value = {
    campus_id: d.campus_id,
    semester_id: d.semester_id,
    name: d.name,
    date_start: d.date_start,
    date_end: d.date_end,
    schedule_type: d.schedule_type,
    task_source: d.task_source,
    grades: [...d.grades],
  }
}

async function submitDrawer() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入任务名称')
    return
  }
  if (!form.value.date_start || !form.value.date_end) {
    ElMessage.warning('请选择排课起止日期')
    return
  }
  if (!form.value.grades.length) {
    ElMessage.warning('请选择年级')
    return
  }
  drawerSaving.value = true
  try {
    if (drawerMode.value === 'create') {
      await postIntelligentSchedulingTask({
        campus_id: form.value.campus_id,
        semester_id: form.value.semester_id,
        name: form.value.name.trim(),
        date_start: form.value.date_start,
        date_end: form.value.date_end,
        schedule_type: form.value.schedule_type,
        task_source: form.value.task_source,
        grades: form.value.grades,
      })
      ElMessage.success('已创建')
    } else {
      await putIntelligentSchedulingTask(editingId.value, {
        name: form.value.name.trim(),
        date_start: form.value.date_start,
        date_end: form.value.date_end,
        schedule_type: form.value.schedule_type,
        grades: form.value.grades,
      })
      ElMessage.success('已保存')
    }
    drawerVisible.value = false
    await loadList()
  } finally {
    drawerSaving.value = false
  }
}

async function onDelete() {
  const ids = selection.value.map((r) => r.id)
  if (!ids.length) return
  await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 个排课任务？`, '提示', { type: 'warning' })
  await deleteIntelligentSchedulingTasks(ids)
  ElMessage.success('已删除')
  await loadList()
}

function runTask(row: RowItem) {
  wizardTaskId.value = row.id
  wizardOpen.value = true
}

function viewResult(row: RowItem) {
  ElMessage.info(`「${row.name}」排课结果查看为演示占位，可后续对接课表矩阵页`)
}

onMounted(async () => {
  meta.value = await fetchIntelligentSchedulingMeta()
  campusId.value = meta.value.campuses[0]?.id ?? ''
  await loadList()
})
</script>

<style scoped>
.isp {
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  min-height: 400px;
}
.isp--wizard {
  min-height: calc(100vh - 220px);
  padding-bottom: 16px;
}
.isp-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.isp-crumb {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.isp-crumb-div {
  margin: 0 6px;
  color: var(--el-border-color-darker);
}
.isp-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.isp-mi {
  margin-right: 4px;
  vertical-align: middle;
}
.isp-filter {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.isp-groups {
  min-height: 200px;
}
.isp-group-bar {
  width: 4px;
  height: 18px;
  background: var(--el-color-primary);
  border-radius: 2px;
  flex-shrink: 0;
}
.isp-group-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--el-text-color-primary);
  min-height: 40px;
}
.isp-table {
  margin-bottom: 8px;
}
.isp :deep(.isp-col-group .cell) {
  display: flex;
  align-items: center;
}
.isp-st-applied {
  color: var(--el-color-success);
  font-weight: 500;
}
.isp-st-pending {
  color: #6f3ccd;
  font-weight: 500;
}
.isp-st-muted {
  color: var(--el-text-color-secondary);
}
.isp-form {
  padding-right: 8px;
}
.isp-grade-all {
  margin-bottom: 8px;
}
.isp-grade-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
</style>
