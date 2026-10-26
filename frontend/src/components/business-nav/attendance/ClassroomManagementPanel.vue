<template>
  <div class="cr-root">
    <header class="cr-hd">
      <h2 class="cr-title">教室管理</h2>
      <div class="cr-actions">
        <el-select v-model="filterCampusId" placeholder="请选择校区" clearable style="width: 240px" size="default">
          <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-button type="primary" @click="loadList">查询</el-button>
        <div class="cr-actions-right">
          <el-button type="primary" @click="openCreate">新增</el-button>
          <el-button type="primary" @click="batchVisible = true">教室导入/导出</el-button>
          <el-button type="danger" plain :disabled="!selectedIds.length" @click="bulkDelete">批量删除</el-button>
        </div>
      </div>
    </header>

    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="rows"
      row-key="id"
      border
      stripe
      size="small"
      class="cr-table"
      @selection-change="onSel"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column label="教室名称" min-width="140">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">{{ row.name }}</el-button>
        </template>
      </el-table-column>
      <el-table-column prop="campus_name" label="所属校区" min-width="220" show-overflow-tooltip />
      <el-table-column min-width="160" show-overflow-tooltip>
        <template #header>
          <span>开课课程</span>
          <el-tooltip content="排课后将自动关联在此展示；也可手动选择默认开课课程。" placement="top">
            <el-icon class="cr-info-ic"><InfoFilled /></el-icon>
          </el-tooltip>
        </template>
        <template #default="{ row }">{{ row.courses_display }}</template>
      </el-table-column>
      <el-table-column label="教室容量" width="100">
        <template #default="{ row }">{{ row.capacity ?? '—' }}</template>
      </el-table-column>
    </el-table>

    <!-- 添加/编辑教室 -->
    <el-dialog
      v-model="formVisible"
      :title="formMode === 'create' ? '添加教室' : '编辑教室'"
      width="520px"
      destroy-on-close
      @opened="ensureMeta"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-position="top" size="default">
        <el-form-item label="教室名称" prop="name" required>
          <el-input v-model="form.name" placeholder="请输入教室名称" maxlength="40" show-word-limit />
          <p class="cr-hint">教室名称请和楼层关联，升学年后教室名称不变</p>
        </el-form-item>
        <el-form-item label="所属校区" prop="campus_id" required>
          <el-select v-model="form.campus_id" placeholder="请选择所属校区" style="width: 100%">
            <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="开课课程" prop="course_ids">
          <el-select
            v-model="form.course_ids"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="请选择开课课程"
            clearable
            filterable
            style="width: 100%"
          >
            <el-option v-for="co in meta?.course_options ?? []" :key="co.id" :label="co.label" :value="co.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="教室容量" prop="capacity">
          <el-input-number
            v-model="form.capacity"
            :min="0"
            :max="9999"
            placeholder="请输入教室容量"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formSaving" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 教室数据批量操作 -->
    <el-dialog v-model="batchVisible" title="教室数据批量操作" width="680px" destroy-on-close>
      <el-tabs v-model="batchTab">
        <el-tab-pane label="教室导出/修改" name="export">
          <div class="cr-batch-box">
            <p class="cr-batch-desc">
              如需批量修改系统中已有教室基础信息，可先在此导出名单，在表格中完成修改后再上传更新。
            </p>
            <div class="cr-batch-step">
              <div class="cr-step-t">1. 点击导出全部教室名单表格</div>
              <el-button @click="runBatchExport">导出教室名单</el-button>
            </div>
            <div class="cr-batch-step">
              <div class="cr-step-t">2. 在表格中修改信息后，点击上传（支持扩展名：.xls、.xlsx）</div>
              <el-upload
                class="cr-upload"
                drag
                :auto-upload="false"
                :limit="1"
                accept=".xls,.xlsx"
                :on-change="onBatchFile"
                :on-remove="() => (batchFile = null)"
              >
                <el-icon class="cr-upload-ic"><UploadFilled /></el-icon>
                <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
              </el-upload>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="教室批量导入" name="import">
          <div class="cr-batch-box">
            <p class="cr-batch-desc">
              如需批量导入教室名单，可在此下载教室信息模板，填写完成后上传至系统批量导入。
            </p>
            <div class="cr-batch-step">
              <div class="cr-step-t">1. 点击下载教室信息上传模板</div>
              <el-button @click="downloadTpl">下载教室模板</el-button>
            </div>
            <div class="cr-batch-step">
              <div class="cr-step-t">2. 在模板中填写信息后，点击上传（支持扩展名：.xls、.xlsx）</div>
              <el-upload
                class="cr-upload"
                drag
                :auto-upload="false"
                :limit="1"
                accept=".xls,.xlsx"
                :on-change="onBatchFileImport"
                :on-remove="() => (batchImportFile = null)"
              >
                <el-icon class="cr-upload-ic"><UploadFilled /></el-icon>
                <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
              </el-upload>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmBatch">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { InfoFilled, UploadFilled } from '@element-plus/icons-vue'
