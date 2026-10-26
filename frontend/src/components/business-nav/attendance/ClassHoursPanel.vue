<template>
  <div class="chp">
    <header class="chp-hd">
      <h2 class="chp-title">课时统计</h2>
      <div class="chp-hd-right">
        <el-select v-model="campusId" style="width: 240px">
          <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-button type="primary" @click="openSettings">课时系数设置</el-button>
      </div>
    </header>

    <div class="chp-filter">
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" style="width: 250px" />
      <el-select v-model="teacherGroup" placeholder="教师分组" clearable style="width: 160px">
        <el-option v-for="x in meta?.teacher_group_options ?? []" :key="x" :label="x" :value="x" />
      </el-select>
      <el-input v-model="teacherName" placeholder="教师姓名" clearable style="width: 150px" />
      <el-input v-model="courseName" placeholder="筛选课程" clearable style="width: 150px" />
      <el-select v-model="selectedGradeId" placeholder="筛选年级" clearable style="width: 140px">
        <el-option v-for="g in meta?.grade_options ?? []" :key="g.id" :label="g.label" :value="g.id" />
      </el-select>
      <el-select v-model="dimension" style="width: 170px">
        <el-option v-for="d in meta?.dimension_options ?? []" :key="d.value" :label="d.label" :value="d.value" />
      </el-select>
      <el-button @click="openPeriodDialog">作息节次</el-button>
      <el-button type="primary" @click="loadRows">查询</el-button>
    </div>

    <div class="chp-op">
      <el-button type="primary" @click="openManualAdjust">手工调整</el-button>
      <el-button>导出</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe size="small">
      <el-table-column prop="teacher_name" label="教师姓名" width="100" />
      <el-table-column prop="teacher_group" label="教师分组" width="100" />
      <el-table-column prop="grade" label="年级" width="90" />
      <el-table-column prop="course" label="课程" width="100" />
      <el-table-column prop="class_name" label="班级组" width="120" />
      <el-table-column prop="head_class" label="任教班级" width="120" />
      <el-table-column prop="actual_hours" label="实际课时数" width="100" />
      <el-table-column prop="converted_hours" label="课时加权结果" width="110" />
      <el-table-column prop="apply_substitute_private" label="申请代课-因私" width="110" />
      <el-table-column prop="apply_substitute_public" label="申请代课-因公" width="110" />
      <el-table-column prop="substitute_hours" label="代课课时" width="90" />
      <el-table-column prop="manual_hours" label="手工调整" width="90" />
      <el-table-column label="课时详情" width="90" fixed="right">
        <template #default><el-button link type="primary">详情</el-button></template>
      </el-table-column>
    </el-table>

    <div class="chp-pg">
      <span>共 {{ total }} 条</span>
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        layout="prev, pager, next"
        :total="total"
        @current-change="onPageChange"
      />
    </div>

    <el-dialog v-model="periodDialogVisible" title="筛选年级信息和节次" width="720px">
      <div class="chp-period-dlg">
        <el-tree
          ref="periodTreeRef"
          :data="periodTree"
          :props="{ label: 'label', children: 'children' }"
          node-key="id"
          show-checkbox
          default-expand-all
        />
      </div>
      <template #footer>
        <el-button @click="periodDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmPeriodSelect">确定</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="manualVisible" title="手工调整课时" size="400px">
      <el-form label-position="top">
        <el-form-item label="教师姓名">
          <el-select v-model="manual.teacher_id" filterable>
            <el-option v-for="t in meta?.teacher_options ?? []" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="年级班级">
          <el-input v-model="manual.grade" placeholder="如：一年级" />
        </el-form-item>
        <el-form-item label="选择课程">
          <el-select v-model="manual.course" filterable>
            <el-option v-for="c in meta?.course_options ?? []" :key="c.name" :label="c.name" :value="c.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="调整值">
          <el-input-number v-model="manual.value" :precision="1" :step="0.5" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualVisible = false">取消</el-button>
        <el-button type="primary" @click="submitManualAdjust">确定</el-button>
      </template>
    </el-drawer>

    <el-drawer v-model="settingsVisible" title="课时系数设置" size="460px">
      <div class="chp-setting-tip">设置说明：可选择课时和课减；并支持学科课程加权系数。</div>
      <el-form v-if="settings" label-position="top">
        <el-form-item label="因公申请代课">
          <el-radio-group v-model="settings.substitute_mode">
            <el-radio value="sum">课时和课减</el-radio>
            <el-radio value="minus">课时扣减</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="帮人代课课时系数">
          <el-input-number v-model="settings.substitute_hours_factor" :precision="2" :step="0.1" />
        </el-form-item>
        <el-form-item label="学科课程">
          <el-button link type="primary" @click="batchVisible = true">批量设置</el-button>
          <div class="chp-course-grid">
            <div v-for="it in settings.course_coefficients" :key="it.course_name" class="chp-course-item">
              <span>{{ it.course_name }}</span>
              <el-input-number v-model="it.value" :precision="2" :step="0.1" :min="0" />
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settingsVisible = false">取消</el-button>
        <el-button type="primary" @click="saveSettings">保存</el-button>
      </template>
    </el-drawer>

    <el-dialog v-model="batchVisible" title="批量设置权重系数" width="420px">
      <el-input-number v-model="batchValue" :precision="2" :step="0.1" :min="0" />
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="applyBatch">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ElTree } from 'element-plus'
import { ElMessage } from 'element-plus'
import {
  fetchClassHoursGradePeriodTree,
  fetchClassHoursMeta,
  fetchClassHoursSettings,
  postClassHoursBatchCoefficient,
  postClassHoursManualAdjust,
  postClassHoursQuery,
  putClassHoursSettings,
} from '@/api/classHours'

