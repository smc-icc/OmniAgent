<template>
  <div v-if="modelValue" class="isw-embed">
    <header class="isw-embed-hd">
      <span class="isw-dlg-title">智能排课</span>
      <el-button text class="isw-close" @click="closeWizard">
        <el-icon :size="18"><Close /></el-icon>
      </el-button>
    </header>
    <div v-loading="loading" class="isw-root">
      <aside class="isw-sider">
        <el-button class="isw-guide-btn" plain @click="ElMessage.info('排课指引：按步骤完成课务、规则、预排、自动排课与课表应用。')">
          排课指引
        </el-button>
        <ul class="isw-steps">
          <li
            v-for="s in mainSteps"
            :key="s.n"
            :class="['isw-step', { 'isw-step--active': mainStep === s.n, 'isw-step--done': mainStep > s.n }]"
            @click="goMainStep(s.n)"
          >
            <span class="isw-step-num">{{ s.n }}</span>
            <span class="isw-step-txt">{{ s.label }}</span>
          </li>
        </ul>
      </aside>
      <div class="isw-main">
        <div class="isw-crumb">
          <span>智能排课</span>
          <span class="isw-crumb-div">/</span>
          <span>排课列表</span>
          <span class="isw-crumb-div">/</span>
          <span class="isw-crumb-task">{{ taskName }}</span>
        </div>

        <!-- 第 1 步 课务安排 -->
        <template v-if="mainStep === 1">
          <el-tabs v-model="step1Tab" class="isw-tabs" @tab-change="onStep1TabChange">
            <el-tab-pane label="教学时间" name="teaching_time">
              <div class="isw-toolbar">
                <el-button size="small" @click="refreshTeachingPreview">刷新时段预览</el-button>
              </div>
              <div class="isw-block">
                <div class="isw-label">每周上课天数</div>
                <el-checkbox-group v-model="tt.weekday_indices" class="isw-days">
                  <el-checkbox v-for="(d, i) in weekOptions" :key="i" :value="i">{{ d }}</el-checkbox>
                </el-checkbox-group>
              </div>
              <div class="isw-block isw-periods">
                <div class="isw-label">选择排课时段</div>
                <span class="isw-period-item">早自习 <el-input-number v-model="tt.early_self" :min="0" :max="4" size="small" /></span>
                <span class="isw-period-item">上午 <el-input-number v-model="tt.morning" :min="0" :max="12" size="small" /></span>
                <span class="isw-period-item">下午 <el-input-number v-model="tt.afternoon" :min="0" :max="12" size="small" /></span>
                <span class="isw-period-item">晚自习 <el-input-number v-model="tt.evening_self" :min="0" :max="6" size="small" /></span>
                <el-button size="small" type="primary" plain @click="ElMessage.info('添加公共时段为演示占位')">
                  + 添加公共时段
                </el-button>
              </div>
              <el-table :data="slotPreviewRows" border size="small" class="isw-slot-table">
                <el-table-column label="节次" width="120">
                  <template #default="{ row }">
                    <template v-if="row.kind === 'lesson'">{{ row.period_no }}</template>
                    <span v-else class="isw-break-label">
                      <el-icon class="isw-break-icon"><Minus /></el-icon>
                      {{ row.label }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="节次时间" width="130">
                  <template #default="{ row }">{{ row.time_range }}</template>
                </el-table-column>
                <el-table-column v-for="d in teachingDayColumns" :key="d" :label="d" min-width="72">
                  <template #default />
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="任教课时" name="teaching_hours">
              <div class="isw-toolbar isw-toolbar-wrap">
                <el-input v-model="hoursTeacherQ" placeholder="请输入老师名称" clearable style="width: 200px" />
                <div class="isw-toolbar-right">
                  <el-button type="primary" size="small" @click="ElMessage.info('演示占位')">设置课程课时</el-button>
                  <el-button type="primary" size="small" @click="ElMessage.info('演示占位')">上传班级任教</el-button>
                  <el-button type="primary" size="small" @click="ElMessage.info('演示占位')">更新到当前课表</el-button>
                  <el-button type="primary" size="small" @click="ElMessage.info('演示占位')">下载班级课务安排</el-button>
                  <el-button-group>
                    <el-button
                      size="small"
                      :type="hoursView === 'class' ? 'primary' : 'default'"
                      @click="setHoursView('class')"
                    >
                      班级
                    </el-button>
                    <el-button
                      size="small"
                      :type="hoursView === 'teacher' ? 'primary' : 'default'"
                      @click="setHoursView('teacher')"
                    >
                      教师
                    </el-button>
                  </el-button-group>
                  <el-divider direction="vertical" class="isw-toolbar-div" />
                  <el-button size="small" @click="ElMessage.info('演示：导入总课表')">导入总课表</el-button>
                  <el-button type="primary" size="small" @click="ElMessage.info('演示：上传完整任教')">
                    上传完整任教
                  </el-button>
                </div>
              </div>
              <el-table :data="filteredHoursRows" border size="small" max-height="420">
                <el-table-column prop="class_name" width="132" fixed>
                  <template #header>
                    <span class="isw-class-hd">
                      <span>班级</span>
                      <el-button
                        type="primary"
                        circle
                        size="small"
                        class="isw-class-add"
                        title="添加班级"
                        @click="addTeachingClassRow"
                      >
                        <el-icon><Plus /></el-icon>
                      </el-button>
                    </span>
                  </template>
                  <template #default="{ row }">{{ row.class_name }}</template>
                </el-table-column>
                <el-table-column prop="homeroom_teacher" label="班主任" width="100" />
                <el-table-column
                  v-for="sub in subjectColumns"
                  :key="sub.key"
                  :label="sub.title"
                  min-width="140"
                >
                  <template #default="{ row }">
                    <div class="isw-subj-cell">
                      <span class="isw-subj-t">{{ cellSubject(row, sub.key)?.teacher }}</span>
                      <el-input-number
                        :model-value="cellSubject(row, sub.key)?.hours ?? 0"
                        :min="0"
                        :max="40"
                        size="small"
                        controls-position="right"
                        @update:model-value="onHoursCellInput(row.id, sub.key, $event)"
                      />
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="total_hours" label="课时数" width="80" fixed="right" />
              </el-table>
              <el-alert v-if="hoursView === 'teacher'" type="info" :closable="false" class="isw-mt" title="教师视图演示：与班级视图共用数据源筛选。" />
            </el-tab-pane>

            <el-tab-pane label="公共教室" name="public_room">
              <div class="isw-toolbar isw-toolbar-wrap">
                <div class="isw-toolbar-right isw-toolbar-right--full">
                  <el-button size="small" @click="ElMessage.info('演示：导入公共教室')">导入公共教室</el-button>
                  <el-button type="primary" size="small" @click="ElMessage.info('演示：快速设置开班限制')">
                    快速设置开班限制
                  </el-button>
                  <el-button type="primary" size="small" @click="ElMessage.info('演示：保存修改')">保存修改</el-button>
                </div>
              </div>
              <el-table :data="publicRoomDemoRows" border size="small" class="isw-slot-table">
                <el-table-column prop="room_name" label="教室名称" min-width="120" />
                <el-table-column prop="max_classes" label="最大开班数" width="100" align="center" />
                <el-table-column label="课程名称" min-width="160">
                  <template #default="{ row }">
                    <el-tag v-for="c in row.courses" :key="c" size="small" class="isw-room-tag">{{ c }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="使用年级" min-width="220">
                  <template #default="{ row }">
                    <el-tag v-for="g in row.grades" :key="g" size="small" type="info" class="isw-room-tag">
                      {{ g }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="指定班级" min-width="160">
                  <template #default="{ row }">
                    <el-select
                      :model-value="row.designate_placeholder"
                      placeholder="请选择指定班级"
                      size="small"
                      style="width: 100%"
                      disabled
                    />
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="72" align="center" fixed="right">
                  <template #default>
                    <el-button type="danger" link @click="ElMessage.info('演示：删除')">
                      <el-icon><Delete /></el-icon>
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="单双周" name="odd_week">
              <el-radio-group v-model="oddSubtab" class="isw-subtabs" @change="onOddSubtabChange">
                <el-radio-button value="single_double">单双设置</el-radio-button>
                <el-radio-button value="merge">合班设置</el-radio-button>
                <el-radio-button value="simultaneous">同时开课</el-radio-button>
              </el-radio-group>

              <template v-if="oddSubtab === 'single_double'">
                <el-alert type="warning" :closable="false" class="isw-mt" show-icon>
                  可切换单/双安排，或删除课程单双设置（演示数据可在后续对接保存接口）。
                </el-alert>
                <div class="isw-cols4">
                  <div class="isw-col">
                    <div class="isw-col-title">选择单双周班级</div>
                    <el-tree
                      :data="classTree"
                      show-checkbox
                      node-key="id"
                      default-expand-all
                      :props="{ label: 'label', children: 'children' }"
                    />
                  </div>
                  <div class="isw-col">
                    <div class="isw-col-title">选择单双周课程</div>
                    <el-empty description="请先勾选班级" :image-size="64" />
                  </div>
                  <div class="isw-col isw-col-action">
                    <el-button type="primary">添加课程单双周关联 &gt;</el-button>
                  </div>
                  <div class="isw-col">
                    <div class="isw-col-title">已添加的：单双周课程</div>
                    <el-input placeholder="请输入班级或科目" clearable size="small" class="isw-mb" />
                    <div class="isw-mini-list">
                      <div class="isw-mini-row">七年级1班 · 心理/综合/劳动 — 单 1节 / 劳动 双 1节</div>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else-if="oddSubtab === 'merge'">
                <el-alert type="warning" :closable="false" class="isw-mt" show-icon>
                  此处维护合班课程：先选课程，再选班级，添加至右侧列表（演示）。
                </el-alert>
                <div class="isw-cols4">
                  <div class="isw-col">
                    <div class="isw-col-title">选择合班课程</div>
                    <el-scrollbar max-height="280">
                      <div v-for="c in mergeCourses" :key="c" class="isw-list-item">{{ c }}</div>
                    </el-scrollbar>
                  </div>
                  <div class="isw-col">
                    <div class="isw-col-title">选择合班班级</div>
                    <el-empty description="选择左侧课程后展示班级" :image-size="64" />
                  </div>
                  <div class="isw-col isw-col-action">
                    <el-button type="primary">添加课程 &gt;</el-button>
                  </div>
                  <div class="isw-col">
                    <div class="isw-col-title">已添加的合班课程</div>
                    <el-input placeholder="请输入班级或科目" clearable size="small" class="isw-mb" />
                    <el-empty description="暂无" :image-size="48" />
                  </div>
                </div>
              </template>

              <template v-else>
                <el-alert type="warning" :closable="false" class="isw-mt" show-icon>
                  此处仅显示已设置单双的课程与班级；1.5 节等情况以单周多出的节次在此配置（演示说明）。
                </el-alert>
                <div class="isw-cols3">
                  <div class="isw-col">
                    <div class="isw-col-title">选择同时上课班级</div>
                    <el-collapse>
                      <el-collapse-item title="七年级" name="g7">
                        <div v-for="i in 8" :key="i" class="isw-list-item">七年级{{ i }}班</div>
                      </el-collapse-item>
                      <el-collapse-item title="八年级" name="g8">
                        <div v-for="i in 2" :key="i" class="isw-list-item">八年级{{ i }}班</div>
                      </el-collapse-item>
                    </el-collapse>
                  </div>
                  <div class="isw-col isw-col-action">
                    <el-button type="primary">添加同时上课组 &gt;</el-button>
                  </div>
                  <div class="isw-col">
                    <div class="isw-col-title">已添加的同时上课组</div>
                    <el-input placeholder="请输入班级或科目" clearable size="small" class="isw-mb" />
                    <el-empty description="暂无" :image-size="48" />
                  </div>
                </div>
              </template>
            </el-tab-pane>
          </el-tabs>
        </template>

        <IntelligentSchedulingRulesStep
          v-else-if="mainStep === 2"
          :key="taskId"
          v-model="schedulingRules"
        />

        <IntelligentSchedulingPrescheduleStep
          v-else-if="mainStep === 3"
          :key="taskId + '-ps'"
          v-model="preScheduling"
        />

        <IntelligentSchedulingAutoStep
          v-else-if="mainStep === 4"
          :key="taskId + '-auto'"
          v-model="autoScheduling"
          :task-id="taskId"
          @view-timetable="onViewTimetable"
        />

        <IntelligentSchedulingAdjustmentStep
          v-else-if="mainStep === 5"
          :key="taskId + '-adj'"
          :task-id="taskId"
          :day-labels="teachingDayColumns"
        />

        <IntelligentSchedulingResultStep
          v-else-if="mainStep === 6"
          :key="taskId + '-res'"
          :task-id="taskId"
          :day-labels="teachingDayColumns"
        />

        <IntelligentSchedulingClassroomStep
          v-else-if="mainStep === 7"
          :key="taskId + '-room'"
          :task-id="taskId"
        />

        <IntelligentSchedulingApplyStep
          v-else-if="mainStep === 8"
          :key="taskId + '-apply'"
          :task-id="taskId"
          @finished="onApplyFinished"
        />

        <div v-if="mainStep < 8" class="isw-footer">
          <el-button type="primary" :loading="saving" @click="saveAndNext">保存并下一步</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Close, Delete, Minus, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, ref, watch } from 'vue'
import {
  TEACHING_HOURS_ROWS_DEMO,
  defaultAutoScheduling,
  defaultPreSchedule,
  defaultSchedulingRules,
  fetchIntelligentSchedulingWizard,
  mergeAutoScheduling,
  mergePreSchedule,
  mergeSchedulingRules,
  postIntelligentSchedulingWizardStep,
  putIntelligentSchedulingWizardAutoScheduling,
  putIntelligentSchedulingWizardHoursView,
  putIntelligentSchedulingWizardOddSubtab,
  putIntelligentSchedulingWizardPreScheduling,
  putIntelligentSchedulingWizardSchedulingRules,
  putIntelligentSchedulingWizardStep1Tab,
  putIntelligentSchedulingWizardTeachingHours,
  putIntelligentSchedulingWizardTeachingTime,
  type AutoSchedulingState,
  type PreScheduleState,
  type SchedulingRulesState,
  type TeachingHoursRow,
  type TeachingSlotRow,
} from '@/api/intelligentScheduling'
import IntelligentSchedulingAdjustmentStep from './IntelligentSchedulingAdjustmentStep.vue'
import IntelligentSchedulingApplyStep from './IntelligentSchedulingApplyStep.vue'
import IntelligentSchedulingClassroomStep from './IntelligentSchedulingClassroomStep.vue'
import IntelligentSchedulingResultStep from './IntelligentSchedulingResultStep.vue'
import IntelligentSchedulingAutoStep from './IntelligentSchedulingAutoStep.vue'
import IntelligentSchedulingPrescheduleStep from './IntelligentSchedulingPrescheduleStep.vue'
import IntelligentSchedulingRulesStep from './IntelligentSchedulingRulesStep.vue'

/** 与产品稿「教学时间」红框一致；接口未返回 slot_preview 时兜底展示 */
const TEACHING_SLOT_PREVIEW_DEMO: TeachingSlotRow[] = [
  { kind: 'lesson', period_no: 1, time_range: '08:00-08:40' },
  { kind: 'lesson', period_no: 2, time_range: '08:50-09:30' },
  { kind: 'break', label: '大课间', time_range: '09:30-10:00' },
  { kind: 'lesson', period_no: 3, time_range: '10:00-10:40' },
  { kind: 'lesson', period_no: 4, time_range: '10:50-11:30' },
  { kind: 'lesson', period_no: 5, time_range: '11:40-12:20' },
]

const props = defineProps<{
  modelValue: boolean
  taskId: string
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  done: []
}>()

const mainSteps = [
  { n: 1, label: '课务安排' },
  { n: 2, label: '排课规则' },
  { n: 3, label: '手工预排' },
  { n: 4, label: '自动排课' },
  { n: 5, label: '课表调整' },
  { n: 6, label: '课表结果' },
  { n: 7, label: '教室安排' },
  { n: 8, label: '课表应用' },
]

const weekOptions = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const loading = ref(false)
const saving = ref(false)
const taskName = ref('')
const mainStep = ref(1)
const step1Tab = ref<'teaching_time' | 'teaching_hours' | 'public_room' | 'odd_week'>('teaching_time')
const oddSubtab = ref<'single_double' | 'merge' | 'simultaneous'>('single_double')

const tt = ref({
  weekday_indices: [0, 1, 2, 3, 4] as number[],
  early_self: 0,
  morning: 5,
  afternoon: 4,
  evening_self: 0,
})
const slotPreview = ref<TeachingSlotRow[]>([])
const dayLabels = ref<string[]>([])

const hoursRows = ref<TeachingHoursRow[]>([])
const hoursView = ref<'class' | 'teacher'>('class')
const hoursTeacherQ = ref('')

const classTree = ref<{ id: string; label: string; children?: { id: string; label: string }[] }[]>([])
const mergeCourses = ref<string[]>([])

const schedulingRules = ref<SchedulingRulesState>(defaultSchedulingRules())
const preScheduling = ref<PreScheduleState>(defaultPreSchedule())
const autoScheduling = ref<AutoSchedulingState>(defaultAutoScheduling())

/** 公共教室 Tab 演示数据（与产品稿结构一致，后续可对接接口） */
const publicRoomDemoRows = ref<
  { room_name: string; max_classes: number; courses: string[]; grades: string[]; designate_placeholder: string }[]
>([
  {
    room_name: '信息教室',
    max_classes: 1,
    courses: ['信息'],
    grades: ['六年级', '七年级', '八年级', '九年级'],
    designate_placeholder: '',
  },
])

const subjectColumns = computed(() => {
  const r = hoursRows.value[0]
  return r?.subjects.map((s) => ({ key: s.key, title: s.title })) ?? []
})

const filteredHoursRows = computed(() => {
  const q = hoursTeacherQ.value.trim()
  if (!q || hoursView.value !== 'teacher') {
    return hoursRows.value
  }
  return hoursRows.value.filter((row) =>
    row.subjects.some((s) => s.teacher.includes(q) || s.title.includes(q)),
  )
})

const slotPreviewRows = computed(() =>
  slotPreview.value.length > 0 ? slotPreview.value : TEACHING_SLOT_PREVIEW_DEMO,
)

const teachingDayColumns = computed(() => {
  if (dayLabels.value.length > 0) return dayLabels.value
  return tt.value.weekday_indices.map((i) => weekOptions[i] ?? '').filter(Boolean)
})

function cloneTeachingHoursRows(rows: unknown): TeachingHoursRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return JSON.parse(JSON.stringify(TEACHING_HOURS_ROWS_DEMO)) as TeachingHoursRow[]
  }
  const first = rows[0] as { subjects?: unknown }
  if (!first?.subjects || !Array.isArray(first.subjects) || first.subjects.length === 0) {
    return JSON.parse(JSON.stringify(TEACHING_HOURS_ROWS_DEMO)) as TeachingHoursRow[]
  }
  return JSON.parse(JSON.stringify(rows)) as TeachingHoursRow[]
}

