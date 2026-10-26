<template>
  <div class="isr">
    <div class="isr-toolbar">
      <el-tabs v-model="resultTab" class="isr-tabs" @tab-change="onTabChange">
        <el-tab-pane label="班级课表" name="class" />
        <el-tab-pane label="教师课表" name="teacher" />
        <el-tab-pane label="教室课表" name="room" />
        <el-tab-pane label="总课表" name="general" />
      </el-tabs>
      <div class="isr-toolbar-right">
        <template v-if="resultTab === 'class'">
          <span class="isr-sw">显示教室</span>
          <el-switch v-model="classView.show_room" size="small" @change="pushClassDisplay" />
          <span class="isr-sw">显示教师</span>
          <el-switch v-model="classView.show_teacher" size="small" @change="pushClassDisplay" />
          <span class="isr-sw">课程简称</span>
          <el-switch v-model="classView.subject_short" size="small" @change="pushClassDisplay" />
          <span class="isr-sw">课程区分</span>
          <el-switch v-model="classView.course_distinction" size="small" @change="pushClassDisplay" />
        </template>
        <template v-else-if="resultTab === 'teacher'">
          <span class="isr-sw">显示教室</span>
          <el-switch v-model="teacherView.show_room" size="small" @change="pushTeacherDisplay" />
          <span class="isr-sw">显示科目</span>
          <el-switch v-model="teacherView.show_subject" size="small" @change="pushTeacherDisplay" />
          <span class="isr-sw">带班课程区分</span>
          <el-switch
            v-model="teacherView.class_course_distinction"
            size="small"
            @change="pushTeacherDisplay"
          />
        </template>
        <template v-else-if="resultTab === 'general'">
          <span class="isr-sw">显示教室</span>
          <el-switch v-model="generalView.show_room" size="small" @change="pushGeneralDisplay" />
          <span class="isr-sw">显示教师</span>
          <el-switch v-model="generalView.show_teacher" size="small" @change="pushGeneralDisplay" />
        </template>
        <template v-else>
          <span class="isr-sw">课程区分</span>
          <el-switch v-model="classView.course_distinction" size="small" @change="pushClassDisplay" />
        </template>
        <el-button type="primary" size="small" :loading="exporting" @click="onExport">
          导出课表
        </el-button>
      </div>
    </div>

    <div v-loading="loading" class="isr-body">
      <aside v-if="resultTab !== 'general'" class="isr-sider">
        <el-input
          v-if="resultTab === 'teacher'"
          v-model="sideFilter"
          placeholder="教师名称"
          clearable
          size="small"
          class="isr-filter"
        />
        <el-scrollbar max-height="calc(100vh - 320px)">
          <el-tree
            v-if="resultTab === 'class'"
            ref="classTreeRef"
            :data="classTree"
            :props="{ label: 'label', children: 'children' }"
            node-key="id"
            highlight-current
            default-expand-all
            @node-click="onClassNode"
          />
          <div v-else-if="resultTab === 'teacher'" class="isr-list">
            <div
              v-for="t in filteredTeachers"
              :key="t.id"
              :class="['isr-li', { 'isr-li--on': t.id === selectedTeacherId }]"
              @click="selectTeacher(t.id)"
            >
              {{ t.label }}
            </div>
          </div>
          <el-tree
            v-else
            ref="roomTreeRef"
            :data="roomTree"
            :props="{ label: 'label', children: 'children' }"
            node-key="id"
            highlight-current
            default-expand-all
            @node-click="onRoomNode"
          />
        </el-scrollbar>
      </aside>

      <div class="isr-main">
        <div v-if="resultTab !== 'general'" class="isr-title">{{ gridTitle }}</div>
        <ScheduleResultTimetableGrid
          v-if="resultTab !== 'general'"
          :day-names="dayLabels"
          :period-layout="periodLayoutEff"
          :cells="gridCells"
          :mode="gridMode"
          :class-display="classView"
          :teacher-display="teacherView"
        />
        <ScheduleResultGeneralGrid
          v-else
          :day-labels="generalData.day_labels"
          :periods="generalData.periods"
          :classes="generalData.classes"
          :cells="generalData.cells"
          :display="generalView"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  type ScheduleResultCell,
  type ScheduleResultClassViewDisplay,
  type ScheduleResultGeneralViewDisplay,
  type ScheduleResultPeriodRow,
  type ScheduleResultTeacherViewDisplay,
  fetchIntelligentSchedulingWizardScheduleResult,
  fetchIntelligentSchedulingWizardScheduleResultGeneral,
  fetchIntelligentSchedulingWizardScheduleResultTimetable,
  postIntelligentSchedulingWizardScheduleResultExport,
  putIntelligentSchedulingWizardScheduleResultDisplay,
  putIntelligentSchedulingWizardScheduleResultTab,
} from '@/api/intelligentScheduling'
import ScheduleResultGeneralGrid from './ScheduleResultGeneralGrid.vue'
import ScheduleResultTimetableGrid from './ScheduleResultTimetableGrid.vue'

