<template>
  <div class="epp">
    <template v-if="!applyMode">
      <header class="epp-hd">
        <h2 class="epp-title">选课进度</h2>
        <div class="epp-hd-right">
          <el-select v-model="campusId" style="width: 220px" @change="onCampusTermChange">
            <el-option v-for="c in taskMeta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-select v-model="termId" style="width: 240px" @change="onCampusTermChange">
            <el-option v-for="t in taskMeta?.terms ?? []" :key="t.id" :label="t.label" :value="t.id" />
          </el-select>
          <el-select v-model="taskId" placeholder="请选择课程任务" clearable style="width: 200px" @change="reloadTab">
            <el-option v-for="x in progressMeta?.tasks ?? []" :key="x.id" :label="x.name" :value="x.id" />
          </el-select>
          <el-button type="primary" plain @click="enableSelection">
            <el-icon><Setting /></el-icon>
            启用选课
          </el-button>
          <el-button type="primary" @click="openApply">
            <el-icon><Setting /></el-icon>
            应用选课
          </el-button>
        </div>
      </header>

      <el-tabs v-model="mainTab" class="epp-tabs" @tab-change="reloadTab">
        <el-tab-pane label="各班进度" name="class" />
        <el-tab-pane label="学生明细" name="student" />
        <el-tab-pane label="课程详情" name="course" />
      </el-tabs>

      <div class="epp-toolbar">
        <template v-if="mainTab === 'class'">
          <el-select v-model="classGradeId" placeholder="请选择年级" clearable style="width: 140px">
            <el-option v-for="g in progressMeta?.grade_options ?? []" :key="g.id" :label="g.label" :value="g.id" />
          </el-select>
          <el-select v-model="classProgressKey" placeholder="请选择进度" style="width: 140px">
            <el-option v-for="p in progressMeta?.progress_options ?? []" :key="p.value" :label="p.label" :value="p.value" />
          </el-select>
          <el-button type="primary" @click="loadClasses">查询</el-button>
        </template>
        <template v-else-if="mainTab === 'student'">
          <el-select v-model="stuClassId" placeholder="请选择班级" clearable style="width: 140px">
            <el-option v-for="c in progressMeta?.class_options ?? []" :key="c.id" :label="c.label" :value="c.id" />
          </el-select>
          <el-select v-model="stuStatus" placeholder="请选择状态" style="width: 140px">
            <el-option v-for="s in progressMeta?.student_status_options ?? []" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
          <el-input v-model="stuCourseQ" placeholder="课程" clearable style="width: 120px" />
          <el-input v-model="stuNameQ" placeholder="学生姓名" clearable style="width: 140px" />
          <el-button type="primary" @click="loadStudents">查询</el-button>
          <el-button @click="doImportPre">导入预选</el-button>
          <el-button @click="doExport('students_timetable')">导出学生上课表</el-button>
          <el-button @click="doExport('selection_list')">导出选课名单</el-button>
        </template>
        <template v-else>
          <el-select v-model="crsResult" placeholder="选课结果状态" clearable style="width: 150px">
            <el-option v-for="x in progressMeta?.course_result_options ?? []" :key="x.value" :label="x.label" :value="x.value" />
          </el-select>
          <el-input v-model="crsName" placeholder="课程名称" clearable style="width: 120px" />
          <el-input v-model="crsTeacher" placeholder="教师姓名" clearable style="width: 120px" />
          <el-select v-model="crsType" placeholder="课程类型" clearable style="width: 120px">
            <el-option v-for="x in progressMeta?.course_type_options ?? []" :key="x.value" :label="x.label" :value="x.value" />
          </el-select>
          <el-select v-model="crsPeriod" placeholder="开课节次" clearable style="width: 120px">
            <el-option v-for="x in progressMeta?.period_options ?? []" :key="x.value" :label="x.label" :value="x.value" />
          </el-select>
          <el-select v-model="crsGradeId" placeholder="可选年级" clearable style="width: 120px">
            <el-option v-for="g in progressMeta?.grade_options ?? []" :key="g.id" :label="g.label" :value="g.id" />
          </el-select>
          <el-button type="primary" @click="loadCourses">查询</el-button>
          <el-button @click="doValidateAnomaly">选课异常校验</el-button>
          <el-button @click="doExport('course_list')">导出课程名单</el-button>
        </template>
        <div class="epp-toolbar-right">
          <el-button type="primary" plain @click="checkAccounts">检查学生账号</el-button>
          <el-button type="primary" plain @click="updateStudents">更新学生</el-button>
          <el-button v-if="mainTab === 'class'" type="primary" @click="notifyConfirmVisible = true">一键通知</el-button>
        </div>
      </div>

      <div v-loading="loading">
        <el-table v-if="mainTab === 'class'" :data="classRows" border stripe size="small">
          <el-table-column prop="grade" label="年级" width="100" />
          <el-table-column prop="class_name" label="班级" width="140" />
          <el-table-column prop="head_count" label="班级人数" width="100" />
          <el-table-column prop="selected_count" label="选课人数" width="100" />
          <el-table-column label="选课进度" min-width="160">
            <template #default="{ row }">
              <el-progress :percentage="row.progress_pct" :stroke-width="10" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default><el-button link type="primary">查看</el-button></template>
          </el-table-column>
        </el-table>

        <el-table v-else-if="mainTab === 'student'" :data="studentRows" border stripe size="small">
          <el-table-column type="index" label="序号" width="60" />
          <el-table-column prop="class_name" label="班级" width="120" />
          <el-table-column prop="student_name" label="学生姓名" width="100" />
          <el-table-column prop="student_no" label="学号" width="120" />
          <el-table-column prop="gender" label="性别" width="72" />
          <el-table-column prop="status" label="选课状态" width="100" />
          <el-table-column prop="course_names" label="所选课程" min-width="140" />
          <el-table-column prop="source" label="选课来源" width="100" />
          <el-table-column label="操作" width="90">
            <template #default><el-button link type="primary">编辑</el-button></template>
          </el-table-column>
        </el-table>

        <el-table v-else :data="courseRows" border stripe size="small">
          <el-table-column type="index" label="序号" width="60" />
          <el-table-column prop="course_name" label="课程名称" min-width="120" />
          <el-table-column prop="course_code" label="课程编号" width="100" />
          <el-table-column prop="course_type" label="课程类型" width="100" />
          <el-table-column prop="topic_name" label="兴趣班名" width="120" />
          <el-table-column prop="grade" label="开课年级" width="100" />
          <el-table-column prop="teacher_name" label="上课老师" width="100" />
          <el-table-column prop="place" label="上课地点" width="100" />
          <el-table-column prop="max_students" label="人数上限" width="90" />
          <el-table-column prop="selected_count" label="已选人数" width="90" />
          <el-table-column label="操作" width="90">
            <template #default><el-button link type="primary">详情</el-button></template>
          </el-table-column>
        </el-table>
      </div>

      <div class="epp-pg">
        <span>共 {{ listTotal }} 条</span>
        <el-pagination
          :current-page="listPage"
          :page-size="listPageSize"
          :total="listTotal"
          layout="prev, pager, next, sizes"
          :page-sizes="[10, 20, 50]"
          @current-change="onPageChange"
          @size-change="onSizeChange"
        />
      </div>
    </template>

    <template v-else>
      <div class="epp-crumb">选课进度 / 应用选课数据</div>
      <h2 class="epp-subtitle">应用选课数据</h2>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="epp-alert"
        title="请先勾选需应用的课程，选择「应用班级」或「应用课表」，系统将自动应用选课数据到基础信息和课表中。"
      />
      <el-table :data="applyRows" border stripe size="small" @selection-change="onApplySel">
        <el-table-column type="selection" width="48" />
        <el-table-column prop="topic_name" label="兴趣班名称" min-width="120" />
        <el-table-column prop="course_name" label="课程名称" width="120" />
        <el-table-column prop="course_type" label="课程类型" width="100" />
        <el-table-column prop="teacher_name" label="任教教师" width="100" />
        <el-table-column prop="classroom" label="上课教室" width="100" />
        <el-table-column prop="class_time" label="上课时间" width="120" />
        <el-table-column prop="selected_count" label="已选学生人数" width="110" />
        <el-table-column prop="schedule_grade" label="作息时间对应年级" width="140" />
        <el-table-column prop="match_status" label="班级匹配情况" width="120" />
        <el-table-column label="应用操作" width="100" />
      </el-table>
      <div class="epp-apply-foot">
        <p>已选中 {{ applySelected.length }} 条</p>
        <div class="epp-apply-row">
          <span class="epp-apply-lbl">方式1</span>
          <el-button type="primary" @click="submitApplyClass">应用班级</el-button>
          <span class="epp-apply-desc">将同步学生到基础信息-学生管理兴趣班中。</span>
        </div>
        <div class="epp-apply-row">
          <span class="epp-apply-lbl">方式2</span>
          <el-date-picker
            v-model="applyDateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 260px"
          />
          <el-button type="primary" @click="submitApplyTimetable">应用课表</el-button>
          <span class="epp-apply-desc">将更新兴趣班课程到课表数据中。</span>
        </div>
        <el-button @click="applyMode = false">返回选课进度</el-button>
      </div>
    </template>

    <el-dialog v-model="checkDialogVisible" title="提示" width="400px">
      <p>{{ checkMessage }}</p>
      <template #footer><el-button type="primary" @click="checkDialogVisible = false">确定</el-button></template>
    </el-dialog>

    <el-dialog v-model="notifyConfirmVisible" title="提示" width="440px">
      <p>是否发送选课通知给尚未选课的学生/家长？</p>
      <template #footer>
        <el-button @click="notifyConfirmVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmNotify">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { fetchElectiveTaskMeta } from '@/api/electiveTask'
