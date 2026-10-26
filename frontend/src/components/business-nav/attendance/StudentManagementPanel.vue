<template>
  <div class="stu-root">
    <header class="stu-hd">
      <h2 class="stu-title">学生管理</h2>
      <div class="stu-hd-actions">
        <el-button type="primary" @click="openDingDialog">
          <el-icon class="stu-ic"><Refresh /></el-icon>
          同步钉钉家校通讯录
        </el-button>
        <el-button @click="openBatchDrawer">
          <el-icon class="stu-ic"><Document /></el-icon>
          学生导入/导出/修改
        </el-button>
      </div>
    </header>

    <div class="stu-layout">
      <aside class="stu-aside">
        <el-input
          v-model="filterText"
          :placeholder="kind === 'admin' ? '筛选班级' : '搜索学生、班级'"
          clearable
          class="stu-filter"
          :prefix-icon="Search"
        />
        <el-radio-group v-model="kind" class="stu-kind" size="small" @change="onKindChange">
          <el-radio-button value="admin">行政班</el-radio-button>
          <el-radio-button value="nonadmin">非行政班</el-radio-button>
        </el-radio-group>
        <el-tree
          ref="treeRef"
          class="stu-tree"
          :data="treeData"
          :props="treeProps"
          node-key="id"
          highlight-current
          default-expand-all
          :filter-node-method="filterNode"
          @node-click="onTreeClick"
        />
        <el-button v-if="kind === 'nonadmin'" type="primary" plain class="stu-new-na" @click="ElMessage.info('新建非行政班（演示）')">
          + 新建非行政班
        </el-button>
      </aside>

      <main class="stu-main">
        <template v-if="kind === 'admin' && view === 'grade' && gradeSummary">
          <div class="stu-toolbar">
            <div class="stu-toolbar-left">
              <el-input
                v-model="studentKw"
                placeholder="请输入学生姓名关键字"
                clearable
                style="width: 220px"
                size="small"
              />
              <el-button type="primary" size="small" @click="ElMessage.info('查找（演示）')">查找</el-button>
            </div>
            <div class="stu-toolbar-right">
              <el-button type="primary" size="small" @click="ElMessage.info('新建班级（演示）')">新建班级</el-button>
              <el-button size="small" @click="ElMessage.info('班级组设置（演示）')">班级组设置</el-button>
              <el-button size="small" @click="ElMessage.info('班主任导入（演示）')">班主任导入</el-button>
            </div>
          </div>
          <h3 class="stu-block-title">
            {{ gradeSummary.title }}（{{ gradeSummary.class_count }}个班级，{{ gradeSummary.student_total }}人）
          </h3>
          <div v-for="sec in gradeSummary.sections" :key="sec.group_name" class="stu-sec">
            <div class="stu-sec-hd">
              <span class="stu-sec-bar" />{{ sec.group_name }}（{{ sec.classes.length }}个班级）
            </div>
            <el-table :data="sec.classes" border stripe size="small" class="stu-table">
              <el-table-column prop="display_name" label="班级" width="100" />
              <el-table-column label="学生人数" width="100">
                <template #default="{ row }">{{ row.student_count }}人</template>
              </el-table-column>
              <el-table-column label="班主任" min-width="120">
                <template #default="{ row }">
                  <el-button link type="primary">{{ row.teacher_name }}</el-button>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="88" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openClassEdit(row)">编辑</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>

        <template v-else-if="kind === 'admin' && view === 'class' && roster">
          <div class="stu-class-toolbar">
            <div class="stu-class-toolbar-row">
              <el-input
                v-model="classRosterKwInput"
                placeholder="请输入学生姓名关键字"
                clearable
                style="width: 220px"
                size="small"
                @keyup.enter="applyClassSearch"
              />
              <el-select v-model="classGenderFilter" placeholder="全部" style="width: 100px" size="small">
                <el-option label="全部" value="全部" />
                <el-option label="男" value="男" />
                <el-option label="女" value="女" />
                <el-option label="未知" value="未知" />
              </el-select>
              <el-button type="primary" size="small" @click="applyClassSearch">查找</el-button>
            </div>
            <div class="stu-class-toolbar-row stu-class-toolbar-meta">
              <div class="stu-class-title-block">
                <h3 class="stu-class-title">
                  {{ roster.class.display_name }}（{{ roster.students.length }}人）
                </h3>
                <p class="stu-class-sub">
                  班级组：{{ roster.class.group_display ?? roster.class.group_name }} · 班主任：{{
                    roster.class.teacher_name
                  }}
                </p>
              </div>
              <div class="stu-class-actions">
                <el-button type="primary" size="small" @click="openAddStudent">添加学生</el-button>
                <el-button size="small" @click="bulkDeleteStudents">批量删除</el-button>
                <el-button size="small" @click="backToGrade">返回年级</el-button>
              </div>
            </div>
          </div>
          <el-table
            ref="rosterTableRef"
            row-key="id"
            :data="filteredRosterStudents"
            border
            stripe
            size="small"
            class="stu-roster-table"
            @selection-change="onRosterSelectionChange"
          >
            <el-table-column type="selection" width="48" />
            <el-table-column prop="name" label="学生姓名" width="100" />
            <el-table-column prop="class_label" label="班级" min-width="110" show-overflow-tooltip />
            <el-table-column prop="student_no" label="学号" width="100" />
            <el-table-column prop="gender" label="性别" width="72" />
            <el-table-column prop="care_session" label="参与托管" min-width="100" show-overflow-tooltip />
            <el-table-column prop="rotating_data" label="走班数据" min-width="100" show-overflow-tooltip />
            <el-table-column prop="card_no" label="学生卡号" width="100" />
            <el-table-column prop="parents" label="家长信息" min-width="140" show-overflow-tooltip />
            <el-table-column label="操作" width="72" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openEditStudent(row)">修改</el-button>
              </template>
            </el-table-column>
          </el-table>
          <p class="stu-hint">
            名单可批量导出修改；托管节次名称请与<strong>基础信息 · 作息时间</strong>一致。走班可多选教学班/兴趣班。
          </p>
        </template>

        <template v-else-if="kind === 'nonadmin' && nonadminData">
          <h3 class="stu-block-title">
            {{ nonadminData.title }}（{{ nonadminData.class_count }}个班级，{{ nonadminData.student_total }}人）
          </h3>
          <el-table :data="nonadminData.items" border stripe size="small">
            <el-table-column prop="name" label="班级名称" min-width="140" />
            <el-table-column label="人数" width="88">
              <template #default="{ row }">{{ row.student_count }}人</template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default>
                <el-button link type="primary" @click="ElMessage.info('班级详情（演示）')">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <el-empty v-else description="请在左侧选择年级、班级或非行政班分类" />
      </main>
    </div>

    <!-- 新增 / 修改学生 -->
    <el-dialog
      v-model="studentDialogVisible"
      :title="editingStudentId ? '修改学生' : '新增学生'"
      width="520px"
      destroy-on-close
      @opened="onStudentDialogOpened"
    >
      <el-form ref="studentFormRef" :model="studentForm" :rules="studentRules" label-width="96px" size="default">
        <el-form-item label="姓名" prop="name" required>
          <el-input v-model="studentForm.name" placeholder="请输入学生姓名" maxlength="32" show-word-limit />
        </el-form-item>
        <el-form-item label="班级">
          <el-input :model-value="roster?.class.display_name ?? ''" disabled />
        </el-form-item>
        <el-form-item label="学号" prop="student_no">
          <el-input v-model="studentForm.student_no" placeholder="请输入学生学号" />
        </el-form-item>
        <el-form-item label="性别" prop="gender">
          <el-radio-group v-model="studentForm.gender">
            <el-radio value="男">男</el-radio>
            <el-radio value="女">女</el-radio>
            <el-radio value="未知">未知</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="参与托管" prop="care_session">
          <el-select
            v-model="studentForm.care_session"
            placeholder="请选择托管节次"
            clearable
            style="width: 100%"
          >
            <el-option v-for="c in metaOptions.care_sessions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="走班" prop="rotating">
          <el-select
            v-model="studentForm.rotating"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="点击选择走班班级"
            style="width: 100%"
          >
            <el-option v-for="r in metaOptions.rotating_options" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="卡号" prop="card_no">
          <el-input v-model="studentForm.card_no" placeholder="请输入卡号" />
        </el-form-item>
        <el-form-item label="家长信息" prop="parents">
          <el-input v-model="studentForm.parents" type="textarea" :rows="2" placeholder="如：张三爸爸、张三妈妈" />
        </el-form-item>
        <el-form-item label="层级" prop="level">
          <el-input v-model="studentForm.level" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="studentDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="studentSaving" @click="submitStudentForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 同步钉钉 -->
    <el-dialog v-model="dingVisible" title="同步钉钉家校通讯录" width="760px" destroy-on-close @opened="onDingOpened">
      <template v-if="dingResult">
        <el-alert type="success" :closable="false" show-icon class="stu-mb">
          <template #default>
            成功同步 <strong>{{ dingResult.summary.campuses }}</strong> 个校区
            <strong>{{ dingResult.summary.grades }}</strong> 个年级
            <strong>{{ dingResult.summary.classes }}</strong> 个班 共
            <strong>{{ dingResult.summary.students }}</strong> 个学生
          </template>
        </el-alert>
        <p v-if="dingResult.message" class="stu-ding-msg">{{ dingResult.message }}</p>
        <el-alert
          v-if="dingResult.unmatched.length"
          title="以下班级未在系统中匹配到同名班级，可手动选择后，进行同步"
          type="warning"
          show-icon
          :closable="false"
          class="stu-mb"
        />
        <el-table v-if="dingResult.unmatched.length" :data="dingResult.unmatched" border size="small" class="stu-mb">
          <el-table-column prop="campus" label="校区" width="140" show-overflow-tooltip />
          <el-table-column prop="segment" label="学段" width="80" />
          <el-table-column prop="grade" label="年级" width="120" show-overflow-tooltip />
          <el-table-column prop="class_name" label="班级" width="80" />
          <el-table-column label="未匹配到班级将自动新建" min-width="220">
            <template #default="{ row }">
              <el-select
                v-model="dingMap[row.id]"
                placeholder="未匹配到班级请选择"
                clearable
                style="width: 100%"
                size="small"
              >
                <el-option
                  v-for="o in classOptions"
                  :key="o.value || 'empty'"
                  :label="o.label"
                  :value="o.value"
                />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <template #footer>
        <el-button @click="dingVisible = false">取消</el-button>
        <el-button type="primary" :loading="dingSaving" @click="confirmDing">确定</el-button>
      </template>
    </el-dialog>

    <!-- 编辑班级 -->
    <el-drawer v-model="classEditVisible" title="修改班级信息" direction="rtl" size="420px" destroy-on-close>
      <template v-if="editClass">
        <el-form label-position="top" size="default">
          <el-form-item label="班级名称" required>
            <el-input v-model="editForm.display_name" placeholder="如 1班" />
          </el-form-item>
          <el-form-item label="班级组">
            <el-select v-model="editForm.group_name" style="width: 100%">
              <el-option label="未分组" value="未分组" />
              <el-option label="语文组" value="语文组" />
              <el-option label="数学组" value="数学组" />
            </el-select>
          </el-form-item>
          <el-form-item label="班主任">
            <el-input v-model="editForm.teacher_name" placeholder="班主任姓名" />
          </el-form-item>
        </el-form>
        <p class="stu-hint">
          班级组可用于入学分班分组；班主任可在手机端查看本班课表与课表变更确认。
        </p>
      </template>
      <template #footer>
        <el-button @click="classEditVisible = false">取消</el-button>
        <el-button type="primary" :loading="classSaving" @click="saveClass">确定</el-button>
      </template>
    </el-drawer>

    <!-- 批量导入导出 -->
    <el-drawer v-model="batchVisible" title="学生数据批量操作" direction="rtl" size="520px" destroy-on-close>
      <el-tabs v-model="batchTab">
        <el-tab-pane label="学生导出/修改" name="export">
          <p class="stu-batch-desc">
            导出全部学生名单表格，在表格中修改信息后上传（支持 .xls / .xlsx）。行政班导出含「托管时段」列，填写节次名称须与<strong>基础信息 · 作息时间</strong>中节次一致。
          </p>
          <div class="stu-step">
            <span class="stu-step-no">1</span>
            点击导出全部学生名单表格
            <div class="stu-step-act">
              <el-button @click="doExport">学生名单</el-button>
            </div>
          </div>
          <div class="stu-step">
            <span class="stu-step-no">2</span>
            在表格中修改信息后，点击上传
            <div class="stu-step-act">
              <el-button type="primary" @click="doImportAdmin">上传文件</el-button>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="学生批量导入" name="import">
          <div class="stu-step">
            <span class="stu-step-no">1</span>
            下载学生模板
            <div class="stu-step-act">
              <el-button @click="ElMessage.success('演示：已触发模板下载')">学生模板</el-button>
            </div>
          </div>
          <div class="stu-step">
            <span class="stu-step-no">2</span>
            选择班级类型
            <el-radio-group v-model="nonadminImportType" class="stu-radio-block">
              <el-radio value="teach">教学班</el-radio>
              <el-radio value="interest">兴趣班</el-radio>
              <el-radio value="care">托管班</el-radio>
            </el-radio-group>
            <p class="stu-hint">
              教学班：同一年级分层走班；兴趣班：可跨年级；托管班：课后看护，可跨年级、周内多主题。
            </p>
          </div>
          <div class="stu-step">
            <span class="stu-step-no">3</span>
            填写模板中非行政班名称后上传（.xls / .xlsx）
            <div class="stu-step-act">
              <el-button type="primary" @click="doImportNonadmin">上传学生模板</el-button>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="batchVisible = false">关闭</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Document, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ElTree, FormInstance, FormRules } from 'element-plus'
