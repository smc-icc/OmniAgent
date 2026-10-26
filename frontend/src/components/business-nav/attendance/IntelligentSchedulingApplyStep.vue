<template>
  <div v-loading="loading" class="isap">
    <el-steps :active="applySubStep" finish-status="success" align-center class="isap-steps">
      <el-step title="学生数据" />
      <el-step title="教师数据" />
      <el-step title="课程/教室数据" />
      <el-step title="教学时间" />
    </el-steps>

    <!-- 学生数据 -->
    <div v-show="applySubStep === 0" class="isap-panel">
      <div class="isap-row">
        <span class="isap-label">应用年级：</span>
        <el-checkbox-group v-model="student.grade_ids" @change="onGradesChange">
          <el-checkbox v-for="g in student.grade_options" :key="g.id" :value="g.id">{{ g.label }}</el-checkbox>
        </el-checkbox-group>
      </div>
      <div class="isap-row isap-row--status">
        <span class="isap-label">班级数据：</span>
        <el-tag v-if="student.validation.passed" type="success">
          <el-icon class="isap-ic"><CircleCheck /></el-icon>
          校验通过
        </el-tag>
        <el-tag v-else type="danger">校验未通过</el-tag>
        <span class="isap-msg">{{ student.validation.message }}</span>
      </div>
      <el-tabs v-if="visibleGradeLabels.length" v-model="mapTab" type="card" class="isap-tabs">
        <el-tab-pane v-for="gl in visibleGradeLabels" :key="gl" :label="gl" :name="gl">
          <el-table :data="student.mappings_by_grade[gl] || []" border size="small">
            <el-table-column prop="schedule_class_label" label="课表班级" width="100" />
            <el-table-column label="同步至" width="64" align="center">&gt;&gt;</el-table-column>
            <el-table-column label="基础信息班级" min-width="220">
              <template #default="{ row }">
                <el-select v-model="row.basic_class_id" size="small" style="width: 100%" @change="flushStudent">
                  <el-option v-for="o in row.options" :key="o.id" :label="o.label" :value="o.id" />
                </el-select>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <el-empty v-else description="请先勾选应用年级" :image-size="64" />
      <div class="isap-actions">
        <el-button type="primary" @click="nextFromStudent">下一步</el-button>
      </div>
    </div>

    <!-- 教师数据 -->
    <div v-show="applySubStep === 1" class="isap-panel">
      <div class="isap-section-title">教师数据：</div>
      <el-tag type="success" class="isap-mb">
        <el-icon class="isap-ic"><CircleCheck /></el-icon>
        匹配通过
      </el-tag>
      <div class="isap-section-title">教师规则：</div>
      <div class="isap-switch-row">
        <span>是否应用课表内的「教研不排课标签」到日程管理中</span>
        <el-switch v-model="teacher.research_tag_sync" />
      </div>
      <ol class="isap-ol">
        <li>开启后，默认同步至首年级的常规作息节次。</li>
        <li>调代课时将按已同步的日程判断教师空档。</li>
        <li>将全量更新此前已应用的规则。</li>
        <li>若教师被挪至原标注为教研的时段，将给出提示。</li>
      </ol>
      <div class="isap-actions">
        <el-button @click="goSub(0)">上一步</el-button>
        <el-button type="primary" @click="nextFromTeacher">下一步</el-button>
      </div>
    </div>

    <!-- 课程/教室 -->
    <div v-show="applySubStep === 2" class="isap-panel">
      <div class="isap-section-title">课程数据</div>
      <el-tag type="success" class="isap-mb">
        <el-icon class="isap-ic"><CircleCheck /></el-icon>
        匹配通过
      </el-tag>
      <p class="isap-p">{{ courseRoom.course_message }}</p>
      <div class="isap-switch-row">
        <span>将不排课标签（如「选修」）应用到课表，生成无教师任教的课程</span>
        <el-switch v-model="courseRoom.elective_label_to_timetable" />
      </div>
      <el-divider />
      <div class="isap-section-title">教室数据</div>
      <el-tag type="success" class="isap-mb">
        <el-icon class="isap-ic"><CircleCheck /></el-icon>
        匹配通过
      </el-tag>
      <p class="isap-p">{{ courseRoom.room_message }}</p>
      <div class="isap-actions">
        <el-button @click="goSub(1)">上一步</el-button>
        <el-button type="primary" @click="nextFromCourseRoom">下一步</el-button>
      </div>
    </div>

    <!-- 教学时间 -->
    <div v-show="applySubStep === 3" class="isap-panel">
      <div class="isap-section-title">课表日期</div>
      <div class="isap-dates">
        <el-date-picker
          v-model="dateStart"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="开始日期"
          size="default"
        />
        <span class="isap-to">至</span>
        <el-date-picker
          v-model="dateEnd"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="结束日期"
          size="default"
        />
      </div>
      <el-alert
        type="warning"
        :closable="false"
        class="isap-mb"
        title="大量数据应用耗时较长，请耐心等待；若失败或卡住，可尝试缩短日期范围。"
        show-icon
      />
      <div class="isap-row isap-row--status">
        <el-tag v-if="teachingTime.match_passed" type="success">
          <el-icon class="isap-ic"><CircleCheck /></el-icon>
          匹配通过
        </el-tag>
        <span class="isap-msg">请确认各排课节次已对应作息时间节次并维护起止时间。</span>
        <el-button type="primary" link size="small" @click="ElMessage.info('演示：跳转作息节次配置')">
          去添加/修改节次
        </el-button>
      </div>
      <el-table :data="teachingTime.period_rows" border size="small" max-height="320">
        <el-table-column prop="section" label="时段" width="72" />
        <el-table-column label="排课任务节次" width="120" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.enabled" size="small">第{{ row.task_period }}节</el-checkbox>
          </template>
        </el-table-column>
        <el-table-column label="课程同步" width="64" align="center">&gt;&gt;</el-table-column>
        <el-table-column label="作息时间节次" min-width="120">
          <template #default="{ row }">
            <el-select v-model="row.target_period_id" size="small" style="width: 100%">
              <el-option
                v-for="o in teachingTime.target_period_options"
                :key="o.id"
                :label="o.label"
                :value="o.id"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="节次起止时间" min-width="200">
          <template #default="{ row }">
            <div class="isap-time">初中部 {{ row.time_junior }}</div>
            <div class="isap-time isap-time--sec">小学部 {{ row.time_primary }}</div>
          </template>
        </el-table-column>
      </el-table>
      <div class="isap-switch-row isap-mt">
        <div>
          <div class="isap-nb">是否通知老师</div>
          <div class="isap-sub">任课教师将收到「学校课表已发布」通知，点击可查看最新课表。</div>
        </div>
        <el-switch v-model="teachingTime.notify_teachers" />
      </div>
      <div class="isap-actions">
        <el-button @click="goSub(2)">上一步</el-button>
        <el-button type="primary" :loading="confirming" @click="confirmApply">确定应用</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CircleCheck } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import {
  type ApplyStudentMappingRow,
  type ScheduleApplyState,
  fetchIntelligentSchedulingWizardScheduleApply,
  postIntelligentSchedulingWizardScheduleApplyConfirm,
  putIntelligentSchedulingWizardScheduleApplyCourseRoom,
  putIntelligentSchedulingWizardScheduleApplyStudent,
  putIntelligentSchedulingWizardScheduleApplySubStep,
  putIntelligentSchedulingWizardScheduleApplyTeacher,
  putIntelligentSchedulingWizardScheduleApplyTeachingTime,
} from '@/api/intelligentScheduling'

