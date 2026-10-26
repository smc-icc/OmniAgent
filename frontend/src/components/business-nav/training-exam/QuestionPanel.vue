<template>
  <div v-if="view === 'list'" class="te-panel">
    <div class="te-filters">
      <el-select v-model="filterType" placeholder="请选择" clearable style="width: 130px">
        <el-option label="单选题" value="单选题" />
        <el-option label="多选题" value="多选题" />
        <el-option label="判断题" value="判断题" />
      </el-select>
      <el-select
        v-model="filterBankId"
        placeholder="选择或搜索题库"
        filterable
        clearable
        style="width: 200px"
      >
        <el-option v-for="b in banks" :key="b.id" :label="b.name" :value="b.id" />
      </el-select>
      <el-input v-model="filterContent" placeholder="题目内容" clearable style="width: 200px" />
      <div class="te-filters-right">
        <el-button :icon="Upload" @click="ElMessage.info('导入功能可对接后端')">导入</el-button>
        <el-button :icon="Download" @click="ElMessage.info('导出功能可对接后端')">导出</el-button>
      </div>
    </div>
    <el-button type="primary" :icon="Plus" class="te-mt" @click="openAdd">添加</el-button>

    <el-table
      :data="pagedRows"
      size="small"
      border
      stripe
      class="te-mt"
      @selection-change="(s: TeQuestion[]) => (selection = s)"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column prop="type" label="题目类型" width="100" />
      <el-table-column prop="content" label="题目内容" min-width="220" show-overflow-tooltip />
      <el-table-column prop="createdAt" label="创建时间" width="168" />
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
  </div>

  <div v-else class="te-panel te-q-add">
    <el-card shadow="never" class="te-form-card">
      <el-form ref="formRef" :model="qForm" :rules="qRules" label-width="100px" label-position="right">
        <el-form-item label="题目类型" prop="type" required>
          <el-select v-model="qForm.type" placeholder="请选择" style="width: 100%; max-width: 360px">
            <el-option label="单选题" value="单选题" />
            <el-option label="多选题" value="多选题" />
            <el-option label="判断题" value="判断题" />
          </el-select>
        </el-form-item>
        <el-form-item label="难度等级" prop="difficulty" required>
          <el-select v-model="qForm.difficulty" placeholder="请选择" style="width: 100%; max-width: 360px">
            <el-option label="普通" value="普通" />
            <el-option label="较难" value="较难" />
          </el-select>
        </el-form-item>
        <el-form-item label="归属题库" prop="bankId" required>
          <el-select
            v-model="qForm.bankId"
            placeholder="选择或搜索题库"
            filterable
            style="width: 100%; max-width: 360px"
          >
            <el-option v-for="b in banks" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="题目内容" prop="content" required>
          <el-input v-model="qForm.content" type="textarea" :rows="4" placeholder="请输入题目内容" />
        </el-form-item>
        <el-form-item label="试题图片">
          <el-upload action="#" :auto-upload="false" :limit="1">
            <el-button type="primary">点击上传</el-button>
          </el-upload>
        </el-form-item>
        <el-form-item label="整题解析">
          <el-input v-model="qForm.analysis" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
      </el-form>

      <div class="te-opt-block">
        <el-button type="primary" size="small" :icon="Plus" @click="addOptionRow">新增答案</el-button>
        <div class="te-opt-title">选项设置</div>
      </div>
      <el-table :data="qForm.options" border size="small" class="te-opt-table">
        <el-table-column label="是否答案" width="100" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.isAnswer">答案</el-checkbox>
          </template>
        </el-table-column>
        <el-table-column label="选项图片" width="130" align="center">
          <template #default>
            <el-upload action="#" :auto-upload="false" :show-file-list="false">
              <el-button size="small">点击上传</el-button>
            </el-upload>
          </template>
        </el-table-column>
        <el-table-column label="答案内容" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.content" type="textarea" :rows="2" placeholder="选项内容" />
          </template>
        </el-table-column>
        <el-table-column label="答案解析" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.optAnalysis" type="textarea" :rows="2" placeholder="可选" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="72" align="center">
          <template #default="{ $index }">
            <el-button type="danger" :icon="Delete" circle size="small" @click="removeOption($index)" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <div class="te-form-actions">
      <el-button type="primary" @click="submitQuestion">保存</el-button>
      <el-button @click="backList">返回</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Upload, Download, Delete } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import {
  recalcBankCounts,
  useTrainingExam,
  type TeQuestion,
  type TeQuestionOption,
} from './trainingExamContext'

