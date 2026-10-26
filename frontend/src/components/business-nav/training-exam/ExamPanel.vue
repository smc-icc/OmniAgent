<template>
  <div v-if="view === 'list'" class="te-panel">
    <div class="te-filters">
      <el-select v-model="filterOpen" placeholder="开放类型" clearable style="width: 140px">
        <el-option label="完全公开" value="完全公开" />
        <el-option label="部门开放" value="部门开放" />
      </el-select>
      <el-date-picker
        v-model="filterStart"
        type="datetime"
        placeholder="考试开始时间"
        value-format="YYYY-MM-DD HH:mm:ss"
        style="width: 200px"
      />
      <el-date-picker
        v-model="filterEnd"
        type="datetime"
        placeholder="考试结束时间"
        value-format="YYYY-MM-DD HH:mm:ss"
        style="width: 200px"
      />
      <el-input v-model="filterName" placeholder="搜索考试名称" clearable style="width: 200px" />
    </div>
    <el-button type="primary" :icon="Plus" class="te-mt" @click="openCreate">添加</el-button>

    <el-table
      :data="pagedRows"
      size="small"
      stripe
      border
      class="te-mt"
      @selection-change="(s: TeExam[]) => (selection = s)"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column prop="name" label="考试名称" min-width="160" show-overflow-tooltip />
      <el-table-column prop="openType" label="考试类型" width="110" />
      <el-table-column prop="timeText" label="考试时间" min-width="200" show-overflow-tooltip />
      <el-table-column prop="totalScore" label="考试总分" width="88" align="center" />
      <el-table-column prop="passScore" label="及格线" width="80" align="center" />
      <el-table-column prop="status" label="状态" width="88" />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link :icon="Edit" @click="openEdit(row)">修改</el-button>
          <el-button type="warning" link :icon="User" @click="openDetail(row)">考试详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="te-pagination">
      <span class="te-total">共 {{ filteredRows.length }} 条</span>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50]"
        layout="sizes, prev, pager, next, jumper"
        :total="filteredRows.length"
        background
      />
    </div>

    <el-dialog v-model="detailVisible" title="考试详情" width="560px" destroy-on-close>
      <template v-if="detailExam">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="考试名称">{{ detailExam.name }}</el-descriptions-item>
          <el-descriptions-item label="开放类型">{{ detailExam.openType }}</el-descriptions-item>
          <el-descriptions-item label="考试时间">{{ detailExam.timeText }}</el-descriptions-item>
          <el-descriptions-item label="总分 / 及格线">{{ detailExam.totalScore }} / {{ detailExam.passScore }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ detailExam.status }}</el-descriptions-item>
          <el-descriptions-item label="权限">
            {{ detailExam.permScope === 'public' ? '完全公开' : '部门开放' }}
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </el-dialog>
  </div>

  <div v-else class="te-panel te-exam-form">
    <el-card shadow="never" class="te-form-card">
      <div class="te-section-title">基本信息</div>
      <el-form ref="formRef" :model="eForm" :rules="eRules" label-width="110px">
        <el-form-item label="考试名称" prop="name" required>
          <el-input v-model="eForm.name" placeholder="请输入考试名称" style="max-width: 420px" />
        </el-form-item>
        <el-form-item label="考试时间">
          <el-checkbox v-model="eForm.unlimitedTime">不限时</el-checkbox>
        </el-form-item>
        <el-form-item v-if="!eForm.unlimitedTime" label="起止时间">
          <el-date-picker
            v-model="eForm.range"
            type="datetimerange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="max-width: 420px"
          />
        </el-form-item>
        <el-form-item label="及格线" prop="passScore" required>
          <el-input-number v-model="eForm.passScore" :min="0" :max="10000" />
        </el-form-item>
        <el-form-item label="试卷总分">
          <span class="te-score-display">{{ paperScoreTotal }} 分</span>
          <span class="te-hint">（由下方组卷自动汇总）</span>
        </el-form-item>
      </el-form>

      <div class="te-section-head">
        <span class="te-section-title">组卷信息</span>
        <el-tag type="danger" effect="plain">试卷总分: {{ paperScoreTotal }}分</el-tag>
      </div>
      <el-button type="primary" size="small" :icon="Plus" class="te-mb" @click="addPaperRow">添加题库</el-button>
      <el-table :data="eForm.paperRows" border size="small">
        <el-table-column label="题库" min-width="180">
          <template #default="{ row }">
            <el-select v-model="row.bankId" placeholder="选择或搜索题库" filterable style="width: 100%">
              <el-option v-for="b in banks" :key="b.id" :label="b.name" :value="b.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="单选数量" width="100">
          <template #default="{ row }">
            <el-input-number v-model="row.nSingle" :min="0" :controls="true" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="单选分数" width="100">
          <template #default="{ row }">
            <el-input-number v-model="row.sSingle" :min="0" :controls="true" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="多选数量" width="100">
          <template #default="{ row }">
            <el-input-number v-model="row.nMulti" :min="0" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="多选分数" width="100">
          <template #default="{ row }">
            <el-input-number v-model="row.sMulti" :min="0" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="判断题数量" width="110">
          <template #default="{ row }">
            <el-input-number v-model="row.nJudge" :min="0" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="判断题分数" width="110">
          <template #default="{ row }">
            <el-input-number v-model="row.sJudge" :min="0" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="删除" width="72" align="center">
          <template #default="{ $index }">
            <el-button type="danger" :icon="Delete" circle size="small" @click="removePaperRow($index)" />
          </template>
        </el-table-column>
      </el-table>

      <div class="te-section-title te-mt-lg">权限配置</div>
      <el-radio-group v-model="eForm.permScope" class="te-mb">
        <el-radio value="public">完全公开</el-radio>
        <el-radio value="dept">部门开放</el-radio>
      </el-radio-group>
      <template v-if="eForm.permScope === 'dept'">
        <el-input
          v-model="deptFilter"
          placeholder="输入关键字进行过滤"
          clearable
          class="te-mb"
          style="max-width: 320px"
          @input="onDeptFilter"
        />
        <el-tree
          ref="treeRef"
          class="te-tree"
          :data="deptTree"
          show-checkbox
          node-key="id"
          default-expand-all
          :props="{ label: 'label', children: 'children' }"
          :filter-node-method="filterDeptNode"
        />
        <el-button type="primary" class="te-mt" @click="savePermHint">保存</el-button>
      </template>
    </el-card>

    <div class="te-form-actions">
      <el-button type="primary" @click="submitExam">保存</el-button>
      <el-button @click="view = 'list'">返回</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Plus, Edit, User, Delete } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import {
  paperTotal,
  useTrainingExam,
  type TeExam,
  type TePaperRow,
} from './trainingExamContext'