const GID_TO_LABEL: Record<string, string> = {
  g6: '六年级',
  g7: '七年级',
  g8: '八年级',
  g9: '九年级',
}

const props = defineProps<{ taskId: string }>()
const emit = defineEmits<{ finished: [] }>()

const loading = ref(false)
const confirming = ref(false)
const applySubStep = ref(0)
const mapTab = ref('')

const student = ref<ScheduleApplyState['student']>({
  grade_ids: [],
  grade_options: [],
  validation: {
    passed: true,
    schedule_admin_classes: 0,
    matched_same_name: 0,
    message: '',
  },
  mappings_by_grade: {},
})

const teacher = ref<ScheduleApplyState['teacher']>({
  match_passed: true,
  research_tag_sync: false,
})

const courseRoom = ref<ScheduleApplyState['course_room']>({
  course_match_passed: true,
  course_total: 0,
  course_matched: 0,
  elective_label_to_timetable: false,
  course_message: '',
  room_match_passed: true,
  room_total: 0,
  room_matched: 0,
  room_message: '',
})

const teachingTime = ref<ScheduleApplyState['teaching_time']>({
  match_passed: true,
  date_start: '',
  date_end: '',
  notify_teachers: true,
  period_rows: [],
  target_period_options: [],
})

const dateStart = ref('')
const dateEnd = ref('')

const visibleGradeLabels = computed(() => {
  const labels = student.value.grade_ids.map((id) => GID_TO_LABEL[id]).filter(Boolean)
  return labels.filter((l) => (student.value.mappings_by_grade[l] || []).length > 0)
})

