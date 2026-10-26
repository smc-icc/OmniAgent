<template>
  <div class="cm-root">
    <header class="cm-hd">
      <h2 class="cm-title">课程管理</h2>
      <div class="cm-actions">
        <el-button type="primary" @click="ElMessage.info('演示：课程类型维护可在后续对接字典管理。')">
          课程类型
        </el-button>
        <el-button type="primary" @click="openCreate">新增</el-button>
        <el-button type="primary" @click="batchVisible = true">课程导入/导出</el-button>
        <el-button type="danger" :disabled="!selectedIds.length" @click="bulkDelete">批量删除</el-button>
      </div>
    </header>

    <el-tabs v-model="activeKind" class="cm-tabs" @tab-change="onTabChange">
      <el-tab-pane label="学科课程" name="subject" />
      <el-tab-pane label="拓展课程" name="extension" />
    </el-tabs>

    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="rows"
      row-key="id"
      border
      stripe
      size="small"
      class="cm-table"
      @selection-change="onSel"
    >
      <el-table-column type="selection" width="48" />
      <template v-if="activeKind === 'subject'">
        <el-table-column prop="name" label="科目名称" min-width="140" />
        <el-table-column prop="subject_category" label="所属学科" width="100" />
        <el-table-column prop="tags_display" label="课程标签" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.tags_display || '—' }}</template>
        </el-table-column>
        <el-table-column prop="grades_display" label="开课年级" min-width="280" show-overflow-tooltip />
      </template>
      <template v-else>
        <el-table-column prop="name" label="课程名称" min-width="160" />
        <el-table-column prop="extension_type_label" label="课程类型" width="140" />
        <el-table-column prop="tags_display" label="课程标签" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.tags_display || '—' }}</template>
        </el-table-column>
      </template>
      <el-table-column label="操作" width="88" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">修改</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增 / 修改 -->
    <el-dialog
      v-model="formVisible"
      :title="formTitle"
      width="520px"
      destroy-on-close
      @opened="onFormOpened"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="formRules"
        label-position="top"
        size="default"
      >
        <template v-if="activeKind === 'subject'">
          <el-form-item label="科目名称" prop="name" required>
            <el-input v-model="form.name" placeholder="请输入不超过20个字的科目名称" maxlength="20" show-word-limit />
          </el-form-item>
          <el-form-item label="所属学科" prop="subject_category" required>
            <el-select v-model="form.subject_category" placeholder="请选择学科" style="width: 100%" filterable>
              <el-option v-for="s in meta?.subject_categories ?? []" :key="s.id" :label="s.label" :value="s.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="开课年级" prop="grade_ids" required>
            <el-select
              v-model="form.grade_ids"
              multiple
              collapse-tags
              collapse-tags-tooltip
              placeholder="请选择开课年级"
              style="width: 100%"
              filterable
            >
              <el-option v-for="g in meta?.grades_full_labels ?? []" :key="g.id" :label="g.label" :value="g.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="课程标签" prop="tags">
            <el-select
              v-model="form.tags"
              multiple
              collapse-tags
              placeholder="课程标签，可为空"
              clearable
              style="width: 100%"
            >
              <el-option v-for="t in meta?.tag_options ?? []" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="课程名称" prop="name" required>
            <el-input v-model="form.name" placeholder="请输入课程名称" maxlength="40" show-word-limit />
          </el-form-item>
          <el-form-item label="课程类型" prop="extension_type" required>
            <el-select v-model="form.extension_type" placeholder="请选择课程类型" style="width: 100%">
              <el-option v-for="e in meta?.extension_types ?? []" :key="e.id" :label="e.label" :value="e.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="课程标签" prop="tags">
            <el-select v-model="form.tags" multiple collapse-tags placeholder="可为空" clearable style="width: 100%">
              <el-option v-for="t in meta?.tag_options ?? []" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formSaving" @click="submitForm">提交</el-button>
      </template>
    </el-dialog>

    <!-- 课程批量操作 -->
    <el-dialog v-model="batchVisible" title="课程批量操作" width="640px" destroy-on-close @close="batchImportFile = null">
      <el-radio-group v-model="batchMode" class="cm-batch-mode">
        <el-radio-button value="import">批量导入</el-radio-button>
        <el-radio-button value="export">批量导出</el-radio-button>
      </el-radio-group>

      <div v-if="batchMode === 'import'" class="cm-batch-body">
        <p class="cm-batch-intro">
          如需批量导入 <strong>{{ activeKind === 'subject' ? '学科课程' : '拓展课程' }}</strong> 数据，可在此下载信息上传模板，填写完成后上传至系统批量导入。
        </p>
        <div class="cm-batch-step">
          <div class="cm-step-label">1. 选择校区</div>
          <el-select v-model="batchCampusId" placeholder="请选择校区" style="width: 100%">
            <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </div>
        <div class="cm-batch-step">
          <div class="cm-step-label">2. 点击下载 {{ activeKind === 'subject' ? '学科课程' : '拓展课程' }}信息上传模板</div>
          <el-button @click="downloadTemplate">下载{{ activeKind === 'subject' ? '学科课程' : '拓展' }}模板</el-button>
        </div>
        <div class="cm-batch-step">
          <div class="cm-step-label">3. 在模板中填写信息后，点击上传（支持扩展名：.xls、.xlsx）</div>
          <el-upload
            class="cm-upload"
            drag
            :auto-upload="false"
            :limit="1"
            accept=".xls,.xlsx"
            :on-change="onBatchFile"
            :on-remove="() => (batchImportFile = null)"
          >
            <el-icon class="cm-upload-ic"><UploadFilled /></el-icon>
            <div class="el-upload__text">将文件拖到此处，或 <em>点击上传</em></div>
          </el-upload>
        </div>
      </div>

      <div v-else class="cm-batch-body cm-batch-export">
        <p class="cm-batch-tip">点击导出{{ activeKind === 'subject' ? '学科课程' : '拓展课程' }}信息表格</p>
        <el-button @click="runExport">导出{{ activeKind === 'subject' ? '学科课程' : '拓展课程' }}信息</el-button>
      </div>

      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button v-if="batchMode === 'import'" type="primary" @click="confirmBatchImport">确定</el-button>
        <el-button v-else type="primary" @click="batchVisible = false">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { UploadFilled } from '@element-plus/icons-vue'