const props = defineProps<{
  taskId: string
  dayLabels: string[]
}>()

const loading = ref(false)
const exporting = ref(false)
const resultTab = ref<'class' | 'teacher' | 'room' | 'general'>('class')

const classTree = ref<{ id: string; label: string; children?: { id: string; label: string }[] }[]>([])
const teacherList = ref<{ id: string; label: string }[]>([])
const roomTree = ref<{ id: string; label: string; children?: { id: string; label: string; is_room?: boolean }[] }[]>(
  [],
)

const periodLayout = ref<ScheduleResultPeriodRow[]>([])
const classView = ref<ScheduleResultClassViewDisplay>({
  show_room: false,
  show_teacher: true,
  subject_short: false,
  course_distinction: true,
})
const teacherView = ref<ScheduleResultTeacherViewDisplay>({
  show_room: false,
  show_subject: true,
  class_course_distinction: true,
})
const generalView = ref<ScheduleResultGeneralViewDisplay>({
  show_room: true,
  show_teacher: true,
})

const selectedClassId = ref('')
const selectedTeacherId = ref('')
const selectedRoomId = ref('')

const gridTitle = ref('')
const gridCells = ref<Record<string, ScheduleResultCell | undefined>>({})
const generalData = ref({
  day_labels: [] as string[],
  periods: [] as number[],
  classes: [] as { id: string; name: string }[],
  cells: {} as Record<string, ScheduleResultCell | null | undefined>,
})

const sideFilter = ref('')
const classTreeRef = ref<{ filter: (v: string) => void; setCurrentKey?: (k: string) => void } | null>(null)
const roomTreeRef = ref<{ setCurrentKey?: (k: string) => void } | null>(null)

const DEFAULT_LAYOUT: ScheduleResultPeriodRow[] = [
  { kind: 'lesson', period_no: 1, time_range: '' },
  { kind: 'lesson', period_no: 2, time_range: '' },
  { kind: 'break', label: '大课间', time_range: '' },
  { kind: 'lesson', period_no: 3, time_range: '' },
  { kind: 'lesson', period_no: 4, time_range: '' },
  { kind: 'lesson', period_no: 5, time_range: '' },
  { kind: 'break', label: '午休', time_range: '' },
  { kind: 'lesson', period_no: 6, time_range: '' },
  { kind: 'lesson', period_no: 7, time_range: '' },
  { kind: 'lesson', period_no: 8, time_range: '' },
  { kind: 'lesson', period_no: 9, time_range: '' },
]

const dayLabels = computed(() =>
  props.dayLabels.length ? props.dayLabels : ['周一', '周二', '周三', '周四', '周五'],
)

const periodLayoutEff = computed(() =>
  periodLayout.value.length > 0 ? periodLayout.value : DEFAULT_LAYOUT,
)

const gridMode = computed((): 'class' | 'teacher' | 'room' => {
  if (resultTab.value === 'teacher') return 'teacher'
  if (resultTab.value === 'room') return 'room'
  return 'class'
})

const filteredTeachers = computed(() => {
  const q = sideFilter.value.trim().toLowerCase()
  if (!q) return teacherList.value
  return teacherList.value.filter((t) => t.label.toLowerCase().includes(q))
})

function onClassNode(data: { id: string; children?: unknown[] }) {
  if (data.children && data.children.length > 0) return
  selectedClassId.value = data.id
  void loadGridTimetable()
}

function selectTeacher(id: string) {
  selectedTeacherId.value = id
  void loadGridTimetable()
}

function onRoomNode(data: { id: string; is_room?: boolean; children?: unknown[] }) {
  if (!data.is_room) return
  selectedRoomId.value = data.id
  void loadGridTimetable()
}

