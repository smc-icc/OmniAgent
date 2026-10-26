<template>
  <div class="rp-root">
    <!-- 列表 -->
    <template v-if="view === 'list'">
      <header class="rp-hd">
        <h2 class="rp-title">角色权限</h2>
      </header>

      <el-card shadow="never" class="rp-card">
        <template #header>
          <div class="rp-card-hd">
            <span class="rp-card-title">学校管理</span>
            <el-button type="primary" size="small" @click="goAllocation">教师分配</el-button>
          </div>
        </template>
        <el-table :data="overview?.school_section.roles ?? []" border stripe size="small" class="rp-table">
          <el-table-column prop="name" label="角色名称" width="140" />
          <el-table-column prop="description" label="角色说明" min-width="220" show-overflow-tooltip />
          <el-table-column label="成员" min-width="280">
            <template #default="{ row }">
              <template v-if="row.member_preview.length">
                <el-tag v-for="p in row.member_preview" :key="p.id" type="info" class="rp-tag" size="small">
                  {{ p.label }}
                </el-tag>
                <span v-if="row.member_count > row.member_preview.length" class="rp-ellipsis">…</span>
              </template>
              <span class="rp-count">共{{ row.member_count }}人</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="88" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openDetail(row.id)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card v-for="sec in overview?.campus_sections ?? []" :key="sec.campus_id" shadow="never" class="rp-card">
        <template #header>
          <div class="rp-card-hd">
            <div>
              <span class="rp-card-title">校区管理</span>
              <span class="rp-campus-name">{{ sec.campus_name }}</span>
            </div>
            <el-button type="primary" size="small" @click="openCreateRole(sec.campus_id)">新增角色</el-button>
          </div>
        </template>
        <el-table :data="sec.roles" border stripe size="small" class="rp-table">
          <el-table-column prop="name" label="角色名称" width="140" />
          <el-table-column prop="description" label="角色说明" min-width="220" show-overflow-tooltip />
          <el-table-column label="成员" min-width="280">
            <template #default="{ row }">
              <template v-if="row.member_preview.length">
                <el-tag v-for="p in row.member_preview" :key="p.id" type="info" class="rp-tag" size="small">
                  {{ p.label }}
                </el-tag>
                <span v-if="row.member_count > row.member_preview.length" class="rp-ellipsis">…</span>
              </template>
              <span class="rp-count">共{{ row.member_count }}人</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="88" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openDetail(row.id)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <!-- 教师分配 -->
    <template v-else-if="view === 'alloc'">
      <div class="rp-crumb">
        <el-button link type="primary" @click="backToList">角色权限</el-button>
        <span class="rp-crumb-div">/</span>
        <span>教师分配</span>
      </div>
      <h2 class="rp-page-title">教师校区管理</h2>
      <div class="rp-toolbar">
        <el-select v-model="allocCampus" placeholder="请选择校区" clearable style="width: 200px" size="small">
          <el-option v-for="c in allocCampuses" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-input
          v-model="allocKw"
          placeholder="请输入姓名关键字"
          clearable
          style="width: 200px"
          size="small"
          @keyup.enter="loadAllocation"
        />
        <el-button type="primary" size="small" @click="loadAllocation">查询</el-button>
        <div class="rp-toolbar-right">
          <el-button type="primary" size="small" @click="syncAlloc">同步教师通讯录</el-button>
          <el-button type="primary" size="small" @click="campusCfgVisible = true">校区配置</el-button>
        </div>
      </div>
      <el-table v-loading="allocLoading" :data="allocRows" border stripe size="small" class="rp-table">
        <el-table-column prop="display_name" label="教师姓名" min-width="160" />
        <el-table-column label="账号信息" min-width="200">
          <template #default="{ row }">
            <span>{{ accountVisible[row.id] ? row.account_plain : row.account_masked }}</span>
            <el-button link class="rp-eye" @click="accountVisible[row.id] = !accountVisible[row.id]">
              <el-icon><View /></el-icon>
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="campus_name" label="所在校区" min-width="200" />
        <el-table-column label="操作" width="88" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openAllocEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="rp-pagination">
        <span class="rp-total">共 {{ allocTotal }} 条</span>
        <el-pagination
          v-model:current-page="allocPage"
          v-model:page-size="allocPageSize"
          :total="allocTotal"
          :page-sizes="[10, 20, 50]"
          layout="sizes, prev, pager, next"
          background
          @current-change="loadAllocation"
          @size-change="
            () => {
              allocPage = 1
              loadAllocation()
            }
          "
        />
      </div>
    </template>

    <!-- 角色详情 -->
    <template v-else-if="view === 'detail' && detail">
      <div class="rp-crumb">
        <el-button link type="primary" @click="backToList">角色权限</el-button>
        <span class="rp-crumb-div">/</span>
        <span>角色详情</span>
      </div>
      <div class="rp-detail-hd">
        <h2 class="rp-page-title">{{ detailTitle }}</h2>
        <div v-if="detail.scope === 'campus'" class="rp-detail-actions">
          <el-button type="primary" size="small" @click="openEditRole">编辑角色</el-button>
          <el-button type="danger" size="small" plain @click="confirmDeleteRole">删除角色</el-button>
        </div>
      </div>
      <el-tabs v-model="detailTab" class="rp-tabs">
        <el-tab-pane label="角色详情" name="info">
          <el-descriptions :column="1" border size="small" class="rp-desc">
            <el-descriptions-item v-if="detail.scope === 'campus'" label="所属校区">
              {{ detail.campus_name }}
            </el-descriptions-item>
            <el-descriptions-item label="角色名称">{{ detail.name }}</el-descriptions-item>
            <el-descriptions-item label="角色描述">{{ detail.description }}</el-descriptions-item>
          </el-descriptions>
          <div class="rp-perm-block">
            <div class="rp-perm-label">可见功能</div>
            <div class="rp-perm-sub">电脑端功能</div>
            <div class="rp-tree-wrap">
              <el-tree
                :data="pcTreeForView"
                node-key="id"
                show-checkbox
                check-strictly
                default-expand-all
                :props="{ label: 'label', children: 'children' }"
                :default-checked-keys="detail.permission_pc_ids"
              />
            </div>
            <div class="rp-perm-sub">移动端功能</div>
            <div class="rp-mobile-tags">
              <el-tag v-for="mid in detail.permission_mobile_ids" :key="mid" type="primary" class="rp-mtag">
                {{ mobileLabel(mid) }}
              </el-tag>
              <span v-if="!detail.permission_mobile_ids.length" class="rp-muted">未配置</span>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="成员管理" name="members">
          <div class="rp-mem-toolbar">
            <el-input
              v-model="memberKw"
              placeholder="请输入教师姓名关键字"
              clearable
              style="width: 220px"
              size="small"
              @keyup.enter="loadMembers"
            />
            <el-button type="primary" size="small" @click="loadMembers">查询</el-button>
            <el-button type="primary" size="small" @click="openMemberDialog">添加成员</el-button>
          </div>
          <el-table :data="memberRows" border stripe size="small">
            <el-table-column prop="name" label="姓名" min-width="140" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="removeMember(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>

    <!-- 新增 / 编辑角色 -->
    <el-dialog
      v-model="roleFormVisible"
      :title="roleFormMode === 'create' ? '新增角色' : '编辑角色'"
      width="720px"
      destroy-on-close
      @opened="onRoleFormOpened"
    >
      <el-form ref="roleFormRef" :model="roleForm" :rules="roleFormRules" label-width="100px">
        <el-form-item label="角色名称" prop="name" required>
          <el-input v-model="roleForm.name" placeholder="请输入角色名称" />
        </el-form-item>
        <el-form-item label="角色描述" prop="description" required>
          <el-input v-model="roleForm.description" type="textarea" :rows="2" placeholder="请输入角色描述" />
        </el-form-item>
        <el-form-item v-if="roleFormMode === 'create'" label="所属校区" prop="campus_id">
          <el-select v-model="roleForm.campus_id" style="width: 100%">
            <el-option v-for="c in allocCampuses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="电脑端功能">
          <div class="rp-tree-wrap rp-tree-edit">
            <el-tree
              ref="permTreeRef"
              :data="catalog?.pc_tree ?? []"
              node-key="id"
              show-checkbox
              check-strictly
              default-expand-all
              :props="{ label: 'label', children: 'children' }"
            />
          </div>
        </el-form-item>
        <el-form-item label="移动端功能">
          <el-select v-model="roleForm.mobile_ids" multiple collapse-tags placeholder="请选择" style="width: 100%">
            <el-option v-for="m in catalog?.mobile ?? []" :key="m.id" :label="m.label" :value="m.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="roleFormSaving" @click="submitRoleForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 添加成员 -->
    <el-dialog v-model="memberDialogVisible" title="添加成员" width="640px" destroy-on-close @opened="onMemberDialogOpened">
      <el-transfer
        v-model="transferTarget"
        filterable
        :filter-method="filterTransfer"
        filter-placeholder="请输入教师姓名关键字"
        :titles="['可选教师列表', '已选教师列表']"
        :data="transferData"
        :props="{ key: 'key', label: 'label' }"
      />
      <template #footer>
        <el-button @click="memberDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="memberSaveLoading" @click="saveMembersTransfer">保存</el-button>
      </template>
    </el-dialog>

    <!-- 教师编辑校区 -->
    <el-dialog v-model="allocEditVisible" title="教师编辑" width="480px" destroy-on-close>
      <template v-if="allocEditRow">
        <el-form label-width="100px">
          <el-form-item label="当前教师">
            <span>{{ allocEditRow.display_name }}</span>
          </el-form-item>
          <el-form-item label="选择校区">
            <el-select v-model="allocEditCampus" filterable clearable style="width: 100%">
              <el-option v-for="c in allocCampuses" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="allocEditVisible = false">取消</el-button>
        <el-button type="primary" :loading="allocEditSaving" @click="saveAllocEdit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 校区配置 -->
    <el-drawer v-model="campusCfgVisible" title="校区配置" direction="rtl" size="480px" destroy-on-close>
      <el-tabs>
        <el-tab-pane label="部门校区映射" name="map">
          <p class="rp-muted">演示：生产环境配置钉钉部门与校区映射关系。</p>
        </el-tab-pane>
        <el-tab-pane label="教师校区上传" name="up">
          <ol class="rp-ol">
            <li>导出模版，填写后上传更新系统。</li>
            <li>仅支持为已有教师分配校区，不新建账号。</li>
            <li>已分配校区的教师，新分配将追加，不覆盖演示逻辑。</li>
          </ol>
          <div class="rp-step">
            <p>1. 导出</p>
            <el-button size="small" @click="exportAllocData">导出教师数据</el-button>
            <el-button size="small" class="rp-ml8" @click="exportAllocTpl">导出上传模版</el-button>
          </div>
          <div class="rp-step">
            <p>2. 修改后上传（.xls / .xlsx）</p>
            <el-button type="primary" size="small" @click="mockUploadAlloc">点击上传</el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { View } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import type { ElTree } from 'element-plus'