import {
  fetchClassRoster,
  fetchGradeSummary,
  fetchNonadminSummary,
  fetchStudentMetaOptions,
  fetchStudentTree,
  fetchSystemClassOptions,
  patchStudent,
  patchStudentClass,
  postBatchExport,
  postBatchImport,
  postDingTalkConfirm,
  postDingTalkSync,
  postStudent,
  postStudentsBulkDelete,
  type AdminClassRow,
  type ClassOption,
  type DingTalkSyncResult,
  type GradeSummary,
  type StudentRow,
  type TreeNode,
} from '@/api/studentManagement'

const kind = ref<'admin' | 'nonadmin'>('admin')
const treeData = ref<TreeNode[]>([])
const treeRef = ref<InstanceType<typeof ElTree>>()
const treeProps = { label: 'label', children: 'children' }
const filterText = ref('')
const studentKw = ref('')

const view = ref<'grade' | 'class'>('grade')
const selectedGradeId = ref<string | null>(null)
const selectedClassId = ref<string | null>(null)
const gradeSummary = ref<GradeSummary | null>(null)
const roster = ref<Awaited<ReturnType<typeof fetchClassRoster>> | null>(null)
const nonadminData = ref<Awaited<ReturnType<typeof fetchNonadminSummary>> | null>(null)