import {
  fetchElectiveApplyRows,
  fetchElectiveProgressClasses,
  fetchElectiveProgressCourses,
  fetchElectiveProgressMeta,
  fetchElectiveProgressStudents,
  getElectiveProgressExport,
  postElectiveApplyClass,
  postElectiveApplyTimetable,
  postElectiveCheckAccounts,
  postElectiveEnable,
  postElectiveImportPreselect,
  postElectiveNotify,
  postElectiveUpdateStudents,
  postElectiveValidateAnomalies,
} from '@/api/electiveProgress'

const taskMeta = ref<Awaited<ReturnType<typeof fetchElectiveTaskMeta>> | null>(null)
const progressMeta = ref<Awaited<ReturnType<typeof fetchElectiveProgressMeta>> | null>(null)
const campusId = ref('')
const termId = ref('')
const taskId = ref('')
const mainTab = ref<'class' | 'student' | 'course'>('class')
const loading = ref(false)

const classGradeId = ref('')
const classProgressKey = ref('all')
const classRows = ref<any[]>([])

const stuClassId = ref('')
const stuStatus = ref('all')
const stuCourseQ = ref('')
const stuNameQ = ref('')
const studentRows = ref<any[]>([])

const crsResult = ref('all')
const crsName = ref('')
const crsTeacher = ref('')
const crsType = ref('')
const crsPeriod = ref('')
const crsGradeId = ref('')
const courseRows = ref<any[]>([])