async function loadMeta() {
  if (!props.taskId) return
  loading.value = true
  try {
    const m = await fetchIntelligentSchedulingWizardScheduleResult(props.taskId)
    periodLayout.value = m.period_layout
    resultTab.value = m.result_tab
    classView.value = { ...classView.value, ...m.class_view }
    teacherView.value = { ...teacherView.value, ...m.teacher_view }
    generalView.value = { ...generalView.value, ...m.general_view }
    classTree.value = m.class_tree
    teacherList.value = m.teacher_list
    roomTree.value = m.room_tree

    if (!selectedClassId.value && m.class_tree[0]?.children?.[0]) {
      selectedClassId.value = m.class_tree[0].children[0].id
    }
    if (!selectedTeacherId.value && m.teacher_list[0]) {
      selectedTeacherId.value = m.teacher_list[0].id
    }
    const firstRoom = m.room_tree[0]?.children?.find((c) => c.is_room)
    if (!selectedRoomId.value && firstRoom) {
      selectedRoomId.value = firstRoom.id
    }

    await loadCurrentTimetable()
    await nextTick()
    if (resultTab.value === 'class' && selectedClassId.value) {
      classTreeRef.value?.setCurrentKey?.(selectedClassId.value)
    }
    if (resultTab.value === 'room' && selectedRoomId.value) {
      roomTreeRef.value?.setCurrentKey?.(selectedRoomId.value)
    }
  } catch {
    ElMessage.error('加载课表结果失败')
  } finally {
    loading.value = false
  }
}

async function loadGridTimetable() {
  if (!props.taskId) return
  if (resultTab.value === 'general') return
  const kind = gridMode.value
  const id =
    kind === 'class' ? selectedClassId.value : kind === 'teacher' ? selectedTeacherId.value : selectedRoomId.value
  if (!id) return
  try {
    const r = await fetchIntelligentSchedulingWizardScheduleResultTimetable(props.taskId, kind, id)
    gridTitle.value = r.title
    gridCells.value = r.cells
  } catch {
    ElMessage.error('加载课表失败')
  }
}

async function loadGeneral() {
  if (!props.taskId) return
  try {
    const r = await fetchIntelligentSchedulingWizardScheduleResultGeneral(props.taskId)
    generalData.value = {
      day_labels: r.day_labels,
      periods: r.periods,
      classes: r.classes,
      cells: r.cells,
    }
  } catch {
    ElMessage.error('加载总课表失败')
  }
}

async function loadCurrentTimetable() {
  if (resultTab.value === 'general') {
    await loadGeneral()
  } else {
    await loadGridTimetable()
  }
}

async function onTabChange(name: string | number) {
  const tab = String(name) as typeof resultTab.value
  resultTab.value = tab
  if (props.taskId) {
    try {
      await putIntelligentSchedulingWizardScheduleResultTab(props.taskId, tab)
    } catch {
      /* ignore */
    }
  }
  await loadCurrentTimetable()
}

async function pushClassDisplay() {
  if (!props.taskId) return
  try {
    const r = await putIntelligentSchedulingWizardScheduleResultDisplay(props.taskId, {
      class_view: { ...classView.value },
    })
    classView.value = r.class_view
  } catch {
    ElMessage.error('保存显示选项失败')
  }
}

async function pushTeacherDisplay() {
  if (!props.taskId) return
  try {
    const r = await putIntelligentSchedulingWizardScheduleResultDisplay(props.taskId, {
      teacher_view: { ...teacherView.value },
    })
    teacherView.value = r.teacher_view
  } catch {
    ElMessage.error('保存显示选项失败')
  }
}

async function pushGeneralDisplay() {
  if (!props.taskId) return
  try {
    const r = await putIntelligentSchedulingWizardScheduleResultDisplay(props.taskId, {
      general_view: { ...generalView.value },
    })
    generalView.value = r.general_view
  } catch {
    ElMessage.error('保存显示选项失败')
  }
}

async function onExport() {
  if (!props.taskId) return
  exporting.value = true
  try {
    const r = await postIntelligentSchedulingWizardScheduleResultExport(props.taskId, {
      tab: resultTab.value,
    })
    ElMessage.success(r.message)
    const blob = new Blob([`${r.filename}\n${r.message}`], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '课表导出说明.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch {
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

watch(
  () => props.taskId,
  () => {
    void loadMeta()
  },
)

onMounted(() => {
  void loadMeta()
})
</script>

<style scoped>
.isr {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 440px;
}
.isr-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.isr-tabs {
  flex: 1;
  min-width: 280px;
}
.isr-tabs :deep(.el-tabs__header) {
  margin: 0;
}
.isr-toolbar-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.isr-sw {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-left: 4px;
}
.isr-body {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 320px;
}
.isr-sider {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 8px;
  background: #fafafa;
}
.isr-filter {
  margin-bottom: 8px;
}
.isr-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.isr-li {
  padding: 8px 10px;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;
}
.isr-li:hover {
  background: var(--el-fill-color-light);
}
.isr-li--on {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-left: 3px solid var(--el-color-primary);
}
.isr-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.isr-title {
  font-weight: 600;
  font-size: 15px;
  text-align: center;
  margin-bottom: 10px;
}
</style>