async function loadWizard() {
  if (!props.taskId) return
  loading.value = true
  try {
    const d = await fetchIntelligentSchedulingWizard(props.taskId)
    taskName.value = d.task_name
    mainStep.value = d.main_step
    step1Tab.value = d.step1_tab
    oddSubtab.value = d.odd_subtab
    tt.value = { ...d.teaching_time }
    slotPreview.value = d.slot_preview
    dayLabels.value = d.day_column_labels
    hoursRows.value = cloneTeachingHoursRows(d.teaching_hours_rows)
    hoursView.value = d.teaching_hours_view
    classTree.value = d.class_tree_odd_week
    mergeCourses.value = d.merge_course_options
    schedulingRules.value = mergeSchedulingRules(d.scheduling_rules)
    preScheduling.value = mergePreSchedule(d.pre_scheduling)
    autoScheduling.value = mergeAutoScheduling(d.auto_scheduling)
  } catch {
    hoursRows.value = JSON.parse(JSON.stringify(TEACHING_HOURS_ROWS_DEMO)) as TeachingHoursRow[]
    ElMessage.error('加载向导失败，已显示任教课时演示数据（请确认后端已启动）')
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.modelValue, props.taskId] as const,
  ([open, tid]) => {
    if (open && tid) {
      void loadWizard()
    }
  },
  { immediate: true },
)