watch(visibleGradeLabels, (labs) => {
  if (labs.length && !labs.includes(mapTab.value)) {
    mapTab.value = labs[0]!
  }
})

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

async function load() {
  if (!props.taskId) return
  loading.value = true
  try {
    const d = await fetchIntelligentSchedulingWizardScheduleApply(props.taskId)
    applySubStep.value = d.apply_sub_step
    student.value = deepClone(d.student)
    teacher.value = deepClone(d.teacher)
    courseRoom.value = deepClone(d.course_room)
    teachingTime.value = deepClone(d.teaching_time)
    dateStart.value = d.teaching_time.date_start
    dateEnd.value = d.teaching_time.date_end
    const labs = visibleGradeLabels.value
    if (labs.length) mapTab.value = labs[0]!
  } catch {
    ElMessage.error('加载课表应用数据失败')
  } finally {
    loading.value = false
  }
}

async function flushStudent() {
  if (!props.taskId) return
  try {
    const r = await putIntelligentSchedulingWizardScheduleApplyStudent(props.taskId, {
      grade_ids: student.value.grade_ids,
      mappings_by_grade: student.value.mappings_by_grade as Record<string, ApplyStudentMappingRow[]>,
    })
    student.value = r.student
  } catch {
    ElMessage.error('保存班级映射失败')
  }
}

async function onGradesChange() {
  await flushStudent()
}

async function goSub(n: number) {
  if (!props.taskId) return
  await putIntelligentSchedulingWizardScheduleApplySubStep(props.taskId, n)
  applySubStep.value = n
}

async function nextFromStudent() {
  if (!props.taskId) return
  await flushStudent()
  await putIntelligentSchedulingWizardScheduleApplySubStep(props.taskId, 1)
  applySubStep.value = 1
}

async function nextFromTeacher() {
  if (!props.taskId) return
  const r = await putIntelligentSchedulingWizardScheduleApplyTeacher(props.taskId, {
    research_tag_sync: teacher.value.research_tag_sync,
  })
  teacher.value = r.teacher
  await putIntelligentSchedulingWizardScheduleApplySubStep(props.taskId, 2)
  applySubStep.value = 2
}

async function nextFromCourseRoom() {
  if (!props.taskId) return
  const r = await putIntelligentSchedulingWizardScheduleApplyCourseRoom(props.taskId, {
    elective_label_to_timetable: courseRoom.value.elective_label_to_timetable,
  })
  courseRoom.value = r.course_room
  await putIntelligentSchedulingWizardScheduleApplySubStep(props.taskId, 3)
  applySubStep.value = 3
}

async function confirmApply() {
  if (!props.taskId) return
  confirming.value = true
  try {
    const tr = await putIntelligentSchedulingWizardScheduleApplyTeachingTime(props.taskId, {
      date_start: dateStart.value,
      date_end: dateEnd.value,
      notify_teachers: teachingTime.value.notify_teachers,
      period_rows: teachingTime.value.period_rows,
    })
    teachingTime.value = tr.teaching_time
    const r = await postIntelligentSchedulingWizardScheduleApplyConfirm(props.taskId)
    ElMessage.success(r.message)
    emit('finished')
  } catch {
    ElMessage.error('应用失败')
  } finally {
    confirming.value = false
  }
}

watch(
  () => props.taskId,
  () => {
    void load()
  },
)

onMounted(() => {
  void load()
})
</script>

<style scoped>
.isap {
  min-height: 420px;
}
.isap-steps {
  margin-bottom: 20px;
}
.isap-panel {
  padding: 0 8px 12px;
}
.isap-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.isap-row--status {
  align-items: flex-start;
}
.isap-label {
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
}
.isap-msg {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex: 1;
  min-width: 200px;
}
.isap-tabs {
  margin-top: 8px;
}
.isap-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
.isap-section-title {
  font-weight: 600;
  margin: 8px 0 10px;
}
.isap-mb {
  margin-bottom: 10px;
}
.isap-ic {
  vertical-align: middle;
  margin-right: 4px;
}
.isap-switch-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 12px 0;
  font-size: 13px;
}
.isap-ol {
  margin: 0 0 12px 1.2em;
  padding: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.isap-p {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin: 0 0 12px;
}
.isap-dates {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.isap-to {
  color: var(--el-text-color-secondary);
}
.isap-time {
  font-size: 12px;
}
.isap-time--sec {
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
.isap-mt {
  margin-top: 16px;
}
.isap-nb {
  font-weight: 500;
}
.isap-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
</style>
