<template>
  <div class="tch-root">
    <header class="tch-hd">
      <h2 class="tch-title">教师管理</h2>
      <div class="tch-hd-actions">
        <el-button type="primary" @click="openDingDialog">
          <el-icon class="tch-ic"><Refresh /></el-icon>
          同步钉钉通讯录
        </el-button>
        <el-button @click="openBatchDrawer">
          <el-icon class="tch-ic"><Document /></el-icon>
          教师导入/导出/修改
        </el-button>
      </div>
    </header>

    <div class="tch-layout">
      <aside class="tch-aside">
        <el-input
          v-model="teacherSearchKw"
          placeholder="搜索教师姓名"
          clearable
          class="tch-filter"
          :prefix-icon="Search"
          @keyup.enter="applySearch"
        />
        <el-button type="primary" size="small" class="tch-search-btn" @click="applySearch">查找</el-button>
        <el-tree
          ref="treeRef"
          class="tch-tree"
          :data="treeData"
          :props="treeProps"
          node-key="id"
          highlight-current
          default-expand-all
          @node-click="onTreeNodeClick"
        />
      </aside>

      <main class="tch-main">
        <el-tabs v-model="activeTab" class="tch-tabs">
          <el-tab-pane label="教师数据" name="data">
            <div class="tch-toolbar">
              <el-button type="primary" size="small" @click="openAddDrawer">添加教师</el-button>
              <el-button size="small" :disabled="!selectedRows.length" @click="bulkDelete">批量删除</el-button>
            </div>
            <el-table
              ref="tableRef"
              v-loading="loading"
              row-key="id"
              :data="list.items"
              border
              stripe
              size="small"
              class="tch-table"
              @selection-change="onSelectionChange"
            >
              <el-table-column type="selection" width="48" />
              <el-table-column label="姓名" min-width="100">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openEditDrawer(row)">{{ row.name }}</el-button>
                </template>
              </el-table-column>
              <el-table-column
                prop="teaching_display"
                label="任教班级"
                min-width="220"
                show-overflow-tooltip
              />
              <el-table-column prop="groups_display" label="教师分组" min-width="120" show-overflow-tooltip />
              <el-table-column prop="card_no" label="教师卡号" width="120">
                <template #default="{ row }">{{ row.card_no || '—' }}</template>
              </el-table-column>
            </el-table>
            <div class="tch-pagination">
              <span class="tch-total">共 {{ list.total }} 条</span>
              <el-pagination
                v-model:current-page="page"
                v-model:page-size="pageSize"
                :total="list.total"
                :page-sizes="[10, 20, 50, 100]"
                layout="sizes, prev, pager, next, jumper"
                background
                @current-change="loadList"
                @size-change="onPageSizeChange"
              />
            </div>
          </el-tab-pane>
        </el-tabs>
      </main>
    </div>

    <!-- 钉钉同步 -->
    <el-dialog v-model="dingVisible" title="同步钉钉通讯录" width="640px" destroy-on-close @opened="onDingOpened">
      <p v-if="!dingResult" class="tch-batch-desc">点击下方「开始同步」将执行演示流程（未调用真实钉钉开放平台）。</p>
      <template v-if="dingResult">
        <el-alert type="success" :closable="false" show-icon class="tch-mb">
          <template #default>{{ dingResult.message }}</template>
        </el-alert>
        <div v-if="dingResult.tips?.length" class="tch-more-tips">
          <p v-for="(t, idx) in dingResult.tips" :key="idx" class="tch-tip-line">{{ t }}</p>
        </div>
      </template>
      <p class="tch-strong"><strong>重要提示</strong></p>
      <ul class="tch-tips">
        <li>同步至系统的<strong>姓名</strong>须与<strong>课表管理</strong>中教师姓名完全一致，否则钉钉手机端无法查看个人课表。</li>
        <li>若同步后找不到教师：核对钉钉通讯录姓名；检查管理后台「辰知教务」应用可见范围是否为<strong>全部员工</strong>。</li>
        <li>请勿将教师只挂在「学校」根部门，应为每位教师指定具体部门。</li>
      </ul>
      <template #footer>
        <el-button @click="dingVisible = false">关闭</el-button>
        <el-button type="primary" :loading="dingLoading" @click="runDingSync">开始同步（演示）</el-button>
      </template>
    </el-dialog>

    <!-- 批量导入导出 -->
    <el-drawer v-model="batchVisible" title="教师数据批量操作" direction="rtl" size="520px" destroy-on-close>
      <el-tabs v-model="batchTab">
        <el-tab-pane label="教师导出/修改" name="export">
          <p class="tch-batch-desc">
            如需在系统中批量修改教师基础信息，可先导出名单，在表格中改好后上传更新（须与系统内<strong>教师姓名</strong>一致以便匹配）。
          </p>
          <div class="tch-step">
            <span class="tch-step-no">1</span>
            导出全部教师名单表格
            <div class="tch-step-act">
              <el-button @click="doBatchExport">导出教师名单</el-button>
            </div>
          </div>
          <div class="tch-step">
            <span class="tch-step-no">2</span>
            在表格中修改后上传（.xls / .xlsx）
            <div class="tch-step-act">
              <el-button type="primary" @click="doBatchImport">上传文件</el-button>
            </div>
          </div>
          <p class="tch-hint">
            批量导入模板列通常包含：姓名、手机号、卡号、教师分组、选择带班、所带科目等；请勿改表头。分班任课一行一条。
          </p>
        </el-tab-pane>
        <el-tab-pane label="教师批量导入" name="import">
          <p class="tch-batch-desc">可下载模板填写后上传，新增教师或按姓名匹配更新卡号、分组等信息。</p>
          <div class="tch-step">
            <span class="tch-step-no">1</span>
            下载导入模板
            <div class="tch-step-act">
              <el-button @click="ElMessage.success('演示：已触发模板下载')">教师导入模板</el-button>
            </div>
          </div>
          <div class="tch-step">
            <span class="tch-step-no">2</span>
            填写后上传
            <div class="tch-step-act">
              <el-button type="primary" @click="doBatchImport">上传教师模板</el-button>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="batchVisible = false">关闭</el-button>
      </template>
    </el-drawer>

    <!-- 添加 / 编辑 -->
    <el-drawer
      v-model="drawerVisible"
      :title="drawerTitle"
      direction="rtl"
      size="440px"
      destroy-on-close
      @opened="onDrawerOpened"
    >
      <div v-if="editing" class="tch-drawer-del">
        <el-button type="danger" link @click="confirmDeleteTeacher">删除教师</el-button>
      </div>
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="88px" label-position="right" size="default">
        <el-form-item label="姓名" prop="name" required>
          <el-input v-model="form.name" placeholder="教师姓名" maxlength="32" show-word-limit />
        </el-form-item>
        <el-form-item label="手机" prop="phone">
          <el-input v-model="form.phone" placeholder="选填" maxlength="11" />
        </el-form-item>
        <el-form-item label="卡号" prop="card_no">
          <el-input v-model="form.card_no" placeholder="请输入30位以内卡号" maxlength="30" />
        </el-form-item>
        <el-form-item label="分组" prop="groups">
          <el-select
            v-model="form.groups"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="教师分组"
            style="width: 100%"
          >
            <el-option v-for="g in groupOptions" :key="g" :label="g" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="任教" prop="teaching">
          <el-select
            :model-value="form.teaching"
            multiple
            disabled
            placeholder="排课/导入课表并应用后自动更新"
            style="width: 100%"
          >
            <el-option v-for="t in form.teaching" :key="t" :label="t" :value="t" />
          </el-select>
          <p class="tch-field-hint">此处只读；任教班级在课表生效后由系统自动同步。</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">确定</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Document, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ElTree, FormInstance, FormRules } from 'element-plus'