const { banks, questions } = useTrainingExam()

const view = ref<'list' | 'add'>('list')
const filterType = ref('')
const filterBankId = ref('')
const filterContent = ref('')
const page = ref(1)
const pageSize = ref(10)
const selection = ref<TeQuestion[]>([])

const filteredRows = computed(() => {
  let r = questions.value
  if (filterType.value) r = r.filter((q) => q.type === filterType.value)
  if (filterBankId.value) r = r.filter((q) => q.bankId === filterBankId.value)
  const c = filterContent.value.trim()
  if (c) r = r.filter((q) => q.content.includes(c))
  return r
})

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

watch([filterType, filterBankId, filterContent, pageSize], () => {
  page.value = 1
})

const formRef = ref<FormInstance>()
const qForm = ref({
  type: '单选题' as TeQuestion['type'],
  difficulty: '普通' as TeQuestion['difficulty'],
  bankId: '',
  content: '',
  analysis: '',
  options: [] as TeQuestionOption[],
})

const qRules: FormRules = {
  type: [{ required: true, message: '请选择题目类型', trigger: 'change' }],
  difficulty: [{ required: true, message: '请选择难度', trigger: 'change' }],
  bankId: [{ required: true, message: '请选择题库', trigger: 'change' }],
  content: [{ required: true, message: '请输入题目内容', trigger: 'blur' }],
}

watch(
  () => qForm.value.type,
  (t) => {
    if (t === '判断题' && qForm.value.options.length < 2) {
      qForm.value.options = [
        { isAnswer: true, content: '正确', optAnalysis: '' },
        { isAnswer: false, content: '错误', optAnalysis: '' },
      ]
    }
  },
)

function openAdd() {
  qForm.value = {
    type: '单选题',
    difficulty: '普通',
    bankId: banks.value[0]?.id ?? '',
    content: '',
    analysis: '',
    options: [
      { isAnswer: true, content: '', optAnalysis: '' },
      { isAnswer: false, content: '', optAnalysis: '' },
      { isAnswer: false, content: '', optAnalysis: '' },
      { isAnswer: false, content: '', optAnalysis: '' },
    ],
  }
  view.value = 'add'
}

function addOptionRow() {
  qForm.value.options.push({ isAnswer: false, content: '', optAnalysis: '' })
}

function removeOption(i: number) {
  if (qForm.value.options.length <= 2) {
    ElMessage.warning('至少保留两个选项')
    return
  }
  qForm.value.options.splice(i, 1)
}

function validateOptions(): boolean {
  const opts = qForm.value.options.filter((o) => o.content.trim())
  if (opts.length < 2) {
    ElMessage.warning('请至少填写两个选项内容')
    return false
  }
  const correct = qForm.value.options.filter((o) => o.isAnswer && o.content.trim())
  if (qForm.value.type === '单选题' || qForm.value.type === '判断题') {
    if (correct.length !== 1) {
      ElMessage.warning('单选题 / 判断题需且仅需一个正确答案')
      return false
    }
  } else if (correct.length < 1) {
    ElMessage.warning('多选题至少选择一个正确答案')
    return false
  }
  return true
}

async function submitQuestion() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  if (!validateOptions()) return
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const createdAt = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  questions.value.unshift({
    id: `q-${Date.now()}`,
    bankId: qForm.value.bankId,
    type: qForm.value.type,
    difficulty: qForm.value.difficulty,
    content: qForm.value.content,
    analysis: qForm.value.analysis,
    options: qForm.value.options.map((o) => ({ ...o })),
    createdAt,
  })
  recalcBankCounts(banks.value, questions.value)
  ElMessage.success('保存成功')
  view.value = 'list'
}

function backList() {
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
  align-items: center;
  gap: 10px;
}
.te-filters-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.te-mt {
  margin-top: 12px;
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
/* 新增答案在选项表格上方，与示意图一致 */
.te-opt-block {
  margin: 20px 0 10px;
}
.te-opt-block .te-opt-title {
  margin-top: 10px;
}
.te-opt-title {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}
.te-opt-table {
  width: 100%;
}
.te-form-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
}
</style>