const { banks, exams } = useTrainingExam()

const view = ref<'list' | 'form'>('list')
const filterOpen = ref('')
const filterStart = ref<string | null>(null)
const filterEnd = ref<string | null>(null)
const filterName = ref('')
const page = ref(1)
const pageSize = ref(10)
const selection = ref<TeExam[]>([])

const detailVisible = ref(false)
const detailExam = ref<TeExam | null>(null)

const filteredRows = computed(() => {
  let r = exams.value
  if (filterOpen.value) r = r.filter((e) => e.openType === filterOpen.value)
  const n = filterName.value.trim()
  if (n) r = r.filter((e) => e.name.includes(n))
  if (filterStart.value) {
    r = r.filter((e) => e.unlimitedTime || (e.startAt && e.startAt >= filterStart.value!))
  }
  if (filterEnd.value) {
    r = r.filter((e) => e.unlimitedTime || (e.endAt && e.endAt <= filterEnd.value!))
  }
  return r
})

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

watch([filterOpen, filterName, filterStart, filterEnd, pageSize], () => {
  page.value = 1
})

const formRef = ref<FormInstance>()
const editingId = ref<string | null>(null)

interface EFormShape {
  name: string
  unlimitedTime: boolean
  range: [string, string] | null
  passScore: number
  paperRows: TePaperRow[]
  permScope: 'public' | 'dept'
}

const emptyRow = (): TePaperRow => ({
  bankId: banks.value[0]?.id ?? '',
  nSingle: 0,
  sSingle: 0,
  nMulti: 0,
  sMulti: 0,
  nJudge: 0,
  sJudge: 0,
})

const eForm = ref<EFormShape>({
  name: '',
  unlimitedTime: true,
  range: null,
  passScore: 60,
  paperRows: [],
  permScope: 'public',
})

const eRules: FormRules = {
  name: [{ required: true, message: '请输入考试名称', trigger: 'blur' }],
  passScore: [{ required: true, message: '请输入及格线', trigger: 'blur' }],
}

function openTypeLabel(scope: 'public' | 'dept') {
  return scope === 'dept' ? '部门开放' : '完全公开'
}

const paperScoreTotal = computed(() => paperTotal(eForm.value.paperRows))

