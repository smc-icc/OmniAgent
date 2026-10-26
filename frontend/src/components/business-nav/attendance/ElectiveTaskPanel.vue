<template>
  <div class="etp">
    <template v-if="!createMode">
      <header class="etp-hd">
        <h2 class="etp-title">选课任务</h2>
        <div class="etp-f">
          <el-select v-model="campusId" style="width: 240px" @change="loadTasks">
            <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-select v-model="termId" style="width: 240px" @change="loadTasks">
            <el-option v-for="t in meta?.terms ?? []" :key="t.id" :label="t.label" :value="t.id" />
          </el-select>
          <el-button type="primary" @click="openCreate">新建选课</el-button>
        </div>
      </header>
      <el-table :data="tasks" border stripe size="small">
        <el-table-column type="index" label="序号" width="70" />
        <el-table-column prop="name" label="选课任务名称" min-width="180" />
        <el-table-column label="校区名称" width="180">
          <template #default>{{ campusName }}</template>
        </el-table-column>
        <el-table-column label="参与年级" width="180">
          <template #default="{ row }">{{ (row.grade_labels || []).join('、') || '—' }}</template>
        </el-table-column>
        <el-table-column label="起止时间" min-width="220">
          <template #default="{ row }">{{ row.start_at }} ~ {{ row.end_at }}</template>
        </el-table-column>
        <el-table-column prop="status_label" label="当前状态" width="100" />
        <el-table-column prop="selected_count" label="选课人数" width="90" />
        <el-table-column prop="publish_status" label="发布状态" width="100" />
        <el-table-column label="操作" width="110">
          <template #default="{ row }"><el-button link type="primary" @click="editTask(row.id)">查看/编辑</el-button></template>
        </el-table-column>
      </el-table>
    </template>

    <template v-else>
      <div class="etp-crumb">新建选课任务 / 选课任务 / 新建选课任务</div>
      <!-- 自绘步骤条：数字圆 + 标题整块可点（el-steps 的圆点不在 #title 里，点数字不会触发） -->
      <div class="etp-stepbar" role="tablist" aria-label="新建选课任务步骤">
        <button
          type="button"
          class="etp-stepbar-item"
          :class="{ 'etp-stepbar-item--active': step === 1, 'etp-stepbar-item--done': step > 1 }"
          @click="goStep(1)"
        >
          <span class="etp-stepbar-num">1</span>
          <span class="etp-stepbar-txt">基本信息</span>
        </button>
        <span class="etp-stepbar-line" aria-hidden="true" />
        <button
          type="button"
          class="etp-stepbar-item"
          :class="{ 'etp-stepbar-item--active': step === 2, 'etp-stepbar-item--done': step > 2 }"
          @click="goStep(2)"
        >
          <span class="etp-stepbar-num">2</span>
          <span class="etp-stepbar-txt">学生选课限制</span>
        </button>
        <span class="etp-stepbar-line" aria-hidden="true" />
        <button
          type="button"
          class="etp-stepbar-item"
          :class="{ 'etp-stepbar-item--active': step === 3 }"
          @click="goStep(3)"
        >
          <span class="etp-stepbar-num">3</span>
          <span class="etp-stepbar-txt">课程设置</span>
        </button>
      </div>

      <div v-show="step === 1" class="etp-step">
        <el-form label-position="top" class="etp-form">
          <el-form-item label="当前学期"><el-input :model-value="termLabel" readonly /></el-form-item>
          <el-form-item label="选择校区"><el-radio-group v-model="taskForm.campus_id"><el-radio :value="campusId">{{ campusName }}</el-radio></el-radio-group></el-form-item>
          <el-form-item label="选课年级"><el-select v-model="taskForm.grade_ids" multiple style="width: 360px"><el-option v-for="g in meta?.grade_options ?? []" :key="g.id" :label="g.label" :value="g.id" /></el-select></el-form-item>
          <el-form-item label="任务名称"><el-input v-model="taskForm.name" maxlength="20" show-word-limit style="width: 360px" /></el-form-item>
          <el-form-item label="选课时间"><el-date-picker v-model="timeRange" type="datetimerange" value-format="YYYY-MM-DD HH:mm:ss" style="width: 460px" /></el-form-item>
          <el-form-item label="选课说明"><el-input v-model="taskForm.description" type="textarea" :rows="3" maxlength="300" show-word-limit style="width: 460px" /></el-form-item>
          <el-form-item label="退改开关">
            <el-switch v-model="taskForm.switch_select" active-text="开启后允许学生选课" />
            <el-switch v-model="taskForm.switch_drop" active-text="开启后允许学生退选" style="margin-left: 16px" />
          </el-form-item>
          <el-form-item label="选课进度隐藏"><el-switch v-model="taskForm.switch_progress_lock" /></el-form-item>
        </el-form>
        <div class="etp-foot"><el-button type="primary" @click="saveStep1">保存并下一步</el-button></div>
      </div>

      <div v-show="step === 2" class="etp-step">
        <el-form label-position="top" class="etp-form">
          <el-form-item label="学生选课数限制">
            每位参与本次选课的学生最少可以选
            <el-input-number v-model="taskForm.min_pick" :min="0" :max="10" />
            门课，最多可以选
            <el-input-number v-model="taskForm.max_pick" :min="1" :max="20" />
            门课。
          </el-form-item>
          <el-form-item label="总课时限制"><el-switch v-model="taskForm.limit_total_periods" /></el-form-item>
          <el-form-item label="同类型课程限制"><el-switch v-model="taskForm.limit_same_course_count" /></el-form-item>
        </el-form>
        <div class="etp-foot"><el-button type="primary" @click="saveStep2">保存并下一步</el-button></div>
      </div>

      <div v-show="step === 3" class="etp-step">
        <el-alert
          v-if="!currentTaskId"
          type="info"
          :closable="false"
          show-icon
          class="etp-alert"
          title="尚未保存「基本信息」时也可预览本页；保存第 1 步后，方可添加课程与导入导出。"
        />
        <div class="etp-cf">
          <el-input v-model="courseFilters.course_name" placeholder="课程名称" style="width: 140px" />
          <el-input v-model="courseFilters.teacher_name" placeholder="任课老师" style="width: 140px" />
          <el-select v-model="courseFilters.course_type" placeholder="课程类型" style="width: 140px" clearable>
            <el-option v-for="x in meta?.course_type_options ?? []" :key="x.value" :label="x.label" :value="x.value" />
          </el-select>
          <el-select v-model="courseFilters.open_status" placeholder="是否开放选课" style="width: 140px" clearable>
            <el-option label="开放" value="open" />
            <el-option label="不开放" value="closed" />
          </el-select>
          <el-button type="primary" @click="loadCourses">查询</el-button>
        </div>
        <div class="etp-ca">
          <el-button type="primary" @click="openAddCourse">新增课程</el-button>
          <el-button @click="doExport('import')">导入课程</el-button>
          <el-button @click="doExport('export')">导出课程</el-button>
          <el-button type="primary" plain @click="doExport('copy')">复用课程</el-button>
        </div>
        <el-table :data="courses" border stripe size="small">
          <el-table-column prop="course_name" label="课程名称" min-width="140" />
          <el-table-column prop="course_code" label="课程编号" width="120" />
          <el-table-column prop="course_type" label="课程类型" width="100" />
          <el-table-column prop="topic_class_name" label="兴趣班名称" width="120" />
          <el-table-column prop="teacher_name" label="任课教师" width="100" />
          <el-table-column label="可选年级" width="140"><template #default="{ row }">{{ (row.grade_labels || []).join('、') }}</template></el-table-column>
          <el-table-column prop="max_students" label="课程人数上限" width="110" />
          <el-table-column prop="period_time" label="上课时间" width="130" />
          <el-table-column label="是否开放选课" width="110"><template #default="{ row }">{{ row.open_status ? '开放' : '不开放' }}</template></el-table-column>
        </el-table>
      </div>
    </template>

    <el-drawer v-model="courseDrawer" title="新增课程" size="380px">
      <el-form label-position="top">
        <el-form-item label="课程名称"><el-input v-model="courseForm.course_name" maxlength="30" show-word-limit /></el-form-item>
        <el-form-item label="课程编号"><el-input v-model="courseForm.course_code" maxlength="20" show-word-limit /></el-form-item>
        <el-form-item label="课程类型"><el-select v-model="courseForm.course_type"><el-option v-for="x in meta?.course_type_options ?? []" :key="x.value" :label="x.label" :value="x.value" /></el-select></el-form-item>
        <el-form-item label="兴趣班名称"><el-input v-model="courseForm.topic_class_name" maxlength="20" show-word-limit /></el-form-item>
        <el-form-item label="任课教师"><el-input v-model="courseForm.teacher_name" /></el-form-item>
        <el-form-item label="可选年级"><el-select v-model="courseForm.grade_ids" multiple><el-option v-for="g in meta?.grade_options ?? []" :key="g.id" :label="g.label" :value="g.id" /></el-select></el-form-item>
        <el-form-item label="课程人数"><el-input-number v-model="courseForm.max_students" :min="0" /></el-form-item>
        <el-form-item label="上课教室"><el-input v-model="courseForm.period_plan" /></el-form-item>
        <el-form-item label="上课时间"><el-input v-model="courseForm.period_time" /></el-form-item>
        <el-form-item label="单个行政班选课门课人数上限"><el-input-number v-model="courseForm.per_admin_class_limit" :min="0" /></el-form-item>
        <el-form-item label="是否开放选课"><el-radio-group v-model="courseForm.open_status"><el-radio :value="true">开放</el-radio><el-radio :value="false">不开放</el-radio></el-radio-group></el-form-item>
        <el-form-item label="性别限制"><el-radio-group v-model="courseForm.gender_limit"><el-radio v-for="g in meta?.gender_options ?? []" :key="g.value" :value="g.value">{{ g.label }}</el-radio></el-radio-group></el-form-item>
        <el-form-item label="课程描述"><el-input v-model="courseForm.description" type="textarea" :rows="3" maxlength="1000" show-word-limit /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="courseDrawer = false">取消</el-button>
        <el-button type="primary" @click="submitCourse">确定</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchElectiveCourses,
  fetchElectiveTaskMeta,
  fetchElectiveTasks,
  getElectiveExport,
  patchElectiveTask,
  postElectiveCourse,
  postElectiveTask,
  fetchElectiveTaskDetail,
} from '@/api/electiveTask'