function closeWizard() {
  emit('update:modelValue', false)
}

async function refreshTeachingPreview() {
  if (!props.taskId) return
  const r = await putIntelligentSchedulingWizardTeachingTime(props.taskId, { ...tt.value })
  slotPreview.value = r.slot_preview
  dayLabels.value = r.day_column_labels
  ElMessage.success('已刷新预览')
}

async function goMainStep(n: number) {
  if (!props.taskId) return
  mainStep.value = n
  await postIntelligentSchedulingWizardStep(props.taskId, n)
}

async function onViewTimetable() {
  if (!props.taskId) return
  try {
    await putIntelligentSchedulingWizardAutoScheduling(props.taskId, autoScheduling.value)
    await goMainStep(6)
    ElMessage.success('已跳转至课表结果')
  } catch {
    ElMessage.error('保存或跳转失败')
  }
}

function onApplyFinished() {
  emit('update:modelValue', false)
  emit('done')
}

async function onStep1TabChange(name: string | number) {
  const tab = String(name) as typeof step1Tab.value
  if (!props.taskId) return
  await putIntelligentSchedulingWizardStep1Tab(props.taskId, tab)
}

async function onOddSubtabChange() {
  if (!props.taskId) return
  await putIntelligentSchedulingWizardOddSubtab(props.taskId, oddSubtab.value)
}

