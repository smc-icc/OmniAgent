<template>
  <div class="smg">
    <!-- ========== 列表 ========== -->
    <template v-if="!wizardMode">
      <header class="smg-hd">
        <h2 class="smg-title">课表管理</h2>
        <el-button type="primary" @click="openCreate">导入课表</el-button>
      </header>

      <div class="smg-filter">
        <el-select v-model="listCampusId" placeholder="选择校区" style="width: 280px" clearable>
          <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-button type="primary" @click="loadList">查询</el-button>
      </div>

      <div class="smg-sem">
        <span class="smg-sem-bar" />
        <span class="smg-sem-txt">{{ meta?.semester_label ?? '—' }}</span>
      </div>

      <el-table :data="rows" border stripe size="small" class="smg-table">
        <el-table-column prop="name" label="课表名称" min-width="200" show-overflow-tooltip />
        <el-table-column label="最新应用日期" width="200">
          <template #default="{ row }">{{ row.latest_apply_display || '—' }}</template>
        </el-table-column>
        <el-table-column prop="campus_name" label="课表校区" width="200" show-overflow-tooltip />
        <el-table-column prop="import_method_label" label="导入方式" width="120" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span :class="row.status === 'applied' ? 'smg-st-applied' : 'smg-st-draft'">{{ row.status_label }}</span>
          </template>
        </el-table-column>
        <el-table-column label="课表应用记录" width="120">
          <template #default="{ row }">
            <el-button link type="primary" @click="openRecords(row)">{{ row.application_count }}次</el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="enterWizard(row.id, 2)">查看课表</el-button>
            <el-dropdown trigger="click" @command="(cmd: string) => onRowMore(cmd, row)">
              <el-button link type="primary">更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="edit">修改</el-dropdown-item>
                  <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- ========== 导入向导 ========== -->
    <template v-else>
      <div class="smg-wiz-top">
        <el-button text type="primary" class="smg-back" @click="exitWizard">← 返回列表</el-button>
        <div class="smg-crumb">
          <span>导入课表</span>
          <span class="smg-crumb-div">/</span>
          <span>课表管理</span>
          <span class="smg-crumb-div">/</span>
          <span>{{ wizardCrumbStep }}</span>
        </div>
      </div>
      <el-steps :active="wizardStep - 1" align-center class="smg-steps smg-steps--clickable">
        <el-step class="smg-step-hit" @click="onWizardStepClick(1)">
          <template #title>
            <span
              role="button"
              tabindex="0"
              class="smg-step-title"
              title="点击进入本步"
              @click.stop="onWizardStepClick(1)"
              @keydown.enter.prevent="onWizardStepClick(1)"
            >
              导入课表
            </span>
          </template>
        </el-step>
        <el-step class="smg-step-hit" @click="onWizardStepClick(2)">
          <template #title>
            <span
              role="button"
              tabindex="0"
              class="smg-step-title"
              title="点击进入本步"
              @click.stop="onWizardStepClick(2)"
              @keydown.enter.prevent="onWizardStepClick(2)"
            >
              课表查看
            </span>
          </template>
        </el-step>
        <el-step class="smg-step-hit" @click="onWizardStepClick(3)">
          <template #title>
            <span
              role="button"
              tabindex="0"
              class="smg-step-title"
              title="点击进入本步"
              @click.stop="onWizardStepClick(3)"
              @keydown.enter.prevent="onWizardStepClick(3)"
            >
              课表应用
            </span>
          </template>
        </el-step>
      </el-steps>

      <!-- Step 1 -->
      <div v-show="wizardStep === 1" class="smg-step">
        <div class="smg-block">
          <div class="smg-lbl">导入节次：</div>
          <div class="smg-periods">
            <el-checkbox v-model="periodAll" :indeterminate="periodInd" @change="onPeriodAll">全选</el-checkbox>
            <el-checkbox-group v-model="selectedPeriodIds" class="smg-pgrid" @change="syncPeriodAll">
              <el-checkbox v-for="p in meta?.import_period_options ?? []" :key="p.id" :value="p.id">
                {{ p.label }}
              </el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
        <div class="smg-block">
          <div class="smg-lbl">上传课表：</div>
          <div class="smg-up">
            <el-button @click="dlScheduleTpl">下载课表模板</el-button>
            <el-upload
              :show-file-list="true"
              :limit="1"
              accept=".xls,.xlsx,.csv"
              :http-request="doUploadSchedule"
            >
              <el-button type="primary">上传课表模版</el-button>
            </el-upload>
            <p class="smg-tip">
              请保证班级名称和学生管理中的班级一致，支持 xls/xlsx 文件，不超过 5Mb（演示不校验文件内容）
            </p>
          </div>
        </div>
        <div class="smg-block">
          <div class="smg-lbl">上传任教（可选项）：</div>
          <div class="smg-up">
            <p class="smg-tip smg-tip-bold">
              可导入更新上述课表中的老师数据；增量更新，未导入任教的班级和课程对应上课教师不会被影响
            </p>
            <el-button @click="dlTeachingTpl">下载教师任教模板</el-button>
            <el-upload :show-file-list="true" :limit="1" accept=".xls,.xlsx,.csv" :http-request="doUploadTeaching">
              <el-button>上传任教</el-button>
            </el-upload>
          </div>
        </div>
        <div class="smg-foot">
          <el-button type="primary" @click="goStep2">下一步</el-button>
        </div>
      </div>

      <!-- Step 2 -->
      <div v-show="wizardStep === 2" class="smg-step">
        <div class="smg-s2-head">
          <el-tabs v-model="viewTab" @tab-change="loadGrid">
            <el-tab-pane label="班级课表" name="class" />
            <el-tab-pane label="教师课表" name="teacher" />
          </el-tabs>
          <div class="smg-s2-actions">
            <el-button type="primary" @click="runExport">
              <el-icon><Download /></el-icon>
              导出总课表
            </el-button>
            <el-button @click="runAnomalies">
              <el-icon><Bell /></el-icon>
              课表异常
            </el-button>
            <el-select v-model="gridWeek" style="width: 120px; margin-left: 8px" @change="loadGrid">
              <el-option v-for="w in gridWeekOptions" :key="w" :label="`第${w}周`" :value="w" />
            </el-select>
          </div>
        </div>
        <div class="smg-s2-body">
          <aside v-if="viewTab === 'class'" class="smg-aside">
            <el-radio-group v-model="classTab" size="small" class="smg-class-tab">
              <el-radio-button value="admin">行政班</el-radio-button>
              <el-radio-button value="other">非行政班</el-radio-button>
            </el-radio-group>
            <el-input v-model="classSearch" clearable placeholder="搜索班级名称" class="smg-aside-search" />
            <el-tree
              ref="classTreeRef"
              :data="classTreeData"
              :props="{ label: 'label', children: 'children' }"
              node-key="id"
              highlight-current
              default-expand-all
              :filter-node-method="filterClassNode"
              @node-click="onClassNode"
            />
          </aside>
          <aside v-else class="smg-aside">
            <el-input v-model="teacherSearch" clearable placeholder="搜索教师名称" @input="filterTeachers" />
            <ul class="smg-tlist">
              <li
                v-for="t in teacherListFiltered"
                :key="t.id"
                :class="{ 'smg-tlist--active': t.id === selectedTeacherId }"
                @click="selectTeacher(t.id)"
              >
                {{ t.name }}
              </li>
            </ul>
          </aside>
          <div v-loading="gridLoading" class="smg-grid-wrap">
            <div class="smg-grid-title">{{ gridTitle }}</div>
            <table v-if="classGrid" class="smg-tb">
              <thead>
                <tr>
                  <th class="smg-tb-p">节次</th>
                  <th v-for="d in classGrid.days" :key="d.dow">{{ d.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in classGrid.periods" :key="p.id">
                  <td class="smg-tb-p">
                    <div>{{ p.name }}</div>
                    <div v-if="p.start" class="smg-tb-pt">{{ p.start }}-{{ p.end }}</div>
                  </td>
                  <td v-for="d in classGrid.days" :key="d.dow + p.id" class="smg-tb-c">
                    <div
                      v-if="viewTab === 'class' && classModeCell(d.dow, p.id)"
                      class="smg-cell2"
                      :style="{ background: classModeCell(d.dow, p.id)!.color }"
                    >
                      <div>{{ classModeCell(d.dow, p.id)!.subject }}</div>
                      <div class="smg-cell2-sub">{{ classModeCell(d.dow, p.id)!.teacher }}</div>
                    </div>
                    <div
                      v-else-if="viewTab === 'teacher' && teacherModeCell(d.dow, p.id)"
                      class="smg-cell-t"
                      style="background: #e3f2fd"
                    >
                      <div>{{ teacherModeCell(d.dow, p.id)!.class_name }}</div>
                      <div class="smg-cell2-sub">{{ teacherModeCell(d.dow, p.id)!.subject }}</div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="smg-foot">
          <el-button @click="wizardStep = 1">上一步</el-button>
          <el-button type="primary" @click="wizardStep = 3">下一步</el-button>
        </div>
      </div>

      <!-- Step 3 -->
      <div v-show="wizardStep === 3" class="smg-step smg-step3">
        <el-form label-position="top" class="smg-f3">
          <el-form-item label="已导入课表周次">
            <el-input :model-value="applyInfo?.summary_text ?? '—'" disabled />
          </el-form-item>
          <el-form-item label="从已导入课表的第几周开始应用">
            <el-select v-model="applyForm.start_week_index" style="width: 200px">
              <el-option v-for="o in applyInfo?.week_options ?? []" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="课表应用日期">
            <el-date-picker
              v-model="applyDateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始"
              end-placeholder="结束"
              value-format="YYYY-MM-DD"
              style="width: 360px"
            />
            <p class="smg-tip">系统将自动应用上述选择的课表+班级+节次，循环应用到该日期中</p>
          </el-form-item>
        </el-form>
        <el-alert type="warning" :closable="false" show-icon class="smg-alert">
          <template #title>
            <div>1. 应用过程涉及大量数据处理与存储，请耐心等待。</div>
            <div>2. 若长时间无响应或失败，可尝试缩短应用日期范围后重试。</div>
          </template>
        </el-alert>
        <el-form label-position="top" class="smg-f3">
          <el-form-item label="应用班级">
            <el-radio-group v-model="applyForm.apply_scope_class">
              <el-radio value="all">全部班级</el-radio>
              <el-radio value="partial">部分班级</el-radio>
            </el-radio-group>
            <p class="smg-tip">请选择需要应用课表的年级或班级</p>
            <div v-if="applyForm.apply_scope_class === 'partial'" class="smg-partial">
              <el-checkbox-group v-model="applyForm.class_ids">
                <el-checkbox v-for="c in partialClassOptions" :key="c.id" :value="c.id">{{ c.label }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </el-form-item>
          <el-form-item label="应用节次">
            <el-radio-group v-model="applyForm.apply_scope_period">
              <el-radio value="all">全部节次</el-radio>
              <el-radio value="partial">部分节次</el-radio>
            </el-radio-group>
            <p class="smg-tip">请选择需要应用课表的节次</p>
            <div v-if="applyForm.apply_scope_period === 'partial'" class="smg-partial">
              <el-checkbox-group v-model="applyForm.period_ids">
                <el-checkbox v-for="p in meta?.import_period_options ?? []" :key="p.id" :value="p.id">
                  {{ p.label }}
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </el-form-item>
          <el-form-item label="任教更新">
            <el-switch v-model="applyForm.update_teacher" />
            <span class="smg-tip-inline">开启后，自动更新教师数据中的任教班级信息</span>
          </el-form-item>
        </el-form>
        <div class="smg-foot">
          <el-button @click="wizardStep = 2">上一步</el-button>
          <el-button @click="exitWizard">取消</el-button>
          <el-button type="primary" :loading="applyLoading" @click="submitApply">确定应用</el-button>
        </div>
      </div>
    </template>

    <!-- 新增导入 -->
    <el-drawer v-model="createVisible" title="新增导入" size="480px" destroy-on-close>
      <el-form :model="createForm" label-position="top">
        <el-form-item label="学年学期">
          <el-input :model-value="meta?.term_range_text ?? ''" disabled />
        </el-form-item>
        <el-form-item label="课表名称" required>
          <el-input v-model="createForm.name" maxlength="20" show-word-limit placeholder="请输入20字以内的课表名称" />
        </el-form-item>
        <el-form-item label="选择校区" required>
          <el-radio-group v-model="createForm.campus_id">
            <el-radio v-for="c in meta?.campuses ?? []" :key="c.id" :value="c.id">{{ c.name }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="导入方式">
          <el-radio-group v-model="createForm.import_method" class="smg-radio-col">
            <el-radio value="week">按周导入 — 适用于每周重复的课表安排</el-radio>
            <el-radio value="day">按天导入 — 适用于每日不同、如值日表</el-radio>
            <el-radio value="multi_week">多周导入 — 适用于多周循环课表</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="createForm.import_method === 'multi_week'" label="周次输入" required>
          <el-input-number v-model="createForm.multi_week_count" :min="1" :max="52" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createSaving" @click="submitCreate">确定</el-button>
      </template>
    </el-drawer>

    <!-- 修改导入 -->
    <el-drawer v-model="editVisible" title="修改导入" size="480px" destroy-on-close @opened="onEditOpened">
      <el-form v-if="editForm" :model="editForm" label-position="top">
        <el-form-item label="学年学期">
          <el-input :model-value="editTermRange" disabled />
        </el-form-item>
        <el-form-item label="课表名称" required>
          <el-input v-model="editForm.name" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item label="选择校区" required>
          <el-radio-group v-model="editForm.campus_id">
            <el-radio v-for="c in meta?.campuses ?? []" :key="c.id" :value="c.id">{{ c.name }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="导入方式">
          <el-radio-group v-model="editForm.import_method" class="smg-radio-col">
            <el-radio value="week">按周导入 — 适用于每周重复的课表安排</el-radio>
            <el-radio value="day">按天导入 — 适用于每日不同、如值日表</el-radio>
            <el-radio value="multi_week">多周导入 — 适用于多周循环课表</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="editForm.import_method === 'multi_week'" label="周次输入" required>
          <el-input-number v-model="editForm.multi_week_count" :min="1" :max="52" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="submitEdit">确定</el-button>
      </template>
    </el-drawer>

    <!-- 应用记录 -->
    <el-dialog v-model="recordsVisible" title="课表应用记录" width="640px" destroy-on-close>
      <el-table :data="records" border size="small">
        <el-table-column prop="applied_at" label="应用时间" width="160" />
        <el-table-column prop="summary" label="摘要" min-width="200" />
        <el-table-column prop="operator" label="操作人" width="100" />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { UploadRequestOptions } from 'element-plus'
import { Bell, Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ElTree } from 'element-plus'
import { fetchTimetableClasses } from '@/api/timetable'
import {
  deleteScheduleMgmtTimetable,
  fetchAnomalies,
  fetchApplicationRecords,
  fetchApplyInfo,
  fetchImportClassGrid,
  fetchImportSession,
  fetchImportTeacherGrid,
  fetchImportTeachers,
  fetchScheduleMgmtMeta,
  fetchScheduleMgmtTimetables,
  getScheduleMgmtTimetable,
  patchImportSession,
  patchScheduleMgmtTimetable,
  postApplySubmit,
  postExportMaster,
  postScheduleMgmtTimetable,
  postUploadSchedule,
  postUploadTeaching,
  scheduleTemplateScheduleUrl,
  scheduleTemplateTeachingUrl,
  type ScheduleMgmtImportMethod,
  type ScheduleMgmtRow,
} from '@/api/scheduleMgmt'

const meta = ref<Awaited<ReturnType<typeof fetchScheduleMgmtMeta>> | null>(null)
const rows = ref<ScheduleMgmtRow[]>([])
const listCampusId = ref('')

const wizardMode = ref(false)
const wizardTimetableId = ref('')
const wizardStep = ref(1)

const createVisible = ref(false)
const createSaving = ref(false)
const createForm = ref({
  name: '',
  campus_id: '',
  import_method: 'week' as ScheduleMgmtImportMethod,
  multi_week_count: 2 as number | null,
})

const editVisible = ref(false)
const editSaving = ref(false)
const editId = ref('')
const editForm = ref<{
  name: string
  campus_id: string
  import_method: ScheduleMgmtImportMethod
  multi_week_count: number | null
} | null>(null)
const editTermRange = ref('')

const recordsVisible = ref(false)
const records = ref<{ id: string; applied_at: string; summary: string; operator: string }[]>([])

const selectedPeriodIds = ref<string[]>([])
const periodAll = ref(true)
const periodInd = ref(false)

const viewTab = ref<'class' | 'teacher'>('class')
const classTab = ref('admin')
const classSearch = ref('')
const classTreeRef = ref<InstanceType<typeof ElTree>>()
const classTreeData = ref<{ id: string; label: string; children?: unknown[] }[]>([])
const selectedClassId = ref('cls-g7-1')

const teacherSearch = ref('')
const teacherList = ref<{ id: string; name: string }[]>([])
const teacherListFiltered = ref<{ id: string; name: string }[]>([])
const selectedTeacherId = ref('t-bxm')

const gridWeek = ref(1)
const gridWeekOptions = ref<number[]>([1])
const classGrid = ref<Awaited<ReturnType<typeof fetchImportClassGrid>> | null>(null)
const teacherGridCells = ref<
  { day: number; period_id: string; class_name: string; subject: string }[]
>([])
const gridLoading = ref(false)

const applyInfo = ref<Awaited<ReturnType<typeof fetchApplyInfo>> | null>(null)
const applyDateRange = ref<[string, string] | null>(null)
const applyForm = ref({
  start_week_index: 1,
  apply_scope_class: 'all' as 'all' | 'partial',
  apply_scope_period: 'all' as 'all' | 'partial',
  class_ids: [] as string[],
  period_ids: [] as string[],
  update_teacher: true,
})
const applyLoading = ref(false)

const partialClassOptions = ref<{ id: string; label: string }[]>([])

const wizardCrumbStep = computed(() => {
  if (wizardStep.value === 1) return '导入课表'
  if (wizardStep.value === 2) return '查看课表'
  return '课表应用'
})

const gridTitle = computed(() => {
  if (viewTab.value === 'class') {
    const g = findClassLabel(selectedClassId.value)
    return `${g}课表`
  }
  const t = teacherList.value.find((x) => x.id === selectedTeacherId.value)
  return `${t?.name ?? ''} 的课表`
})

function findClassLabel(classId: string): string {
  for (const g of classTreeData.value) {
    const ch = g.children as { id: string; label: string }[] | undefined
    if (!ch) continue
    for (const c of ch) {
      if (c.id === classId) return `${g.label}-${c.label}`
    }
  }
  return '班级'
}

function classModeCell(dow: number, periodId: string) {
  if (!classGrid.value) return undefined
  return classGrid.value.cells.find((c) => c.day === dow && c.period_id === periodId)
}

function teacherModeCell(dow: number, periodId: string) {
  return teacherGridCells.value.find((c) => c.day === dow && c.period_id === periodId)
}

async function loadMeta() {
  meta.value = await fetchScheduleMgmtMeta()
  if (!listCampusId.value && meta.value.campuses.length) {
    listCampusId.value = meta.value.campuses[0]!.id
  }
  if (!createForm.value.campus_id && meta.value.campuses.length) {
    createForm.value.campus_id = meta.value.campuses[0]!.id
  }
  selectedPeriodIds.value = meta.value.import_period_options.map((p) => p.id)
}

async function loadList() {
  rows.value = await fetchScheduleMgmtTimetables({
    campus_id: listCampusId.value || undefined,
    semester: meta.value?.semester_label,
  })
}

function openCreate() {
  createForm.value = {
    name: '',
    campus_id: meta.value?.campuses[0]?.id ?? '',
    import_method: 'week',
    multi_week_count: 2,
  }
  createVisible.value = true
}

async function submitCreate() {
  if (!createForm.value.name.trim()) {
    ElMessage.warning('请输入课表名称')
    return
  }
  if (createForm.value.import_method === 'multi_week') {
    if (!createForm.value.multi_week_count || createForm.value.multi_week_count < 1) {
      ElMessage.warning('请填写多周周次')
      return
    }
  }
  createSaving.value = true
  try {
    const item = await postScheduleMgmtTimetable({
      name: createForm.value.name.trim(),
      campus_id: createForm.value.campus_id,
      import_method: createForm.value.import_method,
      multi_week_count:
        createForm.value.import_method === 'multi_week' ? createForm.value.multi_week_count : undefined,
    })
    createVisible.value = false
    ElMessage.success('已创建，进入导入流程')
    await loadList()
    enterWizard(item.id, 1)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  } finally {
    createSaving.value = false
  }
}

async function enterWizard(id: string, step: number) {
  wizardTimetableId.value = id
  wizardMode.value = true
  const s = await fetchImportSession(id)
  selectedPeriodIds.value = s.selected_period_ids.length ? s.selected_period_ids : selectedPeriodIds.value
  syncPeriodAll()
  gridWeekOptions.value = Array.from({ length: Math.max(1, s.imported_weeks) }, (_, i) => i + 1)
  gridWeek.value = 1
  await loadClassTree()
  await loadTeachers()
  const prev = wizardStep.value
  wizardStep.value = step
  // 与当前步相同则 watch 不会触发，需手动同步
  if (prev === step) {
    await patchImportSession(id, { step })
    if (step === 2) await loadGrid()
    if (step >= 3) await loadApplyInfo()
  }
}

/** Element Plus 的 el-steps 标题默认不可点击，需自行切换 wizardStep */
function onWizardStepClick(step: number) {
  if (!wizardTimetableId.value) return
  wizardStep.value = step
}

async function exitWizard() {
  wizardMode.value = false
  wizardTimetableId.value = ''
  wizardStep.value = 1
  await loadList()
}

function syncPeriodAll() {
  const all = meta.value?.import_period_options.map((p) => p.id) ?? []
  const n = selectedPeriodIds.value.length
  periodAll.value = n === all.length && n > 0
  periodInd.value = n > 0 && n < all.length
}

function onPeriodAll(v: boolean | string | number) {
  const on = Boolean(v)
  const all = meta.value?.import_period_options.map((p) => p.id) ?? []
  selectedPeriodIds.value = on ? [...all] : []
  periodInd.value = false
}

watch(selectedPeriodIds, syncPeriodAll)

async function goStep2() {
  if (!selectedPeriodIds.value.length) {
    ElMessage.warning('请至少选择一个节次')
    return
  }
  await patchImportSession(wizardTimetableId.value, {
    selected_period_ids: selectedPeriodIds.value,
    step: 2,
  })
  wizardStep.value = 2
}

async function doUploadSchedule(_opt: UploadRequestOptions) {
  try {
    await postUploadSchedule(wizardTimetableId.value)
    ElMessage.success('课表文件已上传（演示）')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  }
}

async function doUploadTeaching(_opt: UploadRequestOptions) {
  try {
    await postUploadTeaching(wizardTimetableId.value)
    ElMessage.success('任教文件已上传（演示）')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  }
}

function dlScheduleTpl() {
  window.open(scheduleTemplateScheduleUrl(), '_blank')
}

function dlTeachingTpl() {
  window.open(scheduleTemplateTeachingUrl(), '_blank')
}

async function loadClassTree() {
  const campus = listCampusId.value || meta.value?.campuses[0]?.id
  if (!campus) return
  classTreeData.value = await fetchTimetableClasses(campus)
  await nextTick()
  classTreeRef.value?.filter(classSearch.value)
  classTreeRef.value?.setCurrentKey(selectedClassId.value)
}

function filterClassNode(value: string, data: { label: string }) {
  if (!value) return true
  return data.label.includes(value)
}

watch(classSearch, (v) => {
  classTreeRef.value?.filter(v)
})

function onClassNode(data: { id?: string; is_class?: boolean }) {
  if (data.is_class && data.id) {
    selectedClassId.value = data.id
    loadGrid()
  }
}

async function loadTeachers() {
  teacherList.value = await fetchImportTeachers()
  filterTeachers()
}

function filterTeachers() {
  const q = teacherSearch.value.trim()
  teacherListFiltered.value = q ? teacherList.value.filter((t) => t.name.includes(q)) : [...teacherList.value]
}

function selectTeacher(id: string) {
  selectedTeacherId.value = id
  loadGrid()
}

async function loadGrid() {
  if (!wizardTimetableId.value) return
  gridLoading.value = true
  try {
    if (viewTab.value === 'class') {
      classGrid.value = await fetchImportClassGrid(wizardTimetableId.value, selectedClassId.value, gridWeek.value)
      teacherGridCells.value = []
    } else {
      const g = await fetchImportTeacherGrid(wizardTimetableId.value, selectedTeacherId.value, gridWeek.value)
      classGrid.value = {
        title_suffix: '',
        week_number: g.week_number,
        days: g.days,
        periods: g.periods,
        cells: [],
      }
      teacherGridCells.value = g.cells.map((c) => ({
        day: c.day,
        period_id: c.period_id,
        class_name: c.class_name,
        subject: c.subject,
        color: '#e3f2fd',
      }))
    }
  } finally {
    gridLoading.value = false
  }
}

async function runExport() {
  try {
    const r = await postExportMaster(wizardTimetableId.value)
    ElMessage.success(r.message)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

async function runAnomalies() {
  try {
    const r = await fetchAnomalies(wizardTimetableId.value)
    ElMessage.info(r.message || '无异常')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

async function loadApplyInfo() {
  applyInfo.value = await fetchApplyInfo(wizardTimetableId.value)
  applyDateRange.value = [
    applyInfo.value.default_date_start,
    applyInfo.value.default_date_end,
  ]
  applyForm.value.start_week_index = applyInfo.value.week_options[0]?.value ?? 1
  buildPartialClasses()
}

function buildPartialClasses() {
  const out: { id: string; label: string }[] = []
  for (const g of classTreeData.value) {
    const ch = g.children as { id: string; label: string }[] | undefined
    if (!ch) continue
    for (const c of ch) {
      out.push({ id: c.id, label: `${g.label}${c.label}` })
    }
  }
  partialClassOptions.value = out
}

watch(wizardStep, async (s) => {
  if (!wizardTimetableId.value) return
  await patchImportSession(wizardTimetableId.value, { step: s })
  if (s === 2) await loadGrid()
  if (s === 3) await loadApplyInfo()
})

async function submitApply() {
  if (!applyDateRange.value || applyDateRange.value.length !== 2) {
    ElMessage.warning('请选择应用日期范围')
    return
  }
  applyLoading.value = true
  try {
    await postApplySubmit(wizardTimetableId.value, {
      start_week_index: applyForm.value.start_week_index,
      date_start: applyDateRange.value[0]!,
      date_end: applyDateRange.value[1]!,
      apply_all_classes: applyForm.value.apply_scope_class === 'all',
      class_ids: applyForm.value.apply_scope_class === 'partial' ? applyForm.value.class_ids : undefined,
      apply_all_periods: applyForm.value.apply_scope_period === 'all',
      period_ids: applyForm.value.apply_scope_period === 'partial' ? applyForm.value.period_ids : undefined,
      update_teacher: applyForm.value.update_teacher,
    })
    ElMessage.success('应用已提交（演示）')
    await exitWizard()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  } finally {
    applyLoading.value = false
  }
}

async function openRecords(row: ScheduleMgmtRow) {
  records.value = await fetchApplicationRecords(row.id)
  recordsVisible.value = true
}

function onRowMore(cmd: string, row: ScheduleMgmtRow) {
  if (cmd === 'edit') {
    editId.value = row.id
    editVisible.value = true
  } else if (cmd === 'delete') {
    void confirmDelete(row)
  }
}

async function onEditOpened() {
  const d = await getScheduleMgmtTimetable(editId.value)
  editTermRange.value = d.term_range_text
  editForm.value = {
    name: d.item.name,
    campus_id: d.item.campus_id,
    import_method: d.item.import_method,
    multi_week_count: d.item.multi_week_count ?? 2,
  }
}

async function submitEdit() {
  if (!editForm.value) return
  if (!editForm.value.name.trim()) {
    ElMessage.warning('请输入课表名称')
    return
  }
  editSaving.value = true
  try {
    await patchScheduleMgmtTimetable(editId.value, {
      name: editForm.value.name.trim(),
      campus_id: editForm.value.campus_id,
      import_method: editForm.value.import_method,
      multi_week_count:
        editForm.value.import_method === 'multi_week' ? editForm.value.multi_week_count : null,
    })
    ElMessage.success('已保存')
    editVisible.value = false
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  } finally {
    editSaving.value = false
  }
}

async function confirmDelete(row: ScheduleMgmtRow) {
  try {
    await ElMessageBox.confirm(`确定删除课表「${row.name}」？`, '删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteScheduleMgmtTimetable(row.id)
    ElMessage.success('已删除')
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

onMounted(async () => {
  await loadMeta()
  await loadList()
})
</script>

<style scoped>
.smg {
  padding: 16px 20px 24px;
  min-height: 480px;
}
.smg-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.smg-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.smg-filter {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}
.smg-sem {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.smg-sem-bar {
  width: 4px;
  height: 18px;
  background: var(--el-color-primary);
  border-radius: 2px;
}
.smg-table {
  width: 100%;
}
.smg-st-applied {
  color: #67c23a;
  font-weight: 500;
}
.smg-st-draft {
  color: #e6a23c;
}
.smg-wiz-top {
  margin-bottom: 16px;
}
.smg-back {
  margin-bottom: 8px;
  padding: 0;
}
.smg-crumb {
  font-size: 13px;
  color: #606266;
}
.smg-crumb-div {
  margin: 0 6px;
  color: #dcdfe6;
}
.smg-steps {
  margin-bottom: 24px;
}
.smg-steps--clickable :deep(.smg-step-hit) {
  cursor: pointer;
}
.smg-steps--clickable :deep(.el-step__title) {
  line-height: 1.4;
}
.smg-step-title {
  cursor: pointer;
  color: inherit;
  border-radius: 4px;
  padding: 2px 6px;
  margin: 0 -6px;
  outline: none;
}
.smg-step-title:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.smg-steps--clickable :deep(.el-step.is-process .smg-step-title),
.smg-steps--clickable :deep(.el-step.is-finish .smg-step-title) {
  font-weight: 600;
}
.smg-step {
  max-width: 920px;
}
.smg-block {
  margin-bottom: 20px;
}
.smg-lbl {
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
}
.smg-periods {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 14px;
  background: #fafafa;
}
.smg-pgrid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 10px;
}
.smg-up {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.smg-tip {
  font-size: 12px;
  color: #909399;
  margin: 0;
  line-height: 1.5;
}
.smg-tip-bold {
  font-weight: 600;
  color: #606266;
}
.smg-foot {
  text-align: center;
  margin-top: 24px;
  display: flex;
  justify-content: center;
  gap: 12px;
}
.smg-s2-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.smg-s2-head :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.smg-s2-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.smg-s2-body {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-height: 360px;
}
.smg-aside {
  width: 220px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 10px;
  background: #fafafa;
  max-height: 520px;
  overflow: auto;
}
.smg-class-tab {
  width: 100%;
  margin-bottom: 8px;
}
.smg-class-tab :deep(.el-radio-button__inner) {
  width: 100%;
}
.smg-aside-search {
  margin-bottom: 8px;
}
.smg-tlist {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.smg-tlist li {
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
}
.smg-tlist li:hover {
  background: #ecf5ff;
}
.smg-tlist--active {
  color: var(--el-color-primary);
  font-weight: 600;
  background: var(--el-color-primary-light-9);
}
.smg-grid-wrap {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.smg-grid-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
  color: #303133;
}
.smg-tb {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  border: 1px solid #ebeef5;
}
.smg-tb th,
.smg-tb td {
  border: 1px solid #e4e7ed;
  padding: 6px 4px;
  text-align: center;
  vertical-align: middle;
}
.smg-tb th {
  background: #f5f7fa;
  font-weight: 600;
}
.smg-tb-p {
  width: 88px;
  background: #fafafa;
}
.smg-tb-pt {
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}
.smg-tb-c {
  min-width: 72px;
  min-height: 52px;
}
.smg-cell2 {
  border-radius: 4px;
  padding: 6px 4px;
  line-height: 1.35;
}
.smg-cell2-sub {
  font-size: 11px;
  color: #606266;
  margin-top: 2px;
}
.smg-cell-t {
  border-radius: 4px;
  padding: 6px 4px;
  line-height: 1.35;
}
.smg-step3 {
  max-width: 640px;
}
.smg-f3 {
  margin-top: 8px;
}
.smg-alert {
  margin: 16px 0;
}
.smg-partial {
  margin-top: 8px;
  padding: 10px;
  border: 1px dashed #dcdfe6;
  border-radius: 4px;
}
.smg-tip-inline {
  margin-left: 10px;
  font-size: 12px;
  color: #909399;
}
.smg-radio-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
</style>