const dingVisible = ref(false)
const dingResult = ref<DingTalkSyncResult | null>(null)
const classOptions = ref<ClassOption[]>([])
const dingMap = ref<Record<string, string>>({})
const dingSaving = ref(false)

const classEditVisible = ref(false)
const editClass = ref<AdminClassRow | null>(null)
const editForm = ref({ display_name: '', group_name: '', teacher_name: '' })
const classSaving = ref(false)

const batchVisible = ref(false)
const batchTab = ref('export')
const nonadminImportType = ref('teach')

const rosterTableRef = ref<{ clearSelection: () => void } | null>(null)
const classRosterKwInput = ref('')
const classRosterKwApplied = ref('')
const classGenderFilter = ref('全部')
const selectedRosterRows = ref<StudentRow[]>([])

const studentDialogVisible = ref(false)
const studentSaving = ref(false)
const editingStudentId = ref<string | null>(null)
const studentFormRef = ref<FormInstance>()
const metaOptions = ref<{ care_sessions: string[]; rotating_options: string[] }>({
  care_sessions: [],
  rotating_options: [],
})
const studentForm = ref({
  name: '',
  student_no: '',
  gender: '男',
  care_session: '',
  rotating: [] as string[],
  card_no: '',
  parents: '',
  level: '',
})