import type { UploadFile } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  fetchClassroomMeta,
  fetchClassrooms,
  getClassroomBatchTemplate,
  patchClassroom,
  postClassroom,
  postClassroomBatchExport,
  postClassroomBatchImport,
  postClassroomsBulkDelete,
  type ClassroomMeta,
  type ClassroomRow,
} from '@/api/classroomManagement'

const meta = ref<ClassroomMeta | null>(null)
const filterCampusId = ref('')
const loading = ref(false)
const rows = ref<ClassroomRow[]>([])
const tableRef = ref<{ clearSelection: () => void } | null>(null)
const selectedIds = ref<string[]>([])

const formVisible = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const formSaving = ref(false)
const form = ref<{
  name: string
  campus_id: string
  course_ids: string[]
  capacity: number | undefined
}>({
  name: '',
  campus_id: '',
  course_ids: [],
  capacity: undefined,
})

const formRules: FormRules = {
  name: [{ required: true, message: '请输入教室名称', trigger: 'blur' }],
  campus_id: [{ required: true, message: '请选择所属校区', trigger: 'change' }],
}

async function ensureMeta() {
  if (!meta.value) {
    meta.value = await fetchClassroomMeta()
  }
}

async function loadList() {
  loading.value = true
  try {
    rows.value = await fetchClassrooms(filterCampusId.value || undefined)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function onSel(s: ClassroomRow[]) {
  selectedIds.value = s.map((r) => r.id)
}

function openCreate() {
  formMode.value = 'create'
  editingId.value = null
  form.value = {
    name: '',
    campus_id: filterCampusId.value || meta.value?.campuses[0]?.id || '',
    course_ids: [],
    capacity: undefined,
  }
  formVisible.value = true
}

function openEdit(row: ClassroomRow) {
  formMode.value = 'edit'
  editingId.value = row.id
  form.value = {
    name: row.name,
    campus_id: row.campus_id,
    course_ids: [...row.course_ids],
    capacity: row.capacity ?? undefined,
  }
  formVisible.value = true
}

async function submitForm() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  const cap =
    form.value.capacity === undefined || Number.isNaN(form.value.capacity) ? null : form.value.capacity
  formSaving.value = true
  try {
    if (formMode.value === 'create') {
      await postClassroom({
        name: form.value.name,
        campus_id: form.value.campus_id,
        course_ids: form.value.course_ids.length ? form.value.course_ids : undefined,
        capacity: cap,
      })
      ElMessage.success('已添加')
    } else if (editingId.value) {
      await patchClassroom(editingId.value, {
        name: form.value.name,
        campus_id: form.value.campus_id,
        course_ids: form.value.course_ids,
        capacity: cap,
      })
      ElMessage.success('已保存')
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
    await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 间教室？`, '批量删除', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await postClassroomsBulkDelete(selectedIds.value)
    ElMessage.success('已删除')
    tableRef.value?.clearSelection()
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

const batchVisible = ref(false)
const batchTab = ref('export')
const batchFile = ref<File | null>(null)
const batchImportFile = ref<File | null>(null)

function onBatchFile(f: UploadFile) {
  batchFile.value = f.raw ?? null
}

function onBatchFileImport(f: UploadFile) {
  batchImportFile.value = f.raw ?? null
}

async function runBatchExport() {
  try {
    const r = await postClassroomBatchExport()
    ElMessage.success(r.message)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

async function downloadTpl() {
  try {
    const r = await getClassroomBatchTemplate()
    ElMessage.success(r.message)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

async function confirmBatch() {
  try {
    const r = await postClassroomBatchImport()
    const extra =
      (batchTab.value === 'export' && batchFile.value ? `（已选：${batchFile.value.name}）` : '') ||
      (batchTab.value === 'import' && batchImportFile.value ? `（已选：${batchImportFile.value.name}）` : '')
    ElMessage.success(r.message + extra)
    batchVisible.value = false
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

onMounted(async () => {
  await ensureMeta()
  if (meta.value?.campuses.length) {
    filterCampusId.value = meta.value.campuses[0]!.id
  }
  await loadList()
})
</script>

<style scoped>
.cr-root {
  padding: 16px 20px 24px;
  min-height: 480px;
}
.cr-hd {
  margin-bottom: 16px;
}
.cr-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.cr-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.cr-actions-right {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cr-table {
  width: 100%;
}
.cr-table :deep(.el-table__header th) {
  background: #f5f7fa !important;
}
.cr-info-ic {
  margin-left: 4px;
  vertical-align: middle;
  color: #909399;
  cursor: help;
}
.cr-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.cr-batch-box {
  background: #f5f7fa;
  border-radius: 6px;
  padding: 16px;
  min-height: 200px;
}
.cr-batch-desc {
  margin: 0 0 16px;
  font-size: 13px;
  color: #606266;
  line-height: 1.65;
}
.cr-batch-step {
  margin-bottom: 18px;
}
.cr-step-t {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 8px;
}
.cr-upload {
  width: 100%;
}
.cr-upload :deep(.el-upload-dragger) {
  width: 100%;
}
.cr-upload-ic {
  font-size: 42px;
  color: var(--el-color-primary);
  margin-bottom: 6px;
}
</style>