async function setHoursView(v: 'class' | 'teacher') {
  hoursView.value = v
  if (props.taskId) {
    await putIntelligentSchedulingWizardHoursView(props.taskId, v)
  }
}

function cellSubject(row: TeachingHoursRow, key: string) {
  return row.subjects.find((s) => s.key === key)
}

function updateHours(rowId: string, subKey: string, hours: number) {
  const row = hoursRows.value.find((r) => r.id === rowId)
  if (!row) return
  const s = row.subjects.find((x) => x.key === subKey)
  if (s) {
    s.hours = hours
    row.total_hours = row.subjects.reduce((a, b) => a + b.hours, 0)
  }
}

function onHoursCellInput(rowId: string, subKey: string, v: unknown) {
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : Number(v ?? 0)
  updateHours(rowId, subKey, Number.isFinite(n) ? n : 0)
}

function addTeachingClassRow() {
  const base = hoursRows.value[0]
  if (!base) {
    ElMessage.warning('请先加载向导数据')
    return
  }
  const n = hoursRows.value.length + 1
  hoursRows.value.push({
    id: `cls-new-${Date.now()}`,
    class_name: `新班级${n}`,
    homeroom_teacher: '',
    subjects: base.subjects.map((s) => ({
      key: s.key,
      title: s.title,
      teacher: '',
      hours: 0,
    })),
    total_hours: 0,
  })
  ElMessage.success('已添加班级（演示），填写后可通过「保存并下一步」写入服务端')
}