const deptFilter = ref('')
const treeRef = ref<{
  filter: (v: string) => void
  getCheckedKeys: () => string[]
  setCheckedKeys: (keys: string[]) => void
} | null>(null)

const deptTree = [
  {
    id: 'c1',
    label: '北京云帆互联科技有限公司',
    children: [
      { id: 'c1-hr', label: '人事部' },
      { id: 'c1-fi', label: '财务部', children: [{ id: 'c1-fi-2', label: '2222' }] },
      { id: 'c1-tech', label: '技术部' },
    ],
  },
]

function filterDeptNode(value: string, data: { label: string }) {
  if (!value) return true
  return data.label.includes(value)
}

function onDeptFilter() {
  nextTick(() => {
    treeRef.value?.filter(deptFilter.value)
  })
}

function addPaperRow() {
  eForm.value.paperRows.push(emptyRow())
}

function removePaperRow(i: number) {
  eForm.value.paperRows.splice(i, 1)
}

function openCreate() {
  editingId.value = null
  eForm.value = {
    name: '',
    unlimitedTime: true,
    range: null,
    passScore: 60,
    paperRows: [emptyRow()],
    permScope: 'public',
  }
  view.value = 'form'
  nextTick(() => treeRef.value?.setCheckedKeys([]))
}

function openEdit(row: TeExam) {
  editingId.value = row.id
  eForm.value = {
    name: row.name,
    unlimitedTime: row.unlimitedTime,
    range:
      row.startAt && row.endAt ? ([row.startAt, row.endAt] as [string, string]) : null,
    passScore: row.passScore,
    paperRows: row.paperRows.map((p) => ({ ...p })),
    permScope: row.permScope,
  }
  view.value = 'form'
  nextTick(() => treeRef.value?.setCheckedKeys([...row.permDeptKeys]))
}

function openDetail(row: TeExam) {
  detailExam.value = row
  detailVisible.value = true
}

function buildTimeFields() {
  if (eForm.value.unlimitedTime) {
    return {
      startAt: null as string | null,
      endAt: null as string | null,
      timeText: '不限时',
    }
  }
  const r = eForm.value.range
  if (!r || r.length !== 2) {
    return { startAt: null, endAt: null, timeText: '不限时' }
  }
  return {
    startAt: r[0],
    endAt: r[1],
    timeText: `${r[0].slice(0, 10)} ~ ${r[1].slice(0, 10)}`,
  }
}

function savePermHint() {
  ElMessage.success('部门权限已暂存（保存考试后一并提交）')
}

async function submitExam() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  if (eForm.value.paperRows.length === 0) {
    ElMessage.warning('请至少添加一组题库组卷')
    return
  }
  const t = buildTimeFields()
  const permDeptKeys =
    eForm.value.permScope === 'dept' ? treeRef.value?.getCheckedKeys() ?? [] : []

  const payload: TeExam = {
    id: editingId.value ?? `ex-${Date.now()}`,
    name: eForm.value.name,
    openType: openTypeLabel(eForm.value.permScope),
    unlimitedTime: eForm.value.unlimitedTime,
    startAt: t.startAt,
    endAt: t.endAt,
    timeText: t.timeText,
    totalScore: paperScoreTotal.value,
    passScore: eForm.value.passScore,
    status: '正常',
    paperRows: eForm.value.paperRows.map((p) => ({ ...p })),
    permScope: eForm.value.permScope,
    permDeptKeys: permDeptKeys as string[],
  }

  if (editingId.value) {
    const idx = exams.value.findIndex((e) => e.id === editingId.value)
    if (idx >= 0) exams.value[idx] = payload
  } else {
    exams.value.unshift(payload)
  }
  ElMessage.success('保存成功')
  view.value = 'list'
}
</script>

<style scoped>
.te-panel {
  padding: 4px 2px 8px;
}
.te-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.te-mt {
  margin-top: 12px;
}
.te-mt-lg {
  margin-top: 24px;
}
.te-mb {
  margin-bottom: 12px;
}
.te-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.te-total {
  font-size: 13px;
  color: #606266;
  margin-right: auto;
}
.te-form-card :deep(.el-card__body) {
  padding: 18px 20px;
}
.te-section-title {
  font-weight: 700;
  font-size: 15px;
  color: #303133;
  margin-bottom: 12px;
}
.te-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20px 0 12px;
}
.te-score-display {
  font-weight: 600;
  color: #f56c6c;
  font-size: 16px;
}
.te-hint {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
.te-tree {
  max-width: 480px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 8px;
}
.te-form-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
}
</style>