import type { UploadFile } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  fetchCourseMeta,
  fetchCourses,
  getCourseBatchTemplate,
  patchCourse,
  postCourse,
  postCourseBatchExport,
  postCourseBatchImport,
  postCoursesBulkDelete,
  type CourseKind,
  type CourseMeta,
  type CourseRow,
} from '@/api/courseManagement'

const activeKind = ref<CourseKind>('subject')
const loading = ref(false)
const rows = ref<CourseRow[]>([])
const meta = ref<CourseMeta | null>(null)
const tableRef = ref<{ clearSelection: () => void } | null>(null)
const selectedIds = ref<string[]>([])

const formVisible = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const formSaving = ref(false)
const form = ref({
  name: '',
  subject_category: '',
  grade_ids: [] as string[],
  tags: [] as string[],
  extension_type: '',
})

const formTitle = computed(() => {
  if (activeKind.value === 'subject') {
    return formMode.value === 'create' ? '新增科目' : '修改科目'
  }
  return formMode.value === 'create' ? '新增拓展课程' : '修改拓展课程'
})

const formRules = computed<FormRules>(() => {
  if (activeKind.value === 'subject') {
    return {
      name: [{ required: true, message: '请输入科目名称', trigger: 'blur' }],
      subject_category: [{ required: true, message: '请选择所属学科', trigger: 'change' }],
      grade_ids: [{ type: 'array', required: true, message: '请选择开课年级', trigger: 'change' }],
    }
  }
  return {
    name: [{ required: true, message: '请输入课程名称', trigger: 'blur' }],
    extension_type: [{ required: true, message: '请选择课程类型', trigger: 'change' }],
  }
})

