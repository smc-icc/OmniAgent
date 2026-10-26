<template>
  <div class="st-root">
    <header class="st-hd">
      <h2 class="st-title">作息时间</h2>
      <el-button type="primary" @click="openSettings">
        <el-icon class="st-ic"><Setting /></el-icon>
        节次设置
      </el-button>
    </header>

    <div class="st-row">
      <span class="st-label">选择校区：</span>
      <el-select v-model="campusId" style="width: 280px" @change="onCampusChange">
        <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
    </div>

    <div class="st-row st-row-tabs">
      <span class="st-label">年级作息：</span>
      <div class="st-tab-list">
        <div
          v-for="g in groups"
          :key="g.id"
          class="st-tab"
          :class="{ 'st-tab--active': activeGroupId === g.id }"
          @click="selectGroup(g.id)"
        >
          <span>{{ g.name }}</span>
          <el-icon class="st-tab-close" @click.stop="confirmRemoveGroup(g)"><Close /></el-icon>
        </div>
        <el-button class="st-tab-add" circle size="small" @click="newGroupVisible = true">
          <el-icon><Plus /></el-icon>
        </el-button>
      </div>
    </div>

    <div class="st-row">
      <span class="st-label">上课年级：</span>
      <div class="st-grade-box">
        <el-checkbox-group v-model="gradeChecked" @change="onGradesChange">
          <el-checkbox v-for="gr in meta?.grades ?? []" :key="gr.id" :value="gr.id">
            {{ gr.label }}
          </el-checkbox>
        </el-checkbox-group>
      </div>
    </div>

    <div class="st-section-hd">
      <span class="st-section-title">节次时间</span>
      <el-button type="primary" size="small" @click="openAddPeriod">添加节次时间</el-button>
    </div>

    <el-table
      :data="periodRows"
      border
      size="small"
      class="st-table"
      :span-method="spanMethod"
    >
      <el-table-column prop="slot_label" label="时段" width="88" />
      <el-table-column label="节次名称" min-width="120">
        <template #default="{ row }">
          {{ row.period_name_display }}
        </template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="88" />
      <el-table-column prop="days_display" label="日期" min-width="200" show-overflow-tooltip />
      <el-table-column label="起止时间" width="160">
        <template #default="{ row }">{{ row.start }} ~ {{ row.end }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEditPeriod(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="confirmDeletePeriod(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增年级作息 -->
    <el-dialog v-model="newGroupVisible" title="新增年级作息" width="420px" destroy-on-close @close="newGroupName = ''">
      <el-form label-position="top">
        <el-form-item label="作息名称" required>
          <el-input v-model="newGroupName" placeholder="请输入作息名称" maxlength="20" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="newGroupVisible = false">取消</el-button>
        <el-button type="primary" :loading="newGroupSaving" @click="submitNewGroup">确定</el-button>
      </template>
    </el-dialog>

    <!-- 新增/修改节次 -->
    <el-dialog
      v-model="periodDialogVisible"
      :title="periodDialogMode === 'add' ? '新增节次' : '修改节次'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="periodFormRef" :model="periodForm" :rules="periodRules" label-width="100px">
        <el-form-item label="节次名称" prop="period_name" required>
          <el-select v-model="periodForm.period_name" placeholder="请选择节次" filterable style="width: 100%">
            <el-option v-for="n in periodNameOptions" :key="n" :label="n" :value="n" />
          </el-select>
        </el-form-item>
        <el-form-item label="选择时间" required>
          <div class="st-time-row">
            <el-time-select
              v-model="periodForm.start"
              start="06:00"
              step="00:05"
              end="22:00"
              placeholder="开始时间"
              style="width: 130px"
            />
            <span class="st-time-sep">~</span>
            <el-time-select
              v-model="periodForm.end"
              start="06:00"
              step="00:05"
              end="22:30"
              placeholder="结束时间"
              style="width: 130px"
            />
          </div>
        </el-form-item>
        <el-form-item label="选择日期" prop="days" required>
          <div class="st-days-box">
            <el-checkbox v-model="allDaysChecked" :indeterminate="daysIndeterminate" @change="onToggleAllDays">
              全选
            </el-checkbox>
            <el-checkbox-group v-model="periodForm.days" class="st-days-group" @change="syncAllDaysState">
              <el-checkbox v-for="w in meta?.weekdays ?? []" :key="w.value" :value="w.value">
                {{ w.label }}
              </el-checkbox>
            </el-checkbox-group>
          </div>
        </el-form-item>
        <el-form-item v-if="periodDialogMode === 'add'" label="时段">
          <el-radio-group v-model="periodForm.slot">
            <el-radio value="morning">上午</el-radio>
            <el-radio value="afternoon">下午</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="periodDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="periodSaving" @click="submitPeriod">确定</el-button>
      </template>
    </el-dialog>

    <!-- 节次设置 -->
    <el-dialog v-model="settingsVisible" title="节次设置" width="720px" destroy-on-close @opened="loadSettingsRows">
      <el-table :data="templateEditRows" border size="small" max-height="360">
        <el-table-column label="节次名称" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.name" maxlength="10" show-word-limit placeholder="不超过10字" />
          </template>
        </el-table-column>
        <el-table-column label="时段" width="120">
          <template #default="{ row }">
            <el-select v-model="row.slot" style="width: 100%">
              <el-option label="上午" value="morning" />
              <el-option label="下午" value="afternoon" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            <el-select v-model="row.type" style="width: 100%">
              <el-option v-for="t in meta?.period_types ?? []" :key="t" :label="t" :value="t" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ $index }">
            <el-button link type="danger" size="small" @click="templateEditRows.splice($index, 1)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="st-settings-tip">新增节次时节次名称不要超过10个字符</div>
      <el-button class="st-settings-add" @click="addTemplateRow">新增节次</el-button>
      <template #footer>
        <el-button @click="settingsVisible = false">取消</el-button>
        <el-button type="primary" :loading="settingsSaving" @click="saveTemplates">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Close, Plus, Setting } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  deleteScheduleGroup,
  deleteSchedulePeriod,
  fetchScheduleGroups,
  fetchScheduleMeta,
  fetchSchedulePeriods,
  fetchScheduleTemplates,
  patchScheduleGroup,
  patchSchedulePeriod,
  postScheduleGroup,
  postSchedulePeriod,
  putScheduleTemplates,
  type ScheduleGroup,
  type ScheduleMeta,
  type SchedulePeriod,
  type ScheduleTemplate,
} from '@/api/scheduleTime'

