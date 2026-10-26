<template>
  <div v-if="view === 'list'" class="te-panel">
    <el-input
      v-model="searchName"
      placeholder="搜索题库名称"
      clearable
      class="te-qb-search"
    />
    <el-button type="primary" :icon="Plus" class="te-mt" @click="openAdd">添加</el-button>

    <el-table
      :data="pagedRows"
      size="small"
      class="te-mt"
      @selection-change="(s: TeQuestionBank[]) => (selection = s)"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column prop="id" label="题库ID" min-width="160" show-overflow-tooltip />
      <el-table-column prop="name" label="题库名称" min-width="160" show-overflow-tooltip />
      <el-table-column prop="singleCount" label="单选题数量" width="110" align="center" />
      <el-table-column prop="multiCount" label="多选题数量" width="110" align="center" />
      <el-table-column prop="judgeCount" label="判断题数量" width="110" align="center" />
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

  <div v-else class="te-panel te-form-page">
    <el-card shadow="never" class="te-form-card">
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="题库名称" prop="name" required>
          <el-input v-model="form.name" placeholder="请输入题库名称" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="题库备注">
          <el-input v-model="form.remark" type="textarea" :rows="5" placeholder="可选" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
    </el-card>
    <div class="te-form-actions">
      <el-button type="primary" @click="submitAdd">保存</el-button>
      <el-button @click="view = 'list'">返回</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { recalcBankCounts, useTrainingExam, type TeQuestionBank } from './trainingExamContext'

const { banks, questions } = useTrainingExam()

const view = ref<'list' | 'add'>('list')
const searchName = ref('')
const page = ref(1)
const pageSize = ref(10)
const selection = ref<TeQuestionBank[]>([])

const filteredRows = computed(() => {
  const q = searchName.value.trim()
  if (!q) return banks.value
  return banks.value.filter((b) => b.name.includes(q))
})

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

const formRef = ref<FormInstance>()
const form = ref({ name: '', remark: '' })
const rules: FormRules = {
  name: [{ required: true, message: '请输入题库名称', trigger: 'blur' }],
}

function openAdd() {
  form.value = { name: '', remark: '' }
  view.value = 'add'
}

async function submitAdd() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const createdAt = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  banks.value.unshift({
    id,
    name: form.value.name,
    singleCount: 0,
    multiCount: 0,
    judgeCount: 0,
    createdAt,
    remark: form.value.remark,
  })
  recalcBankCounts(banks.value, questions.value)
  ElMessage.success('保存成功')
  view.value = 'list'
}
</script>

<style scoped>
.te-panel {
  padding: 4px 2px 8px;
}
.te-qb-search {
  max-width: 320px;
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
.te-form-page .te-form-card :deep(.el-card__body) {
  padding: 20px 24px;
}
.te-form-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
}
</style>