async function loadList() {
  loading.value = true
  try {
    rows.value = await fetchCourses(activeKind.value)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function onTabChange() {
  selectedIds.value = []
  tableRef.value?.clearSelection()
  loadList()
}

function onSel(s: CourseRow[]) {
  selectedIds.value = s.map((r) => r.id)
}

async function loadMeta() {
  meta.value = await fetchCourseMeta()
}

function onFormOpened() {
  if (!meta.value) loadMeta()
}

function openCreate() {
  formMode.value = 'create'
  editingId.value = null
  resetForm()
  formVisible.value = true
}

function openEdit(row: CourseRow) {
  formMode.value = 'edit'
  editingId.value = row.id
  if (row.kind === 'subject') {
    form.value = {
      name: row.name,
      subject_category: row.subject_category,
      grade_ids: [...row.grade_ids],
      tags: [...row.tags],
      extension_type: '',
    }
  } else {
    form.value = {
      name: row.name,
      subject_category: '',
      grade_ids: [],
      tags: [...row.tags],
      extension_type: row.extension_type,
    }
  }
  formVisible.value = true
}

function resetForm() {
  form.value = {
    name: '',
    subject_category: '',
    grade_ids: [],
    tags: [],
    extension_type: '',
  }
}

async function submitForm() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  formSaving.value = true
  try {
    if (activeKind.value === 'subject') {
      if (formMode.value === 'create') {
        await postCourse({
          kind: 'subject',
          name: form.value.name,
          subject_category: form.value.subject_category,
          grade_ids: form.value.grade_ids,
          tags: form.value.tags.length ? form.value.tags : undefined,
        })
        ElMessage.success('已新增')
      } else if (editingId.value) {
        await patchCourse(editingId.value, {
          name: form.value.name,
          subject_category: form.value.subject_category,
          grade_ids: form.value.grade_ids,
          tags: form.value.tags,
        })
        ElMessage.success('已保存')
      }
    } else {
      if (formMode.value === 'create') {
        await postCourse({
          kind: 'extension',
          name: form.value.name,
          extension_type: form.value.extension_type,
          tags: form.value.tags.length ? form.value.tags : undefined,
        })
        ElMessage.success('已新增')
      } else if (editingId.value) {
        await patchCourse(editingId.value, {
          name: form.value.name,
          extension_type: form.value.extension_type,
          tags: form.value.tags,
        })
        ElMessage.success('已保存')
      }
    }
    formVisible.value = false
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    formSaving.value = false
  }
}

async function bulkDelete() {
  if (!selectedIds.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 条课程？`, '批量删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await postCoursesBulkDelete(selectedIds.value)
    ElMessage.success('已删除')
    tableRef.value?.clearSelection()
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

const batchVisible = ref(false)
const batchMode = ref<'import' | 'export'>('import')
const batchCampusId = ref('')
const batchImportFile = ref<File | null>(null)

watch(batchVisible, (v) => {
  if (v && meta.value?.campuses?.length) {
    batchCampusId.value = meta.value.campuses[0]!.id
  }
})

function onBatchFile(uploadFile: UploadFile) {
  batchImportFile.value = uploadFile.raw ?? null
}

async function downloadTemplate() {
  try {
    const r = await getCourseBatchTemplate(activeKind.value)
    ElMessage.success(r.message)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

async function runExport() {
  try {
    const r = await postCourseBatchExport(activeKind.value)
    ElMessage.success(r.message)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

async function confirmBatchImport() {
  if (!batchCampusId.value) {
    ElMessage.warning('请选择校区')
    return
  }
  try {
    const r = await postCourseBatchImport(activeKind.value, batchCampusId.value)
    ElMessage.success(r.message + (batchImportFile.value ? `（已选择文件：${batchImportFile.value.name}）` : ''))
    batchVisible.value = false
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

onMounted(async () => {
  await loadMeta()
  if (meta.value?.campuses?.length) batchCampusId.value = meta.value.campuses[0]!.id
  await loadList()
})
</script>

<style scoped>
.cm-root {
  padding: 16px 20px 24px;
  min-height: 480px;
}
.cm-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.cm-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.cm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cm-tabs {
  margin-bottom: 12px;
}
.cm-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.cm-table {
  width: 100%;
}
.cm-batch-mode {
  margin-bottom: 16px;
}
.cm-batch-body {
  background: #f5f7fa;
  border-radius: 6px;
  padding: 16px;
}
.cm-batch-intro {
  margin: 0 0 16px;
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
}
.cm-batch-step {
  margin-bottom: 16px;
}
.cm-step-label {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 8px;
}
.cm-upload {
  width: 100%;
}
.cm-upload :deep(.el-upload-dragger) {
  width: 100%;
}
.cm-upload-ic {
  font-size: 48px;
  color: var(--el-color-primary);
  margin-bottom: 8px;
}
.cm-batch-export {
  text-align: center;
  padding: 24px 16px;
}
.cm-batch-tip {
  margin: 0 0 16px;
  font-size: 14px;
  color: #606266;
}
</style>