import {
  deleteRole,
  deleteRoleMember,
  fetchAllocationCampuses,
  fetchAllocationTeachers,
  fetchAssignableTeacherPool,
  fetchPermissionsCatalog,
  fetchRoleDetail,
  fetchRoleMembers,
  fetchRolesOverview,
  patchAllocationTeacher,
  patchRole,
  postAllocationExportData,
  postAllocationExportTemplate,
  postAllocationSync,
  postRole,
  postRoleMembers,
  type PermNode,
  type RoleDetail,
  type RoleOverview,
} from '@/api/roleManagement'

const view = ref<'list' | 'detail' | 'alloc'>('list')
const overview = ref<RoleOverview | null>(null)
const currentRoleId = ref<string | null>(null)
const detail = ref<RoleDetail | null>(null)
const detailTab = ref('info')
const catalog = ref<Awaited<ReturnType<typeof fetchPermissionsCatalog>> | null>(null)

const detailTitle = computed(() => {
  if (!detail.value) return ''
  if (detail.value.scope === 'campus' && detail.value.campus_name) {
    return `${detail.value.campus_name} ${detail.value.name}`
  }
  return detail.value.name
})

const pcTreeForView = computed(() => treeAllDisabled(catalog.value?.pc_tree ?? []))

function treeAllDisabled(nodes: PermNode[]): PermNode[] {
  return nodes.map((n) => ({
    ...n,
    disabled: true,
    children: n.children ? treeAllDisabled(n.children) : undefined,
  }))
}