const listPage = ref(1)
const listPageSize = ref(10)
const listTotal = ref(0)

const applyMode = ref(false)
const applyRows = ref<any[]>([])
const applySelected = ref<any[]>([])
const applyDateRange = ref<[string, string] | null>(null)

const checkDialogVisible = ref(false)
const checkMessage = ref('')
const notifyConfirmVisible = ref(false)

function baseParams() {
  return {
    campus_id: campusId.value,
    term_id: termId.value,
    task_id: taskId.value,
  }
}

async function onCampusTermChange() {
  if (!campusId.value || !termId.value) return
  progressMeta.value = await fetchElectiveProgressMeta(campusId.value, termId.value)
  taskId.value = progressMeta.value.tasks[0]?.id ?? ''
  reloadTab()
}

async function loadClasses() {
  if (!taskId.value) {
    classRows.value = []
    listTotal.value = 0
    return
  }
  loading.value = true
  try {
    const res = await fetchElectiveProgressClasses({
      ...baseParams(),
      grade_id: classGradeId.value,
      progress_key: classProgressKey.value,
      page: listPage.value,
      page_size: listPageSize.value,
    } as Record<string, string | number>)
    classRows.value = res.items
    listTotal.value = res.total
  } finally {
    loading.value = false
  }
}

async function loadStudents() {
  if (!taskId.value) {
    studentRows.value = []
    listTotal.value = 0
    return
  }
  loading.value = true
  try {
    const res = await fetchElectiveProgressStudents({
      ...baseParams(),
      class_id: stuClassId.value,
      status: stuStatus.value,
      course_q: stuCourseQ.value,
      name_q: stuNameQ.value,
      page: listPage.value,
      page_size: listPageSize.value,
    } as Record<string, string | number>)
    studentRows.value = res.items
    listTotal.value = res.total
  } finally {
    loading.value = false
  }
}