const meta = ref<Awaited<ReturnType<typeof fetchClassHoursMeta>> | null>(null)
const campusId = ref('')
const dateRange = ref<[string, string]>(['2026-03-02', '2026-04-01'])
const teacherGroup = ref('')
const teacherName = ref('')
const courseName = ref('')
const selectedGradeId = ref('')
const dimension = ref('teacher-detail')
const selectedPeriodIds = ref<string[]>([])

const loading = ref(false)
const rows = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

const periodDialogVisible = ref(false)
const periodTree = ref<any[]>([])
const periodTreeRef = ref<InstanceType<typeof ElTree>>()

const manualVisible = ref(false)
const manual = ref({ teacher_id: '', grade: '一年级', course: '语文', value: 1 })

const settingsVisible = ref(false)
const settings = ref<any>(null)
const batchVisible = ref(false)
const batchValue = ref(1)

async function loadMeta() {
  meta.value = await fetchClassHoursMeta()
  campusId.value = meta.value.campuses[0]?.id ?? ''
  dateRange.value = [meta.value.default_date_start, meta.value.default_date_end]
  manual.value.teacher_id = meta.value.teacher_options[0]?.id ?? ''
}

async function loadRows() {
  if (!campusId.value) return
  loading.value = true
  try {
    const res = await postClassHoursQuery({
      campus_id: campusId.value,
      date_start: dateRange.value[0],
      date_end: dateRange.value[1],
      grade_ids: selectedGradeId.value ? [selectedGradeId.value] : [],
      weekday_values: [],
      period_ids: selectedPeriodIds.value,
      teacher_group: teacherGroup.value,
      teacher_name: teacherName.value,
      course_name: courseName.value,
      dimension: dimension.value,
      page: page.value,
      page_size: pageSize.value,
    })
    rows.value = res.items
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function onPageChange(p: number) {
  page.value = p
  loadRows()
}

async function openPeriodDialog() {
  periodTree.value = await fetchClassHoursGradePeriodTree()
  periodDialogVisible.value = true
}

function confirmPeriodSelect() {
  selectedPeriodIds.value = ((periodTreeRef.value?.getCheckedKeys(false) as string[]) ?? []).filter((x) => /^[pm]\d+$/.test(x))
  periodDialogVisible.value = false
}

function openManualAdjust() {
  manualVisible.value = true
}

async function submitManualAdjust() {
  await postClassHoursManualAdjust({
    teacher_id: manual.value.teacher_id,
    grade: manual.value.grade,
    course: manual.value.course,
    value: Number(manual.value.value),
  })
  manualVisible.value = false
  ElMessage.success('手工调整成功')
  await loadRows()
}

async function openSettings() {
  settings.value = await fetchClassHoursSettings()
  settingsVisible.value = true
}

async function saveSettings() {
  await putClassHoursSettings({
    substitute_mode: settings.value.substitute_mode,
    substitute_hours_factor: Number(settings.value.substitute_hours_factor),
    course_coefficients: settings.value.course_coefficients,
  })
  settingsVisible.value = false
  ElMessage.success('课时系数已保存')
}

async function applyBatch() {
  const res = await postClassHoursBatchCoefficient({ value: Number(batchValue.value), course_names: [] })
  if (settings.value) settings.value.course_coefficients = res.items
  batchVisible.value = false
}

onMounted(async () => {
  await loadMeta()
  await loadRows()
})
</script>

<style scoped>
.chp { padding: 16px 20px 24px; }
.chp-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.chp-title { margin: 0; font-size: 16px; font-weight: 700; }
.chp-hd-right { display: flex; gap: 8px; }
.chp-filter { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.chp-op { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
.chp-pg { margin-top: 10px; display: flex; justify-content: flex-end; gap: 16px; align-items: center; }
.chp-period-dlg { border: 1px solid #ebeef5; border-radius: 4px; padding: 8px; height: 300px; overflow: auto; }
.chp-setting-tip { margin-bottom: 10px; font-size: 12px; color: #909399; }
.chp-course-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; width: 100%; }
.chp-course-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid #ebeef5; padding: 8px; border-radius: 4px; }
</style>