import {
  deleteTeacher,
  fetchTeacherGroupOptions,
  fetchTeacherTree,
  fetchTeachers,
  patchTeacher,
  postTeacher,
  postTeacherBatchExport,
  postTeacherBatchImport,
  postTeacherDingTalkSync,
  postTeachersBulkDelete,
  type DingTalkTeacherSyncResult,
  type TeacherRow,
  type TeacherTreeNode,
} from '@/api/teacherManagement'

const treeData = ref<TeacherTreeNode[]>([])
const treeRef = ref<InstanceType<typeof ElTree>>()
const treeProps = { label: 'label', children: 'children' }
const teacherSearchKw = ref('')
const teacherSearchApplied = ref('')
const selectedNodeId = ref('all')

const activeTab = ref('data')
const loading = ref(false)
const page = ref(1)
const pageSize = ref(10)
const list = ref<{ items: TeacherRow[]; total: number; page: number; page_size: number }>({
  items: [],
  total: 0,
  page: 1,
  page_size: 10,
})

const tableRef = ref<{ clearSelection: () => void } | null>(null)
const selectedRows = ref<TeacherRow[]>([])

const dingVisible = ref(false)
const dingLoading = ref(false)
const dingResult = ref<DingTalkTeacherSyncResult | null>(null)

const batchVisible = ref(false)
const batchTab = ref('export')

const drawerVisible = ref(false)
const editing = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formRef = ref<FormInstance>()
const groupOptions = ref<string[]>([])

const form = ref({
  name: '',
  phone: '',
  card_no: '',
  groups: [] as string[],
  teaching: [] as string[],
})

const formRules: FormRules = {
  name: [{ required: true, message: '请输入教师姓名', trigger: 'blur' }],
}

function applySearch() {
  teacherSearchApplied.value = teacherSearchKw.value.trim()
  page.value = 1
  loadList()
}

const drawerTitle = computed(() => {
  if (!form.value.name) return editing.value ? '修改教师' : '添加教师'
  return `${form.value.name}（${form.value.name}）`
})

async function loadTree() {
  treeData.value = await fetchTeacherTree()
  await nextTick()
  treeRef.value?.setCurrentKey(selectedNodeId.value)
}