const meta = ref<Awaited<ReturnType<typeof fetchElectiveTaskMeta>> | null>(null)
const campusId = ref('')
const termId = ref('')
const tasks = ref<any[]>([])

const createMode = ref(false)
const step = ref(1)
const currentTaskId = ref('')
const timeRange = ref<[string, string] | null>(null)
const taskForm = ref({
  campus_id: '',
  term_id: '',
  grade_ids: [] as string[],
  name: '',
  start_at: '',
  end_at: '',
  description: '',
  switch_select: true,
  switch_drop: true,
  switch_progress_lock: false,
  min_pick: 1,
  max_pick: 2,
  limit_total_periods: false,
  limit_same_course_count: false,
})

const courses = ref<any[]>([])
const courseFilters = ref({ course_name: '', teacher_name: '', course_type: '', open_status: '' })
const courseDrawer = ref(false)
const courseForm = ref({
  course_name: '',
  course_code: '',
  course_type: '',
  topic_class_name: '',
  teacher_name: '',
  grade_ids: [] as string[],
  max_students: 0,
  period_plan: '',
  period_time: '',
  per_admin_class_limit: 0,
  open_status: true,
  gender_limit: '不限',
  description: '',
})

const campusName = computed(() => meta.value?.campuses.find((x) => x.id === campusId.value)?.name ?? '')
const termLabel = computed(() => meta.value?.terms.find((x) => x.id === termId.value)?.label ?? '')