async function saveAndNext() {
  if (!props.taskId) return
  saving.value = true
  try {
    if (mainStep.value === 1) {
      await putIntelligentSchedulingWizardTeachingTime(props.taskId, { ...tt.value })
      if (step1Tab.value === 'teaching_hours') {
        await putIntelligentSchedulingWizardTeachingHours(props.taskId, hoursRows.value)
      }
    }
    if (mainStep.value === 2) {
      await putIntelligentSchedulingWizardSchedulingRules(props.taskId, schedulingRules.value)
    }
    if (mainStep.value === 3) {
      await putIntelligentSchedulingWizardPreScheduling(props.taskId, preScheduling.value)
    }
    if (mainStep.value === 4) {
      await putIntelligentSchedulingWizardAutoScheduling(props.taskId, autoScheduling.value)
    }
    if (mainStep.value >= 8) {
      ElMessage.success('演示流程结束')
      emit('update:modelValue', false)
      emit('done')
      return
    }
    const next = mainStep.value + 1
    await postIntelligentSchedulingWizardStep(props.taskId, next)
    mainStep.value = next
    ElMessage.success('已保存')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.isw-embed {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 480px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.isw-embed-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.isw-close {
  padding: 4px;
  margin-right: -4px;
}
.isw-dlg-title {
  font-weight: 600;
  font-size: 16px;
}
.isw-root {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
}
.isw-sider {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--el-border-color-lighter);
  background: #fafafa;
  padding: 12px 10px;
}
.isw-guide-btn {
  width: 100%;
  margin-bottom: 12px;
}
.isw-steps {
  list-style: none;
  margin: 0;
  padding: 0;
}
.isw-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 4px;
  cursor: pointer;
  color: #606266;
  font-size: 13px;
}
.isw-step:hover {
  background: #eef5ff;
}
.isw-step--active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
.isw-step--done .isw-step-num {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.isw-step-num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  line-height: 20px;
  text-align: center;
  border: 2px solid #c0c4cc;
  border-radius: 50%;
  font-size: 12px;
}
.isw-step--active .isw-step-num {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: #fff;
}
.isw-step-txt {
  line-height: 22px;
}
.isw-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px 56px;
  overflow: auto;
}
.isw-crumb {
  font-size: 14px;
  color: #606266;
  margin-bottom: 12px;
}
.isw-crumb-div {
  margin: 0 6px;
  color: #dcdfe6;
}
.isw-crumb-task {
  color: var(--el-text-color-primary);
  font-weight: 500;
}
/* 避免 flex 子项内 el-tabs 内容区高度塌成 0，导致四个子 Tab 正文不可见 */
.isw-tabs {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.isw-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin: 0;
}
.isw-tabs :deep(.el-tabs__content) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-top: 12px;
}
.isw-toolbar-right--full {
  width: 100%;
  margin-left: 0;
  justify-content: flex-end;
}
.isw-room-tag {
  margin-right: 6px;
  margin-bottom: 4px;
}
.isw-room-tag:last-child {
  margin-right: 0;
}
.isw-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.isw-toolbar-wrap {
  flex-wrap: wrap;
}
.isw-toolbar-right {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.isw-toolbar-div {
  margin: 0 4px;
  height: 22px;
}
.isw-class-hd {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  vertical-align: middle;
}
.isw-class-add {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
}
.isw-class-add .el-icon {
  font-size: 14px;
}
.isw-block {
  margin-bottom: 14px;
}
.isw-label {
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 14px;
}
.isw-days {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.isw-periods {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
}
.isw-period-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.isw-slot-table {
  margin-top: 12px;
}
.isw-break-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-regular);
}
.isw-break-icon {
  font-size: 14px;
  color: #909399;
}
.isw-subj-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.isw-subj-t {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.isw-mt {
  margin-top: 12px;
}
.isw-subtabs {
  margin-bottom: 12px;
}
.isw-cols4 {
  display: grid;
  grid-template-columns: 1fr 1fr auto 1fr;
  gap: 12px;
  align-items: start;
}
.isw-cols3 {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 12px;
  align-items: start;
}
.isw-col {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 10px;
  min-height: 200px;
  background: #fff;
}
.isw-col-title {
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 13px;
}
.isw-col-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 140px;
}
.isw-list-item {
  padding: 6px 8px;
  font-size: 13px;
  border-radius: 4px;
}
.isw-list-item:hover {
  background: #f5f7fa;
}
.isw-mb {
  margin-bottom: 8px;
}
.isw-mini-list {
  font-size: 13px;
  color: #606266;
}
.isw-mini-row {
  padding: 8px;
  background: #f5f7fa;
  border-radius: 4px;
}
.isw-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}
.isw-footer {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 0 4px;
  text-align: center;
  background: linear-gradient(transparent, #fff 30%);
}
@media (max-width: 1200px) {
  .isw-cols4 {
    grid-template-columns: 1fr 1fr;
  }
  .isw-col-action {
    grid-column: 1 / -1;
  }
}
</style>