const studentRules: FormRules = {
  name: [{ required: true, message: '请输入学生姓名', trigger: 'blur' }],
}

const filteredRosterStudents = computed(() => {
  const list = roster.value?.students ?? []
  const kw = classRosterKwApplied.value
  const g = classGenderFilter.value
  return list.filter((r) => {
    if (kw && !r.name.includes(kw)) return false
    if (g !== '全部' && r.gender !== g) return false
    return true
  })
})

function applyClassSearch() {
  classRosterKwApplied.value = classRosterKwInput.value.trim()
}

function onRosterSelectionChange(rows: StudentRow[]) {
  selectedRosterRows.value = rows
}

function parseRotating(s: string) {
  if (!s || s === '暂无信息') return []
  return s
    .split(/[、,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

async function onStudentDialogOpened() {
  try {
    metaOptions.value = await fetchStudentMetaOptions()
  } catch {
    ElMessage.error('加载选项失败')
    metaOptions.value = { care_sessions: [], rotating_options: [] }
  }
}

function openAddStudent() {
  if (!selectedClassId.value || !roster.value) return
  editingStudentId.value = null
  studentForm.value = {
    name: '',
    student_no: '',
    gender: '男',
    care_session: '',
    rotating: [],
    card_no: '',
    parents: '',
    level: '',
  }
  studentDialogVisible.value = true
}

function openEditStudent(row: StudentRow) {
  editingStudentId.value = row.id
  studentForm.value = {
    name: row.name,
    student_no: row.student_no === '暂无' ? '' : row.student_no,
    gender: ['男', '女', '未知'].includes(row.gender) ? row.gender : '未知',
    care_session: row.care_session === '暂无信息' ? '' : row.care_session,
    rotating: parseRotating(row.rotating_data),
    card_no: row.card_no === '暂无' ? '' : row.card_no,
    parents: row.parents === '暂无信息' ? '' : row.parents,
    level: row.level ?? '',
  }
  studentDialogVisible.value = true
}

async function submitStudentForm() {
  if (!studentFormRef.value || !selectedClassId.value) return
  try {
    await studentFormRef.value.validate()
  } catch {
    return
  }
  const f = studentForm.value
  const rotating_data = f.rotating.length ? f.rotating.join('、') : ''
  studentSaving.value = true
  try {
    if (editingStudentId.value) {
      await patchStudent(editingStudentId.value, {
        name: f.name,
        student_no: f.student_no,
        gender: f.gender,
        care_session: f.care_session,
        rotating_data,
        card_no: f.card_no,
        parents: f.parents,
        level: f.level,
      })
      ElMessage.success('已保存')
    } else {
      await postStudent({
        class_id: selectedClassId.value,
        name: f.name,
        student_no: f.student_no || undefined,
        gender: f.gender,
        care_session: f.care_session || undefined,
        rotating_data: rotating_data || undefined,
        card_no: f.card_no || undefined,
        parents: f.parents || undefined,
        level: f.level || undefined,
      })
      ElMessage.success('已添加学生')
    }
    studentDialogVisible.value = false
    roster.value = await fetchClassRoster(selectedClassId.value)
    if (selectedGradeId.value) {
      gradeSummary.value = await fetchGradeSummary(selectedGradeId.value)
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    studentSaving.value = false
  }
}

async function bulkDeleteStudents() {
  const ids = selectedRosterRows.value.map((r) => r.id)
  if (!ids.length) {
    ElMessage.warning('请先勾选要删除的学生')
    return
  }
  if (!selectedClassId.value) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 名学生？`, '批量删除', {
      type: 'warning',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await postStudentsBulkDelete(selectedClassId.value, ids)
    ElMessage.success('已删除')
    rosterTableRef.value?.clearSelection()
    selectedRosterRows.value = []
    roster.value = await fetchClassRoster(selectedClassId.value)
    if (selectedGradeId.value) {
      gradeSummary.value = await fetchGradeSummary(selectedGradeId.value)
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

async function loadTree() {
  treeData.value = await fetchStudentTree(kind.value)
  gradeSummary.value = null
  roster.value = null
  nonadminData.value = null
  view.value = 'grade'
  selectedGradeId.value = null
  selectedClassId.value = null
  await nextTick()
  treeRef.value?.filter(filterText.value)
  if (kind.value === 'admin' && treeData.value.length) {
    const grade1 = findNodeById(treeData.value, 'grade-1')
    if (grade1) {
      treeRef.value?.setCurrentKey('grade-1')
      await onTreeClick(grade1)
    }
  }
}

function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children?.length) {
      const f = findNodeById(n.children, id)
      if (f) return f
    }
  }
  return null
}

function onKindChange() {
  loadTree()
}

function filterNode(value: string, data: TreeNode) {
  if (!value) return true
  return data.label.includes(value)
}

watch(filterText, (v) => {
  treeRef.value?.filter(v)
})

function isGradeNode(id: string) {
  return /^grade-\d+$/.test(id)
}

function isClassNode(id: string) {
  return /^grade-\d+-c\d+$/.test(id)
}

async function onTreeClick(data: TreeNode) {
  if (kind.value === 'admin') {
    if (isGradeNode(data.id)) {
      selectedGradeId.value = data.id
      selectedClassId.value = null
      view.value = 'grade'
      gradeSummary.value = await fetchGradeSummary(data.id)
      roster.value = null
    } else if (isClassNode(data.id)) {
      selectedClassId.value = data.id
      const m = data.id.match(/^(grade-\d+)-c\d+$/)
      selectedGradeId.value = m ? m[1]! : null
      view.value = 'class'
      classRosterKwInput.value = ''
      classRosterKwApplied.value = ''
      classGenderFilter.value = '全部'
      selectedRosterRows.value = []
      roster.value = await fetchClassRoster(data.id)
      gradeSummary.value = null
      await nextTick()
      rosterTableRef.value?.clearSelection()
    }
    return
  }
  if (data.id === 'na-interest' || data.id === 'na-teach' || data.id === 'na-care') {
    nonadminData.value = await fetchNonadminSummary(data.id)
  } else {
    nonadminData.value = null
  }
}

function backToGrade() {
  if (!selectedGradeId.value) return
  view.value = 'grade'
  roster.value = null
  fetchGradeSummary(selectedGradeId.value).then((r) => {
    gradeSummary.value = r
  })
  nextTick(() => treeRef.value?.setCurrentKey(selectedGradeId.value!))
}

function openClassEdit(row: AdminClassRow) {
  editClass.value = row
  editForm.value = {
    display_name: row.display_name,
    group_name: row.group_name,
    teacher_name: row.teacher_name,
  }
  classEditVisible.value = true
}

async function saveClass() {
  if (!editClass.value) return
  classSaving.value = true
  try {
    await patchStudentClass(editClass.value.id, { ...editForm.value })
    ElMessage.success('已保存')
    classEditVisible.value = false
    if (selectedGradeId.value && view.value === 'grade') {
      gradeSummary.value = await fetchGradeSummary(selectedGradeId.value)
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    classSaving.value = false
  }
}

async function openDingDialog() {
  dingVisible.value = true
}

async function onDingOpened() {
  dingMap.value = {}
  try {
    const [sync, opts] = await Promise.all([postDingTalkSync(), fetchSystemClassOptions()])
    dingResult.value = sync
    classOptions.value = opts
    for (const u of sync.unmatched) {
      dingMap.value[u.id] = ''
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '同步请求失败')
    dingResult.value = null
  }
}

async function confirmDing() {
  if (!dingResult.value) {
    dingVisible.value = false
    return
  }
  const unmatched = dingResult.value.unmatched
  const mappings = unmatched
    .map((u) => ({
      unmatched_id: u.id,
      system_class_id: dingMap.value[u.id] ?? '',
    }))
    .filter((m) => m.system_class_id)
  if (unmatched.length > 0 && mappings.length === 0) {
    ElMessage.warning('请为未匹配的钉钉班级选择系统内对应班级后再确定')
    return
  }
  dingSaving.value = true
  try {
    if (mappings.length > 0) {
      await postDingTalkConfirm(mappings)
      ElMessage.success(`已提交匹配（${mappings.length} 条），演示环境未落库`)
    } else {
      ElMessage.success('同步完成（演示：无待匹配项）')
    }
    dingVisible.value = false
    await loadTree()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败')
  } finally {
    dingSaving.value = false
  }
}

function openBatchDrawer() {
  batchVisible.value = true
}

async function doExport() {
  try {
    await postBatchExport()
    ElMessage.success('演示：已触发导出任务')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败')
  }
}

async function doImportAdmin() {
  try {
    await postBatchImport('admin')
    ElMessage.success('演示：已模拟上传行政班名单')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  }
}

async function doImportNonadmin() {
  try {
    await postBatchImport('nonadmin')
    ElMessage.success(`演示：已模拟上传（${nonadminImportType.value}）`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  }
}

onMounted(() => {
  loadTree()
})
</script>

<style scoped>
.stu-root {
  padding: 16px 20px 24px;
  min-height: 520px;
}
.stu-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.stu-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.stu-hd-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.stu-ic {
  margin-right: 4px;
  vertical-align: middle;
}
.stu-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.stu-aside {
  width: 260px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px;
}
.stu-filter {
  margin-bottom: 10px;
}
.stu-kind {
  display: flex;
  width: 100%;
  margin-bottom: 10px;
}
.stu-kind :deep(.el-radio-button) {
  flex: 1;
}
.stu-kind :deep(.el-radio-button__inner) {
  width: 100%;
}
.stu-tree {
  max-height: 420px;
  overflow: auto;
  font-size: 13px;
}
.stu-new-na {
  width: 100%;
  margin-top: 10px;
}
.stu-main {
  flex: 1;
  min-width: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 16px;
}
.stu-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
.stu-toolbar-left,
.stu-toolbar-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.stu-class-toolbar {
  margin-bottom: 12px;
}
.stu-class-toolbar-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.stu-class-toolbar-meta {
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0;
}
.stu-class-title-block {
  flex: 1;
  min-width: 200px;
}
.stu-class-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.stu-class-sub {
  margin: 0;
  font-size: 13px;
  color: #606266;
}
.stu-class-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.stu-roster-table {
  margin-top: 4px;
}
.stu-block-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.stu-inline-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.stu-sec {
  margin-bottom: 18px;
}
.stu-sec-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 8px;
}
.stu-sec-bar {
  width: 3px;
  height: 14px;
  background: var(--el-color-primary);
  border-radius: 1px;
}
.stu-table {
  width: 100%;
}
.stu-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  margin-top: 12px;
}
.stu-mb {
  margin-bottom: 12px;
}
.stu-ding-msg {
  font-size: 12px;
  color: #909399;
  margin: 0 0 12px;
}
.stu-batch-desc {
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
  margin: 0 0 16px;
}
.stu-step {
  margin-bottom: 18px;
  font-size: 13px;
  color: #303133;
}
.stu-step-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  margin-right: 8px;
}
.stu-step-act {
  margin-top: 8px;
  margin-left: 30px;
}
.stu-radio-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 0 0 30px;
}
</style>