function mobileLabel(id: string) {
  return catalog.value?.mobile.find((m) => m.id === id)?.label ?? id
}

async function loadOverview() {
  overview.value = await fetchRolesOverview()
}

function backToList() {
  view.value = 'list'
  currentRoleId.value = null
  detail.value = null
}

function goAllocation() {
  view.value = 'alloc'
  loadAllocCampuses()
  loadAllocation()
}

async function openDetail(roleId: string) {
  currentRoleId.value = roleId
  view.value = 'detail'
  detailTab.value = 'info'
  if (!catalog.value) catalog.value = await fetchPermissionsCatalog()
  detail.value = await fetchRoleDetail(roleId)
  memberKw.value = ''
  await loadMembers()
}

const memberKw = ref('')
const memberRows = ref<{ id: string; name: string }[]>([])

async function loadMembers() {
  if (!currentRoleId.value) return
  memberRows.value = await fetchRoleMembers(currentRoleId.value, memberKw.value.trim())
}

const memberDialogVisible = ref(false)
const transferData = ref<{ key: string; label: string }[]>([])
const transferTarget = ref<string[]>([])
const memberInitial = ref<Set<string>>(new Set())
const memberSaveLoading = ref(false)

function filterTransfer(query: string, item: { label?: string }) {
  return (item.label ?? '').includes(query)
}