async function loadList() {
  loading.value = true
  try {
    list.value = await fetchTeachers({
      node_id: selectedNodeId.value,
      keyword: teacherSearchApplied.value,
      page: page.value,
      page_size: pageSize.value,
    })
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function onTreeNodeClick(data: TeacherTreeNode) {
  selectedNodeId.value = data.id
  page.value = 1
  teacherSearchApplied.value = teacherSearchKw.value.trim()
  loadList()
}

function onPageSizeChange() {
  page.value = 1
  loadList()
}

function onSelectionChange(rows: TeacherRow[]) {
  selectedRows.value = rows
}

function openDingDialog() {
  dingVisible.value = true
}

function onDingOpened() {
  dingResult.value = null
}

async function runDingSync() {
  dingLoading.value = true
  try {
    dingResult.value = await postTeacherDingTalkSync()
    ElMessage.success('演示：同步流程已执行')
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '同步失败')
  } finally {
    dingLoading.value = false
  }
}

function openBatchDrawer() {
  batchVisible.value = true
}

async function doBatchExport() {
  try {
    await postTeacherBatchExport()
    ElMessage.success('演示：已触发导出任务')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败')
  }
}

async function doBatchImport() {
  try {
    await postTeacherBatchImport()
    ElMessage.success('演示：已接收上传')
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  }
}

async function onDrawerOpened() {
  try {
    groupOptions.value = await fetchTeacherGroupOptions()
  } catch {
    groupOptions.value = ['行政组', '德育组', '教务组']
  }
}

function openAddDrawer() {
  editing.value = false
  editingId.value = null
  form.value = {
    name: '',
    phone: '',
    card_no: '',
    groups: [],
    teaching: [],
  }
  drawerVisible.value = true
}

function openEditDrawer(row: TeacherRow) {
  editing.value = true
  editingId.value = row.id
  form.value = {
    name: row.name,
    phone: row.phone,
    card_no: row.card_no,
    groups: [...row.groups],
    teaching: [...row.teaching_assignments],
  }
  drawerVisible.value = true
}

async function submitForm() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    if (editing.value && editingId.value) {
      await patchTeacher(editingId.value, {
        name: form.value.name,
        phone: form.value.phone,
        card_no: form.value.card_no,
        groups: form.value.groups,
      })
      ElMessage.success('已保存')
    } else {
      await postTeacher({
        name: form.value.name,
        phone: form.value.phone || undefined,
        card_no: form.value.card_no || undefined,
        groups: form.value.groups.length ? form.value.groups : undefined,
      })
      ElMessage.success('已添加教师')
    }
    drawerVisible.value = false
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function confirmDeleteTeacher() {
  if (!editingId.value) return
  try {
    await ElMessageBox.confirm('确定删除该教师？', '删除教师', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteTeacher(editingId.value)
    ElMessage.success('已删除')
    drawerVisible.value = false
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

async function bulkDelete() {
  const ids = selectedRows.value.map((r) => r.id)
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 名教师？`, '批量删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await postTeachersBulkDelete(ids)
    ElMessage.success('已删除')
    tableRef.value?.clearSelection()
    await loadList()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

onMounted(async () => {
  await loadTree()
  await loadList()
})
</script>

<style scoped>
.tch-root {
  padding: 16px 20px 24px;
  min-height: 520px;
}
.tch-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.tch-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.tch-hd-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tch-ic {
  margin-right: 4px;
  vertical-align: middle;
}
.tch-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.tch-aside {
  width: 240px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px;
}
.tch-filter {
  margin-bottom: 8px;
}
.tch-search-btn {
  width: 100%;
  margin-bottom: 10px;
}
.tch-tree {
  max-height: 480px;
  overflow: auto;
  font-size: 13px;
}
.tch-main {
  flex: 1;
  min-width: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 16px 16px;
}
.tch-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.tch-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.tch-table {
  width: 100%;
}
.tch-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.tch-total {
  font-size: 13px;
  color: #606266;
  margin-right: auto;
}
.tch-mb {
  margin-bottom: 12px;
}
.tch-strong {
  margin: 0 0 8px;
  font-size: 13px;
  color: #303133;
}
.tch-tips {
  margin: 0 0 12px;
  padding-left: 20px;
  font-size: 13px;
  color: #606266;
  line-height: 1.65;
}
.tch-more-tips {
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 12px;
  color: #606266;
}
.tch-tip-line {
  margin: 0 0 6px;
}
.tch-batch-desc {
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
  margin: 0 0 16px;
}
.tch-step {
  margin-bottom: 16px;
  font-size: 13px;
  color: #303133;
}
.tch-step-no {
  display: inline-block;
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border-radius: 50%;
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
  font-size: 12px;
  margin-right: 8px;
  vertical-align: middle;
}
.tch-step-act {
  margin-top: 8px;
  margin-left: 30px;
}
.tch-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.55;
  margin: 8px 0 0;
}
.tch-drawer-del {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.tch-field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
