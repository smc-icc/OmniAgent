<template>
  <el-card shadow="never" class="memo-card">
    <template #header>
      <div class="memo-head">
        <div>
          <span class="memo-title">工作备忘录</span>
          <span class="memo-sub">与个人看板共用后端备忘数据</span>
        </div>
      </div>
    </template>

    <div class="memo-toolbar">
      <el-input
        v-model="query"
        placeholder="搜索标题或正文"
        clearable
        class="memo-search"
        size="default"
      />
      <el-select v-model="filterStatus" placeholder="状态" clearable style="width: 120px" size="default">
        <el-option label="进行中" value="open" />
        <el-option label="已完成" value="done" />
      </el-select>
      <el-select v-model="filterCategory" placeholder="分类" clearable style="width: 120px" size="default">
        <el-option label="工作" value="work" />
        <el-option label="个人" value="personal" />
        <el-option label="客户跟进" value="followup" />
      </el-select>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建备忘录</el-button>
    </div>

    <el-table
      :data="filteredRows"
      stripe
      border
      size="small"
      class="memo-table"
      empty-text="暂无备忘录，点击「新建备忘录」添加"
    >
      <el-table-column type="index" label="#" width="50" />
      <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
      <el-table-column prop="category" label="分类" width="96">
        <template #default="{ row }">
          <el-tag size="small" type="info">{{ categoryLabel(row.category) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="priority" label="优先级" width="88">
        <template #default="{ row }">
          <el-tag size="small" :type="priorityTagType(row.priority)">{{ priorityLabel(row.priority) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="88">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'done' ? 'success' : 'warning'">
            {{ row.status === 'done' ? '已完成' : '进行中' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remindAt" label="提醒时间" width="150" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.remindAt || '—' }}
        </template>
      </el-table-column>
      <el-table-column prop="updatedAt" label="更新时间" width="158" />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button
            v-if="row.status === 'open'"
            link
            type="success"
            size="small"
            @click="toggleDone(row)"
          >
            完成
          </el-button>
          <el-button v-else link size="small" @click="toggleDone(row)">恢复</el-button>
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑备忘录' : '新建备忘录'"
      width="520px"
      destroy-on-close
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="88px" label-position="right">
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" placeholder="简要概括" maxlength="120" show-word-limit />
        </el-form-item>
        <el-form-item label="分类" prop="category">
          <el-select v-model="form.category" style="width: 100%">
            <el-option label="工作" value="work" />
            <el-option label="个人" value="personal" />
            <el-option label="客户跟进" value="followup" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级" prop="priority">
          <el-radio-group v-model="form.priority">
            <el-radio value="high">高</el-radio>
            <el-radio value="medium">中</el-radio>
            <el-radio value="low">低</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="提醒时间">
          <el-date-picker
            v-model="form.remindAt"
            type="datetime"
            placeholder="可选"
            style="width: 100%"
            value-format="YYYY-MM-DD HH:mm"
            format="YYYY-MM-DD HH:mm"
          />
        </el-form-item>
        <el-form-item label="正文" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="8"
            placeholder="详细说明、接口地址、联系人等"
            maxlength="4000"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fetchMemos, createMemo, patchMemo } from '@/api/dashboard'

type MemoCategory = 'work' | 'personal' | 'followup'
type MemoPriority = 'high' | 'medium' | 'low'
type MemoStatus = 'open' | 'done'

interface WorkMemo {
  id: string
  title: string
  content: string
  category: MemoCategory
  priority: MemoPriority
  status: MemoStatus
  remindAt: string | null
  createdAt: string
  updatedAt: string
}

function nowStr() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const rows = ref<WorkMemo[]>([])
const query = ref('')
const filterStatus = ref<MemoStatus | ''>('')
const filterCategory = ref<MemoCategory | ''>('')

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()

const form = ref({
  title: '',
  content: '',
  category: 'work' as MemoCategory,
  priority: 'medium' as MemoPriority,
  remindAt: '' as string | null,
})

const rules: FormRules = {
  title: [{ required: true, message: '请填写标题', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
  priority: [{ required: true, message: '请选择优先级', trigger: 'change' }],
  content: [{ required: true, message: '请填写正文', trigger: 'blur' }],
}

const filteredRows = computed(() => {
  let list = rows.value
  const q = query.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (m) =>
        m.title.toLowerCase().includes(q)
        || m.content.toLowerCase().includes(q),
    )
  }
  if (filterStatus.value) list = list.filter((m) => m.status === filterStatus.value)
  if (filterCategory.value) list = list.filter((m) => m.category === filterCategory.value)
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})

function categoryLabel(c: MemoCategory) {
  return ({ work: '工作', personal: '个人', followup: '客户跟进' } as const)[c]
}

function priorityLabel(p: MemoPriority) {
  return ({ high: '高', medium: '中', low: '低' } as const)[p]
}

function priorityTagType(p: MemoPriority): 'danger' | 'warning' | 'info' {
  if (p === 'high') return 'danger'
  if (p === 'medium') return 'warning'
  return 'info'
}

async function reloadFromApi() {
  try {
    const items = await fetchMemos(true)
    const t = nowStr()
    rows.value = items.map((m) => ({
      id: m.id,
      title: m.title,
      content: m.content || '',
      category: 'work' as MemoCategory,
      priority: 'medium' as MemoPriority,
      status: (m.done ? 'done' : 'open') as MemoStatus,
      remindAt: m.due_at ? m.due_at.slice(0, 16).replace('T', ' ') : null,
      createdAt: t,
      updatedAt: t,
    }))
  } catch {
    rows.value = []
  }
}

function openCreate() {
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function openEdit(row: WorkMemo) {
  editingId.value = row.id
  form.value = {
    title: row.title,
    content: row.content,
    category: row.category,
    priority: row.priority,
    remindAt: row.remindAt,
  }
  dialogVisible.value = true
}

function resetForm() {
  form.value = {
    title: '',
    content: '',
    category: 'work',
    priority: 'medium',
    remindAt: null,
  }
  formRef.value?.clearValidate()
}

async function submitForm() {
  await formRef.value?.validate()
  try {
    const due = form.value.remindAt
      ? new Date(form.value.remindAt.replace(' ', 'T')).toISOString()
      : null
    if (editingId.value) {
      await patchMemo(editingId.value, {
        title: form.value.title.trim(),
        content: form.value.content.trim(),
        due_at: due,
      })
      ElMessage.success('已保存')
    } else {
      await createMemo({
        title: form.value.title.trim(),
        content: form.value.content.trim(),
        due_at: due,
      })
      ElMessage.success('已创建')
    }
    dialogVisible.value = false
    await reloadFromApi()
  } catch {
    ElMessage.error('保存失败')
  }
}

async function toggleDone(row: WorkMemo) {
  try {
    await patchMemo(row.id, { done: row.status !== 'done' })
    ElMessage.success(row.status === 'open' ? '已标记完成' : '已恢复')
    await reloadFromApi()
  } catch {
    ElMessage.error('更新失败')
  }
}

async function remove(row: WorkMemo) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.title}」？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await patchMemo(row.id, { done: true })
    ElMessage.success('已删除（标记完成）')
    await reloadFromApi()
  } catch {
    ElMessage.error('操作失败')
  }
}

onMounted(() => {
  void reloadFromApi()
})
</script>

<style scoped>
.memo-card :deep(.el-card__header) {
  padding: 14px 18px;
}
.memo-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.memo-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.memo-sub {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  font-weight: normal;
  color: var(--oa-muted, #909399);
}
.memo-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.memo-search {
  width: 240px;
  max-width: 100%;
}
.memo-table {
  width: 100%;
}
</style>