async function openMemberDialog() {
  if (!currentRoleId.value) return
  memberDialogVisible.value = true
}

async function onMemberDialogOpened() {
  if (!currentRoleId.value) return
  const [members, pool] = await Promise.all([
    fetchRoleMembers(currentRoleId.value, ''),
    fetchAssignableTeacherPool(currentRoleId.value, ''),
  ])
  const map = new Map<string, string>()
  for (const m of members) map.set(m.id, m.name)
  for (const p of pool) map.set(p.key, p.label)
  transferData.value = [...map.entries()].map(([key, label]) => ({ key, label }))
  transferTarget.value = members.map((m) => m.id)
  memberInitial.value = new Set(transferTarget.value)
}

async function saveMembersTransfer() {
  if (!currentRoleId.value) return
  const now = new Set(transferTarget.value)
  const initial = memberInitial.value
  const toRemove = [...initial].filter((id) => !now.has(id))
  const toAdd = [...now].filter((id) => !initial.has(id))
  memberSaveLoading.value = true
  try {
    for (const id of toRemove) {
      await deleteRoleMember(currentRoleId.value, id)
    }
    if (toAdd.length) await postRoleMembers(currentRoleId.value, toAdd)
    ElMessage.success('已保存成员')
    memberDialogVisible.value = false
    await loadMembers()
    await loadOverview()
    if (detail.value) detail.value = await fetchRoleDetail(currentRoleId.value)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    memberSaveLoading.value = false
  }
}