async function loadTasks() {
  if (!campusId.value || !termId.value) return
  tasks.value = await fetchElectiveTasks(campusId.value, termId.value)
}

function openCreate() {
  createMode.value = true
  step.value = 1
  currentTaskId.value = ''
  taskForm.value = {
    campus_id: campusId.value,
    term_id: termId.value,
    grade_ids: [],
    name: '',
    start_at: '',
    end_at: '',
    description: '',
    switch_select: true,
    switch_drop: true,
    switch_progress_lock: false,
    min_pick: 1,
    max_pick: 2,
    limit_total_periods: false,
    limit_same_course_count: false,
  }
  timeRange.value = null
}

async function editTask(id: string) {
  openCreate()
  const row = await fetchElectiveTaskDetail(id)
  currentTaskId.value = id
  taskForm.value = {
    campus_id: row.campus_id,
    term_id: row.term_id,
    grade_ids: row.grade_ids || [],
    name: row.name || '',
    start_at: row.start_at || '',
    end_at: row.end_at || '',
    description: row.description || '',
    switch_select: !!row.switch_select,
    switch_drop: !!row.switch_drop,
    switch_progress_lock: !!row.switch_progress_lock,
    min_pick: row.min_pick ?? 1,
    max_pick: row.max_pick ?? 2,
    limit_total_periods: !!row.limit_total_periods,
    limit_same_course_count: !!row.limit_same_course_count,
  }
  timeRange.value = row.start_at && row.end_at ? [row.start_at, row.end_at] : null
}