async function loadCourses() {
  if (!taskId.value) {
    courseRows.value = []
    listTotal.value = 0
    return
  }
  loading.value = true
  try {
    const res = await fetchElectiveProgressCourses({
      ...baseParams(),
      result_status: crsResult.value || 'all',
      course_name: crsName.value,
      teacher_name: crsTeacher.value,
      course_type: crsType.value,
      session: crsPeriod.value,
      grade_id: crsGradeId.value,
      page: listPage.value,
      page_size: listPageSize.value,
    } as Record<string, string | number>)
    courseRows.value = res.items
    listTotal.value = res.total
  } finally {
    loading.value = false
  }
}

function reloadTab() {
  listPage.value = 1
  if (mainTab.value === 'class') loadClasses()
  else if (mainTab.value === 'student') loadStudents()
  else loadCourses()
}

function onPageChange(p: number) {
  listPage.value = p
  reloadTab()
}

function onSizeChange(s: number) {
  listPageSize.value = s
  listPage.value = 1
  reloadTab()
}

watch(mainTab, () => {
  listPage.value = 1
  listPageSize.value = mainTab.value === 'course' ? 50 : 10
  reloadTab()
})

async function checkAccounts() {
  if (!taskId.value) return ElMessage.warning('请先选择选课任务')
  const r = await postElectiveCheckAccounts(taskId.value)
  checkMessage.value = r.message
  checkDialogVisible.value = true
}

async function updateStudents() {
  if (!taskId.value) return ElMessage.warning('请先选择选课任务')
  const r = await postElectiveUpdateStudents(taskId.value)
  ElMessage.success(r.message)
}

async function confirmNotify() {
  if (!taskId.value) return
  notifyConfirmVisible.value = false
  const r = await postElectiveNotify(taskId.value)
  ElMessage.success(r.message)
}

async function openApply() {
  if (!taskId.value) return ElMessage.warning('请先选择选课任务')
  applyRows.value = await fetchElectiveApplyRows(taskId.value)
  applySelected.value = []
  applyDateRange.value = null
  applyMode.value = true
}

function onApplySel(rows: any[]) {
  applySelected.value = rows
}

async function submitApplyClass() {
  if (!taskId.value) return
  const ids = applySelected.value.map((r) => r.id)
  const r = await postElectiveApplyClass(taskId.value, ids)
  ElMessage.success(r.message)
}

async function submitApplyTimetable() {
  if (!taskId.value) return
  if (!applyDateRange.value) return ElMessage.warning('请选择课表生效日期')
  const ids = applySelected.value.map((r) => r.id)
  const r = await postElectiveApplyTimetable(taskId.value, ids, applyDateRange.value[0], applyDateRange.value[1])
  ElMessage.success(r.message)
}

async function doExport(kind: string) {
  if (!taskId.value) return ElMessage.warning('请先选择选课任务')
  const r = await getElectiveProgressExport(taskId.value, kind)
  ElMessage.success(r.message)
}

async function doImportPre() {
  if (!taskId.value) return
  const r = await postElectiveImportPreselect(taskId.value)
  ElMessage.success(r.message)
}

async function doValidateAnomaly() {
  if (!taskId.value) return
  const r = await postElectiveValidateAnomalies(taskId.value)
  ElMessage.success(r.message)
}

async function enableSelection() {
  if (!taskId.value) return ElMessage.warning('请先选择选课任务')
  const r = await postElectiveEnable(taskId.value)
  ElMessage.success(r.message)
}

onMounted(async () => {
  taskMeta.value = await fetchElectiveTaskMeta()
  campusId.value = taskMeta.value.campuses[0]?.id ?? ''
  termId.value = taskMeta.value.terms[0]?.id ?? ''
  classProgressKey.value = 'all'
  stuStatus.value = 'all'
  crsResult.value = 'all'
  await onCampusTermChange()
})
</script>

<style scoped>
.epp {
  padding: 16px 20px 24px;
}
.epp-hd {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
  gap: 8px;
}
.epp-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.epp-hd-right {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.epp-tabs {
  margin-bottom: 8px;
}
.epp-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.epp-toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.epp-pg {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.epp-crumb {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}
.epp-subtitle {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 700;
}
.epp-alert {
  margin-bottom: 12px;
}
.epp-apply-foot {
  margin-top: 16px;
}
.epp-apply-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  flex-wrap: wrap;
}
.epp-apply-lbl {
  font-weight: 600;
  width: 48px;
}
.epp-apply-desc {
  font-size: 12px;
  color: #909399;
  max-width: 420px;
}
</style>