async function removeMember(row: { id: string; name: string }) {
  if (!currentRoleId.value) return
  try {
    await ElMessageBox.confirm(`将「${row.name}」从本角色移除？`, '删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteRoleMember(currentRoleId.value, row.id)
    ElMessage.success('已删除')
    await loadMembers()
    await loadOverview()
    if (detail.value) detail.value = await fetchRoleDetail(currentRoleId.value)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  }
}

const roleFormVisible = ref(false)
const roleFormMode = ref<'create' | 'edit'>('create')
const roleFormSaving = ref(false)
const roleFormRef = ref<FormInstance>()
const permTreeRef = ref<InstanceType<typeof ElTree>>()
const roleForm = ref({
  name: '',
  description: '',
  campus_id: '',
  mobile_ids: [] as string[],
})
const roleFormRules: FormRules = {
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  description: [{ required: true, message: '请输入角色描述', trigger: 'blur' }],
}

function openCreateRole(campusId: string) {
  roleFormMode.value = 'create'
  roleForm.value = {
    name: '',
    description: '',
    campus_id: campusId,
    mobile_ids: [],
  }
  roleFormVisible.value = true
}

function openEditRole() {
  if (!detail.value || detail.value.scope !== 'campus') return
  roleFormMode.value = 'edit'
  roleForm.value = {
    name: detail.value.name,
    description: detail.value.description,
    campus_id: detail.value.campus_id || '',
    mobile_ids: [...detail.value.permission_mobile_ids],
  }
  roleFormVisible.value = true
}

async function onRoleFormOpened() {
  if (!catalog.value) catalog.value = await fetchPermissionsCatalog()
  await nextTick()
  const keys =
    roleFormMode.value === 'edit' && detail.value ? [...detail.value.permission_pc_ids] : []
  permTreeRef.value?.setCheckedKeys(keys, false)
}

async function submitRoleForm() {
  if (!roleFormRef.value) return
  try {
    await roleFormRef.value.validate()
  } catch {
    return
  }
  const pcKeys = permTreeRef.value?.getCheckedKeys(false) as string[]
  roleFormSaving.value = true
  try {
    if (roleFormMode.value === 'create') {
      await postRole({
        name: roleForm.value.name,
        description: roleForm.value.description,
        campus_id: roleForm.value.campus_id,
        permission_pc_ids: pcKeys,
        permission_mobile_ids: roleForm.value.mobile_ids,
      })
      ElMessage.success('已新增角色')
    } else if (currentRoleId.value) {
      await patchRole(currentRoleId.value, {
        name: roleForm.value.name,
        description: roleForm.value.description,
        permission_pc_ids: pcKeys,
        permission_mobile_ids: roleForm.value.mobile_ids,
      })
      ElMessage.success('已保存')
      detail.value = await fetchRoleDetail(currentRoleId.value)
    }
    roleFormVisible.value = false
    await loadOverview()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    roleFormSaving.value = false
  }
}

async function confirmDeleteRole() {
  if (!currentRoleId.value || !detail.value) return
  if (detail.value.scope === 'school') return
  try {
    await ElMessageBox.confirm('确定删除该校区角色？', '删除角色', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteRole(currentRoleId.value!)
    ElMessage.success('已删除')
    backToList()
    await loadOverview()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

const allocCampuses = ref<{ id: string; name: string }[]>([])
const allocCampus = ref('')
const allocKw = ref('')
const allocLoading = ref(false)
const allocRows = ref<
  {
    id: string
    display_name: string
    account_masked: string
    account_plain: string
    campus_id: string
    campus_name: string
  }[]
>([])
const allocTotal = ref(0)
const allocPage = ref(1)
const allocPageSize = ref(10)
const accountVisible = ref<Record<string, boolean>>({})
const campusCfgVisible = ref(false)
const allocEditVisible = ref(false)
const allocEditRow = ref<(typeof allocRows.value)[0] | null>(null)
const allocEditCampus = ref('')
const allocEditSaving = ref(false)

async function loadAllocCampuses() {
  allocCampuses.value = await fetchAllocationCampuses()
}

async function loadAllocation() {
  allocLoading.value = true
  try {
    const data = await fetchAllocationTeachers({
      campus_id: allocCampus.value || undefined,
      keyword: allocKw.value.trim(),
      page: allocPage.value,
      page_size: allocPageSize.value,
    })
    allocRows.value = data.items
    allocTotal.value = data.total
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    allocLoading.value = false
  }
}

async function syncAlloc() {
  try {
    const r = await postAllocationSync()
    ElMessage.success(r.message)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

function openAllocEdit(row: (typeof allocRows.value)[0]) {
  allocEditRow.value = row
  allocEditCampus.value = row.campus_id
  allocEditVisible.value = true
}

async function saveAllocEdit() {
  if (!allocEditRow.value || !allocEditCampus.value) {
    ElMessage.warning('请选择校区')
    return
  }
  allocEditSaving.value = true
  try {
    await patchAllocationTeacher(allocEditRow.value.id, allocEditCampus.value)
    ElMessage.success('已保存')
    allocEditVisible.value = false
    await loadAllocation()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    allocEditSaving.value = false
  }
}

async function exportAllocTpl() {
  try {
    await postAllocationExportTemplate()
    ElMessage.success('演示：已触发导出模版')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

async function exportAllocData() {
  try {
    await postAllocationExportData()
    ElMessage.success('演示：已触发导出数据')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '失败')
  }
}

function mockUploadAlloc() {
  ElMessage.success('演示：已模拟上传')
}

onMounted(() => {
  loadOverview()
})
</script>

<style scoped>
.rp-root {
  padding: 16px 20px 24px;
  min-height: 520px;
}
.rp-hd {
  margin-bottom: 16px;
}
.rp-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.rp-card {
  margin-bottom: 16px;
  border-radius: 4px;
}
.rp-card :deep(.el-card__header) {
  padding: 12px 16px;
}
.rp-card-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.rp-card-title {
  font-weight: 600;
  color: #303133;
}
.rp-campus-name {
  margin-left: 10px;
  color: var(--el-color-primary);
  font-weight: 500;
}
.rp-table {
  width: 100%;
}
.rp-tag {
  margin: 0 4px 4px 0;
}
.rp-ellipsis {
  margin-right: 6px;
  color: #909399;
}
.rp-count {
  font-size: 12px;
  color: #909399;
}
.rp-crumb {
  font-size: 13px;
  color: #606266;
  margin-bottom: 8px;
}
.rp-crumb-div {
  margin: 0 6px;
  color: #dcdfe6;
}
.rp-page-title {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.rp-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.rp-toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.rp-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.rp-total {
  margin-right: auto;
  font-size: 13px;
  color: #606266;
}
.rp-eye {
  margin-left: 6px;
  vertical-align: middle;
}
.rp-detail-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.rp-detail-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.rp-tabs {
  margin-top: 8px;
}
.rp-desc {
  max-width: 720px;
  margin-bottom: 16px;
}
.rp-perm-block {
  margin-top: 8px;
}
.rp-perm-label {
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
}
.rp-perm-sub {
  font-size: 13px;
  color: #606266;
  margin: 12px 0 8px;
}
.rp-tree-wrap {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 10px 12px;
  max-height: 320px;
  overflow: auto;
  background: #fafafa;
}
.rp-tree-edit {
  max-height: 240px;
  background: #fff;
}
.rp-mobile-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rp-mtag {
  margin: 0;
}
.rp-muted {
  color: #909399;
  font-size: 13px;
}
.rp-mem-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.rp-ol {
  padding-left: 18px;
  color: #606266;
  font-size: 13px;
  line-height: 1.7;
}
.rp-step {
  margin: 14px 0;
  font-size: 13px;
}
.rp-ml8 {
  margin-left: 8px;
}
</style>