async function saveStep1() {
  if (!taskForm.value.name.trim()) return ElMessage.warning('请填写任务名称')
  if (!timeRange.value) return ElMessage.warning('请选择选课时间')
  taskForm.value.start_at = timeRange.value[0]
  taskForm.value.end_at = timeRange.value[1]
  if (!currentTaskId.value) {
    const item = await postElectiveTask(taskForm.value as unknown as Record<string, unknown>)
    currentTaskId.value = item.id
  } else {
    await patchElectiveTask(currentTaskId.value, taskForm.value as unknown as Record<string, unknown>)
  }
  step.value = 2
}

async function saveStep2() {
  if (!currentTaskId.value) return
  await patchElectiveTask(currentTaskId.value, {
    min_pick: taskForm.value.min_pick,
    max_pick: taskForm.value.max_pick,
    limit_total_periods: taskForm.value.limit_total_periods,
    limit_same_course_count: taskForm.value.limit_same_course_count,
  })
  step.value = 3
  await loadCourses()
}

async function loadCourses() {
  if (!currentTaskId.value) return
  courses.value = await fetchElectiveCourses(currentTaskId.value, courseFilters.value as Record<string, string>)
}

function openAddCourse() {
  if (!currentTaskId.value) {
    ElMessage.warning('请先保存「基本信息」生成任务后再添加课程')
    return
  }
  courseDrawer.value = true
}

async function submitCourse() {
  if (!currentTaskId.value) return
  if (!courseForm.value.course_name.trim()) return ElMessage.warning('请填写课程名称')
  await postElectiveCourse(currentTaskId.value, courseForm.value as unknown as Record<string, unknown>)
  courseDrawer.value = false
  ElMessage.success('新增课程成功')
  await loadCourses()
}

async function doExport(kind: string) {
  if (!currentTaskId.value) return
  const r = await getElectiveExport(currentTaskId.value, kind)
  ElMessage.success(r.message)
}

function goStep(target: number) {
  step.value = target
  if (target === 3 && currentTaskId.value) loadCourses()
}

onMounted(async () => {
  meta.value = await fetchElectiveTaskMeta()
  campusId.value = meta.value.campuses[0]?.id ?? ''
  termId.value = meta.value.terms[0]?.id ?? ''
  courseForm.value.course_type = meta.value.course_type_options[0]?.value ?? ''
  await loadTasks()
})
</script>

<style scoped>
.etp { padding: 16px 20px 24px; }
.etp-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.etp-title { margin: 0; font-size: 16px; font-weight: 700; }
.etp-f { display: flex; gap: 8px; align-items: center; }
.etp-crumb { font-size: 12px; color: #909399; margin-bottom: 8px; }
.etp-stepbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  margin-bottom: 16px;
  padding: 12px 8px;
  background: #fafafa;
  border-radius: 4px;
  border: 1px solid #ebeef5;
}
.etp-stepbar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: #909399;
}
.etp-stepbar-item:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
  border-radius: 4px;
}
.etp-stepbar-num {
  width: 28px;
  height: 28px;
  line-height: 28px;
  text-align: center;
  border-radius: 50%;
  border: 2px solid #c0c4cc;
  font-size: 14px;
  font-weight: 600;
  background: #fff;
}
.etp-stepbar-item--active .etp-stepbar-num {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
}
.etp-stepbar-item--done .etp-stepbar-num {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.etp-stepbar-item--active .etp-stepbar-txt {
  color: var(--el-color-primary);
  font-weight: 600;
}
.etp-stepbar-txt { font-size: 13px; white-space: nowrap; }
.etp-stepbar-line {
  flex: 1;
  max-width: 80px;
  height: 2px;
  background: #dcdfe6;
  margin: 0 4px 24px;
}
.etp-alert { margin-bottom: 12px; }
.etp-step { border: 1px solid #ebeef5; border-radius: 4px; background: #fff; padding: 14px; }
.etp-form { max-width: 760px; }
.etp-foot { margin-top: 12px; display: flex; justify-content: center; }
.etp-cf, .etp-ca { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
</style>