const meta = ref<ScheduleMeta | null>(null)
const campusId = ref('')
const groups = ref<ScheduleGroup[]>([])
const activeGroupId = ref('')
const periodRows = ref<SchedulePeriod[]>([])
const gradeChecked = ref<string[]>([])
const templatesCache = ref<ScheduleTemplate[]>([])

const newGroupVisible = ref(false)
const newGroupName = ref('')
const newGroupSaving = ref(false)

const periodDialogVisible = ref(false)
const periodDialogMode = ref<'add' | 'edit'>('add')
const editingPeriodId = ref<string | null>(null)
const periodFormRef = ref<FormInstance>()
const periodSaving = ref(false)
const periodForm = ref({
  period_name: '',
  start: '',
  end: '',
  days: [] as number[],
  slot: 'morning' as string,
})
const allDaysChecked = ref(false)
const daysIndeterminate = ref(false)

const periodRules: FormRules = {
  period_name: [{ required: true, message: '请选择节次', trigger: 'change' }],
  days: [{ type: 'array', required: true, message: '请选择日期', trigger: 'change' }],
}

const periodNameOptions = computed(() => {
  const names = [...new Set(templatesCache.value.map((t) => t.name))]
  return names.sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

const settingsVisible = ref(false)
const templateEditRows = ref<
  { id?: string; name: string; slot: string; type: string; sort: number }[]
>([])
const settingsSaving = ref(false)

function spanMethod({
  rowIndex,
  columnIndex,
}: {
  row: SchedulePeriod
  column: unknown
  rowIndex: number
  columnIndex: number
}) {
  if (columnIndex !== 0) return { rowspan: 1, colspan: 1 }
  const list = periodRows.value
  if (!list.length) return { rowspan: 1, colspan: 1 }
  const cur = list[rowIndex]?.slot
  if (rowIndex > 0 && list[rowIndex - 1]?.slot === cur) {
    return { rowspan: 0, colspan: 0 }
  }
  let span = 1
  for (let j = rowIndex + 1; j < list.length; j++) {
    if (list[j]?.slot === cur) span++
    else break
  }
  return { rowspan: span, colspan: 1 }
}

async function loadMeta() {
  meta.value = await fetchScheduleMeta()
  if (!campusId.value && meta.value.campuses.length) {
    campusId.value = meta.value.campuses[0]!.id
  }
}

async function loadGroups() {
  if (!campusId.value) return
  groups.value = await fetchScheduleGroups(campusId.value)
  if (!groups.value.length) {
    activeGroupId.value = ''
    periodRows.value = []
    gradeChecked.value = []
    return
  }
  if (!activeGroupId.value || !groups.value.some((g) => g.id === activeGroupId.value)) {
    activeGroupId.value = groups.value[0]!.id
  }
  await loadPeriodsAndGrades()
}

async function loadPeriodsAndGrades() {
  if (!activeGroupId.value) return
  const [plist, tlist] = await Promise.all([
    fetchSchedulePeriods(activeGroupId.value),
    fetchScheduleTemplates().catch(() => [] as ScheduleTemplate[]),
  ])
  periodRows.value = plist
  templatesCache.value = tlist
  const g = groups.value.find((x) => x.id === activeGroupId.value)
  gradeChecked.value = g ? [...g.grade_ids] : []
}

async function onCampusChange() {
  activeGroupId.value = ''
  await loadGroups()
}

function selectGroup(id: string) {
  activeGroupId.value = id
  loadPeriodsAndGrades()
}

let gradeSaveTimer: ReturnType<typeof setTimeout> | null = null
function onGradesChange() {
  if (!activeGroupId.value) return
  if (gradeSaveTimer) clearTimeout(gradeSaveTimer)
  gradeSaveTimer = setTimeout(async () => {
    try {
      await patchScheduleGroup(activeGroupId.value!, { grade_ids: [...gradeChecked.value] })
      const g = groups.value.find((x) => x.id === activeGroupId.value)
      if (g) g.grade_ids = [...gradeChecked.value]
      ElMessage.success('已保存上课年级')
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '保存失败')
      await loadGroups()
    }
  }, 400)
}

async function confirmRemoveGroup(g: ScheduleGroup) {
  try {
    await ElMessageBox.confirm(`确定删除年级作息「${g.name}」？其下节次将一并删除。`, '删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteScheduleGroup(g.id)
    ElMessage.success('已删除')
    if (activeGroupId.value === g.id) activeGroupId.value = ''
    await loadGroups()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

async function submitNewGroup() {
  if (!newGroupName.value.trim()) {
    ElMessage.warning('请输入作息名称')
    return
  }
  newGroupSaving.value = true
  try {
    const g = await postScheduleGroup(campusId.value, newGroupName.value.trim())
    ElMessage.success('已新增')
    newGroupVisible.value = false
    newGroupName.value = ''
    await loadGroups()
    activeGroupId.value = g.id
    await loadPeriodsAndGrades()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  } finally {
    newGroupSaving.value = false
  }
}

function syncAllDaysState() {
  const n = periodForm.value.days.length
  allDaysChecked.value = n === 7
  daysIndeterminate.value = n > 0 && n < 7
}

function onToggleAllDays(val: boolean | string | number) {
  const on = Boolean(val)
  periodForm.value.days = on ? [1, 2, 3, 4, 5, 6, 7] : []
  daysIndeterminate.value = false
}

function openAddPeriod() {
  if (!activeGroupId.value) {
    ElMessage.warning('请先选择年级作息')
    return
  }
  periodDialogMode.value = 'add'
  editingPeriodId.value = null
  periodForm.value = {
    period_name: '',
    start: '',
    end: '',
    days: [1, 2, 3, 4, 5],
    slot: 'morning',
  }
  allDaysChecked.value = false
  daysIndeterminate.value = true
  periodDialogVisible.value = true
}

function openEditPeriod(row: SchedulePeriod) {
  periodDialogMode.value = 'edit'
  editingPeriodId.value = row.id
  periodForm.value = {
    period_name: row.period_name,
    start: row.start,
    end: row.end,
    days: [...row.days],
    slot: row.slot,
  }
  syncAllDaysState()
  periodDialogVisible.value = true
}

async function submitPeriod() {
  if (!periodFormRef.value) return
  try {
    await periodFormRef.value.validate()
  } catch {
    return
  }
  if (!periodForm.value.start || !periodForm.value.end) {
    ElMessage.warning('请选择起止时间')
    return
  }
  if (!periodForm.value.days.length) {
    ElMessage.warning('请选择日期')
    return
  }
  periodSaving.value = true
  try {
    if (periodDialogMode.value === 'add' && activeGroupId.value) {
      await postSchedulePeriod({
        group_id: activeGroupId.value,
        period_name: periodForm.value.period_name,
        type: '上课',
        days: [...periodForm.value.days].sort((a, b) => a - b),
        start: periodForm.value.start,
        end: periodForm.value.end,
        slot: periodForm.value.slot,
      })
      ElMessage.success('已添加')
    } else if (editingPeriodId.value) {
      await patchSchedulePeriod(editingPeriodId.value, {
        period_name: periodForm.value.period_name,
        days: [...periodForm.value.days].sort((a, b) => a - b),
        start: periodForm.value.start,
        end: periodForm.value.end,
        slot: periodForm.value.slot,
      })
      ElMessage.success('已保存')
    }
    periodDialogVisible.value = false
    await loadPeriodsAndGrades()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  } finally {
    periodSaving.value = false
  }
}

async function confirmDeletePeriod(row: SchedulePeriod) {
  try {
    await ElMessageBox.confirm('确定删除该节次？', '删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteSchedulePeriod(row.id)
    ElMessage.success('已删除')
    await loadPeriodsAndGrades()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

async function openSettings() {
  settingsVisible.value = true
}

async function loadSettingsRows() {
  const items = await fetchScheduleTemplates()
  templateEditRows.value = items.map((t, i) => ({
    id: t.id,
    name: t.name,
    slot: t.slot,
    type: t.type,
    sort: t.sort ?? i,
  }))
}

function addTemplateRow() {
  templateEditRows.value.push({
    name: '',
    slot: 'morning',
    type: '上课',
    sort: templateEditRows.value.length,
  })
}

async function saveTemplates() {
  for (const r of templateEditRows.value) {
    if (r.name.length > 10) {
      ElMessage.warning('节次名称不要超过10个字符')
      return
    }
    if (!r.name.trim()) {
      ElMessage.warning('请填写节次名称或删除空行')
      return
    }
  }
  settingsSaving.value = true
  try {
    const items = templateEditRows.value.map((r, i) => ({
      id: r.id,
      name: r.name.trim(),
      slot: r.slot,
      type: r.type,
      sort: i,
    }))
    await putScheduleTemplates(items)
    ElMessage.success('已保存节次设置')
    settingsVisible.value = false
    templatesCache.value = await fetchScheduleTemplates()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  } finally {
    settingsSaving.value = false
  }
}

watch(periodDialogVisible, (v) => {
  if (v && periodDialogMode.value === 'add') syncAllDaysState()
})

onMounted(async () => {
  await loadMeta()
  await loadGroups()
})
</script>

<style scoped>
.st-root {
  padding: 16px 20px 24px;
  min-height: 520px;
}
.st-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.st-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.st-ic {
  margin-right: 4px;
  vertical-align: middle;
}
.st-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 14px;
  flex-wrap: wrap;
  gap: 8px;
}
.st-row-tabs {
  align-items: center;
}
.st-label {
  flex-shrink: 0;
  width: 96px;
  font-size: 14px;
  color: #606266;
  line-height: 32px;
}
.st-tab-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.st-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
}
.st-tab--active {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.st-tab-close {
  font-size: 14px;
  opacity: 0.7;
}
.st-tab-close:hover {
  opacity: 1;
  color: var(--el-color-danger);
}
.st-tab-add {
  flex-shrink: 0;
}
.st-grade-box {
  flex: 1;
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 10px 14px;
  background: #fafafa;
}
.st-grade-box :deep(.el-checkbox) {
  margin-right: 16px;
}
.st-section-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 0 10px;
}
.st-section-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.st-table {
  width: 100%;
}
.st-table :deep(.el-table__header th) {
  background: #f5f7fa !important;
}
.st-time-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.st-time-sep {
  color: #909399;
}
.st-days-box {
  width: 100%;
}
.st-days-group {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.st-settings-tip {
  margin: 12px 0 8px;
  padding: 8px 12px;
  background: #fdf6ec;
  border-radius: 4px;
  font-size: 12px;
  color: #e6a23c;
}
.st-settings-add {
  margin-top: 4px;
}
</style>
