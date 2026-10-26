<template>
  <div class="access-page" v-loading="loading">
    <header class="page-header"><h2>{{ access.can('access.manage') ? '用户角色管理' : '分机绑定管理' }}</h2><el-button :icon="Refresh" :disabled="busy" @click="load">刷新</el-button></header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="load-error"><el-button link type="primary" @click="load">重新加载</el-button></el-alert>
    <template v-if="data">
      <el-tabs :model-value="tab" @tab-change="switchTab" class="management-tabs">
        <el-tab-pane v-for="item in tabs" :key="item.key" :name="item.key" :label="item.label" />
      </el-tabs>
      <div v-if="tab === 'users'" class="operators">
        <div class="toolbar">
          <el-input v-model="query" :prefix-icon="Search" placeholder="输入工号或姓名" clearable aria-label="搜索操作员" />
          <el-select v-model="enabledFilter" aria-label="激活状态"><el-option label="全部状态" :value="-1" /><el-option label="启用" :value="1" /><el-option label="停用" :value="0" /></el-select>
          <el-button type="primary" :icon="Plus" :disabled="busy" @click="editOperator()">添加操作员</el-button>
        </div>
        <el-table :data="filteredUsers" border stripe max-height="550" row-key="id" empty-text="暂无操作员，请点击添加操作员">
          <el-table-column prop="work_no" label="操作员工号" min-width="110" />
          <el-table-column prop="name" label="操作员名称" min-width="110" />
          <el-table-column prop="extension" label="分机号" width="110" />
          <el-table-column prop="called_tel" label="外呼主叫号码" min-width="130" />
          <el-table-column prop="login_email" label="登录邮箱" min-width="170" show-overflow-tooltip />
          <el-table-column label="状态" width="75"><template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag></template></el-table-column>
          <el-table-column label="全媒体账号" width="110"><template #default="{ row }"><el-tag v-if="row.sync_pending === 1" type="warning" size="small">待同步</el-tag><span v-else>{{ row.sync_pending === 0 ? '已同步' : '未核验' }}</span></template></el-table-column>
          <el-table-column label="操作" :width="canManageLoginCodes ? 290 : 210" fixed="right"><template #default="{ row }">
            <el-button link type="primary" :disabled="busy" @click="editOperator(row)">修改</el-button>
            <el-button link type="primary" :disabled="busy" @click="openUserPermissions(row)">权限</el-button>
            <el-button link type="primary" :disabled="busy" @click="sync(row)">重新同步</el-button>
            <el-button v-if="canManageLoginCodes" link type="primary" :disabled="busy || !row.enabled" @click="openLoginCodes(row)">登录授权码</el-button>
          </template></el-table-column>
        </el-table>
        <p class="hint">共 {{ filteredUsers.length }} 名操作员。新建后，请继续分配部门、角色、坐席组和同名技能组。</p>
      </div>
      <div v-else-if="tab === 'extensions'">
        <div class="toolbar"><el-input v-model="query" :prefix-icon="Search" placeholder="输入分机号查询" clearable aria-label="搜索分机号" /><el-button v-if="access.can('access.manage')" type="primary" :icon="Plus" :disabled="busy" @click="editExtension()">添加分机号</el-button></div>
        <el-table :data="filteredExtensions" stripe border max-height="540" empty-text="暂无分机号">
          <el-table-column prop="num" label="分机号" min-width="130" />
          <el-table-column label="绑定坐席" min-width="160"><template #default="{ row }">{{ data.users.filter(u => u.extension === row.num).map(u => u.work_no + ' · ' + u.name).join('，') || '未分配' }}</template></el-table-column>
          <el-table-column label="设备类型" width="110"><template #default="{ row }">{{ row.device === 0 ? '通道组' : '通道号' }}</template></el-table-column>
          <el-table-column prop="channel_group" label="通道组" min-width="120" />
          <el-table-column label="通道号" width="90"><template #default="{ row }">{{ row.device === 1 ? row.channel : '—' }}</template></el-table-column>
          <el-table-column prop="description" label="备注" min-width="170" />
          <el-table-column v-if="access.can('access.manage')" label="操作" width="180"><template #default="{ row }"><el-button link type="primary" :disabled="busy" @click="editExtension(row)">修改分机号</el-button><el-button link type="danger" :disabled="busy" @click="removeExtension(row)">删除</el-button></template></el-table-column>
        </el-table>
        <p class="hint">一般不建议删除分机号。已被操作员或电话坐席引用的分机不能删除。</p>
        <ExtensionAssignmentPanel :users="data.users" @changed="load" />
      </div>
      <div v-else class="assignment-layout">
        <aside class="entity-list">
          <h3>{{ currentLabel }}信息维护</h3>
          <el-input v-model="query" :prefix-icon="Search" :placeholder="`输入${currentLabel}名称查询`" clearable :aria-label="`搜索${currentLabel}`" />
          <div class="entity-actions"><el-button size="small" :icon="Plus" :disabled="busy" @click="editEntity()">添加</el-button><el-button size="small" :disabled="busy || !selected" @click="editEntity(selected)">修改</el-button><el-button size="small" type="danger" plain :disabled="busy || !selected || !!selected.system" @click="removeEntity">删除</el-button></div>
          <el-tree v-if="tab === 'departments'" :key="query" :data="departmentTree" :props="{ label: 'name', children: 'children' }" node-key="id" :current-node-key="selectedId ?? undefined" default-expand-all highlight-current :expand-on-click-node="false" @node-click="choose" />
          <div v-else class="entity-buttons"><button v-for="entity in filteredEntities" :key="entity.id" :class="['entity-button', { selected: selectedId === entity.id }]" :disabled="busy" @click="choose(entity)"><span>{{ entity.name }}</span><el-tag v-if="entity.system" size="small" type="info">系统</el-tag></button></div>
          <el-empty v-if="!entities.length" :description="`暂无${currentLabel}`" :image-size="60" />
        </aside>
        <section class="assignment-main" v-loading="assignmentLoading">
          <template v-if="selected">
            <h3>{{ selected.name }}<span>{{ currentLabel }}资源分配</span></h3>
            <el-alert v-if="assignmentError" type="error" :title="assignmentError" :closable="false" show-icon />
            <el-tabs v-model="assignmentTab">
              <el-tab-pane v-if="canGrant" :label="`${currentLabel}权限分配`" name="permissions" />
              <el-tab-pane :label="tab === 'departments' ? '用户部门分配' : tab === 'roles' ? '用户角色分配' : '坐席员分组管理'" name="members" />
            </el-tabs>
            <template v-if="!assignmentError">
              <PermissionGrid v-if="assignmentTab === 'permissions' && canGrant" :catalog="data.permissions" :ids="permissionIds" :scope-values="permissionScopes" :busy="busy || assignmentLoading" @change="grant" />
              <template v-else><p v-if="tab === 'skills'" class="hint">请先将操作员加入同名坐席组，再分配本技能。</p><MemberTransfer :key="`${tab}-${selectedId}`" :users="data.users" :ids="memberIds" :busy="busy || assignmentLoading" @change="changeMembers" /></template>
            </template>
          </template>
          <el-empty v-else :description="`请选择或添加${currentLabel}`" />
        </section>
      </div>
      <footer class="page-footer">话务权限与组配置在坐席重新签入后生效；全媒体权限在下次请求时生效。</footer>
    </template>

    <OperatorEditor v-if="operatorOpen && data" :operator="editingOperator" :data="data" @close="operatorOpen = false" @saved="operatorOpen = false; load()" />
    <LoginCodeDialog v-model="loginCodeOpen" :operator="loginCodeOperator" />
    <el-dialog v-model="entityOpen" :title="`${editingEntity ? '修改' : '添加'}${currentLabel}`" width="480px" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy" class="access-dialog">
      <el-form label-width="100px" @submit.prevent="saveEntity">
        <el-form-item :label="`${currentLabel}名称`" required><el-input v-model="entityForm.name" :maxlength="tab === 'departments' ? 20 : 50" @keyup.enter="saveEntity" /></el-form-item>
        <el-form-item v-if="tab === 'departments'" label="上级部门"><el-select v-model="entityForm.parent_id" filterable><el-option label="无上级部门" :value="-1" /><el-option v-for="e in data?.departments.filter(d => d.id !== editingEntity?.id)" :key="e.id" :value="e.id" :label="e.name" /></el-select></el-form-item>
        <template v-if="tab === 'skills'"><el-form-item label="媒体类型"><el-select v-model="entityForm.media_type_id"><el-option v-for="e in data?.media_types" :key="e.id" :value="e.id" :label="e.name" /></el-select></el-form-item><el-form-item label="业务类型"><el-select v-model="entityForm.business_type_id"><el-option label="未设置" :value="0" /><el-option v-for="e in data?.business_types" :key="e.id" :value="e.id" :label="e.name" /></el-select></el-form-item><el-form-item label="技能元素"><el-select v-model="entityForm.skill_element_id"><el-option label="未设置" :value="0" /><el-option v-for="e in data?.skill_elements" :key="e.id" :value="e.id" :label="e.name" /></el-select></el-form-item></template>
      </el-form>
      <template #footer><el-button :disabled="busy" @click="entityOpen = false">取消</el-button><el-button type="primary" :loading="busy" @click="saveEntity">保存</el-button></template>
    </el-dialog>
    <el-dialog v-model="extensionOpen" :title="originalExtension ? '修改分机号' : '添加分机号'" width="480px" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy" class="access-dialog">
      <el-form label-width="95px" @submit.prevent="saveExtension">
        <el-form-item label="分机号" required><el-input v-model="extensionForm.num" maxlength="50" /></el-form-item>
        <el-form-item label="设备类型"><el-select v-model="extensionForm.device"><el-option label="通道组" :value="0" /><el-option label="通道号" :value="1" /></el-select></el-form-item>
        <el-form-item v-if="extensionForm.device === 0" label="通道组" required><el-select v-model="extensionForm.channel_group" filterable><el-option v-for="e in data?.channel_groups" :key="e.id" :value="e.name" :label="e.name" /></el-select></el-form-item>
        <el-form-item v-else label="通道号"><el-input-number v-model="extensionForm.channel" :min="0" :precision="0" /></el-form-item>
        <el-form-item label="坐席模式"><el-select v-model="extensionForm.agent_mode"><el-option label="话机模式" :value="0" /><el-option label="耳机模式" :value="1" /></el-select></el-form-item>
        <el-form-item label="备注"><el-input v-model="extensionForm.description" type="textarea" :rows="3" maxlength="100" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="busy" @click="extensionOpen = false">取消</el-button><el-button type="primary" :loading="busy" @click="saveExtension">保存</el-button></template>
    </el-dialog>
    <el-dialog v-model="userPermissionsOpen" :title="`${permissionsUser?.name ?? ''} · 拥有的权限`" width="860px" class="access-dialog">
      <el-tabs v-model="userPermissionTab"><el-tab-pane label="直接权限" name="direct" /><el-tab-pane label="全部有效权限" name="effective" /><el-tab-pane label="角色授予" name="role" /><el-tab-pane label="部门授予" name="department" /></el-tabs>
      <el-alert v-if="userPermissionError" :title="userPermissionError" type="error" :closable="false" />
      <PermissionGrid v-else-if="data" :catalog="data.permissions" :ids="visibleUserPermissionIds" :scope-values="userPermissionTab === 'direct' ? userScopes : undefined" :sources="userPermissionTab === 'direct' ? undefined : userPermissionSources" :readonly="userPermissionTab !== 'direct'" :busy="busy || userPermissionLoading" @change="grantUser" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { accessApi, accessError, type DataScope, type Bootstrap, type Entity, type EntityKind, type Operator, type Extension, type EffectivePermission } from '@/api/access'
import { useAccessStore } from '@/stores/access'
import PermissionGrid from '@/components/access/PermissionGrid.vue'
import MemberTransfer from '@/components/access/MemberTransfer.vue'
import OperatorEditor from '@/components/access/OperatorEditor.vue'
import LoginCodeDialog from '@/components/access/LoginCodeDialog.vue'
import ExtensionAssignmentPanel from '@/components/access/ExtensionAssignmentPanel.vue'
import { loginCodeCapabilities } from '@/services/auth/login-code'
type Tab = 'users' | EntityKind | 'extensions'
const allTabs: { key: Tab; label: string }[] = [{ key: 'users', label: '操作员信息管理' }, { key: 'departments', label: '部门管理' }, { key: 'roles', label: '角色管理' }, { key: 'groups', label: '坐席组管理' }, { key: 'skills', label: '技能组管理' }, { key: 'extensions', label: '坐席分机号管理' }]
const tab = ref<Tab>('users'), data = ref<Bootstrap>(), loading = ref(false), busy = ref(false), error = ref(''), query = ref(''), enabledFilter = ref(-1)
const access = useAccessStore()
const tabs = computed(() => access.can('access.manage') ? allTabs : allTabs.filter(t => t.key === 'extensions'))
const permissionScopes = ref<Record<number, DataScope>>({}), userScopes = ref<Record<number, DataScope>>({})
const selectedId = ref<number | null>(null), assignmentTab = ref('permissions'), permissionIds = ref<number[]>([]), memberIds = ref<number[]>([]), assignmentLoading = ref(false), assignmentError = ref('')
let assignmentRequest = 0
const kind = computed(() => tab.value as EntityKind)
const currentLabel = computed(() => ({ departments: '部门', roles: '角色', groups: '坐席组', skills: '技能组', users: '操作员', extensions: '分机号' }[tab.value]))
const canGrant = computed(() => tab.value === 'departments' || tab.value === 'roles')
const entities = computed<Entity[]>(() => ['departments', 'roles', 'groups', 'skills'].includes(tab.value) ? data.value?.[kind.value] ?? [] : [])
const selected = computed(() => entities.value.find(e => e.id === selectedId.value))
const filteredEntities = computed(() => entities.value.filter(e => e.name.toLowerCase().includes(query.value.trim().toLowerCase())))
const filteredUsers = computed(() => data.value?.users.filter(u => `${u.work_no} ${u.name}`.toLowerCase().includes(query.value.trim().toLowerCase()) && (enabledFilter.value === -1 || u.enabled === enabledFilter.value)) ?? [])
const filteredExtensions = computed(() => data.value?.extensions.filter(e => e.num.includes(query.value.trim())) ?? [])
interface DepartmentNode extends Entity { children: DepartmentNode[] }
const departmentTree = computed(() => {
  if (query.value.trim()) return filteredEntities.value.map(e => ({ ...e, children: [] }))
  const nodes = new Map(entities.value.map(e => [e.id, { ...e, children: [] } as DepartmentNode]))
  const roots: DepartmentNode[] = []
  for (const node of nodes.values()) { const parent = nodes.get(node.parent_id ?? -1); if (parent && parent !== node) parent.children.push(node); else roots.push(node) }
  return roots
})
async function load() {
  if (loading.value) return
  loading.value = true; error.value = ''
  try { await access.refresh(); if (!access.can('access.manage')) tab.value = 'extensions'; data.value = access.can('access.manage') ? await accessApi.bootstrap() : await accessApi.extensionBootstrap(); if (!selected.value) selectedId.value = entities.value[0]?.id ?? null; await loadAssignments() }
  catch (e) { error.value = accessError(e); data.value = undefined }
  finally { loading.value = false }
}
function switchTab(value: string | number) {
  if (busy.value) return
  tab.value = value as Tab; query.value = ''; selectedId.value = entities.value[0]?.id ?? null
  assignmentTab.value = canGrant.value ? 'permissions' : 'members'; void loadAssignments()
}
function choose(entity: Entity) { if (busy.value) return; selectedId.value = entity.id; void loadAssignments() }
async function loadAssignments() {
  const request = ++assignmentRequest, id = selectedId.value, target = kind.value
  permissionIds.value = []; memberIds.value = []; assignmentError.value = ''
  if (!selected.value || !id) { assignmentLoading.value = false; return }
  assignmentLoading.value = true
  try { const result = await accessApi.assignments(target, id); if (request === assignmentRequest) { permissionIds.value = result.permission_ids; permissionScopes.value = result.scopes; memberIds.value = result.member_ids } }
  catch (e) { if (request === assignmentRequest) assignmentError.value = accessError(e) }
  finally { if (request === assignmentRequest) assignmentLoading.value = false }
}
async function mutate(fn: () => Promise<unknown>, success = '保存成功') {
  if (busy.value) return false
  busy.value = true
  try { await fn(); ElMessage.success(success); return true } catch (e) { ElMessage.error(accessError(e)); return false } finally { busy.value = false }
}
async function grant(id: number, granted: boolean, scope?: DataScope) {
  const target = kind.value, owner = selectedId.value
  if (!owner || assignmentLoading.value) return
  if (await mutate(() => accessApi.permission(target, owner, id, granted, scope ?? permissionScopes.value[id]))) { await loadAssignments(); await access.refresh() }
}
async function changeMembers(action: 'add' | 'remove', ids: number[]) {
  if (!selectedId.value || assignmentLoading.value) return
  const target = kind.value, owner = selectedId.value
  if (await mutate(() => accessApi.members(target, owner, action, ids), '人员分配已保存')) await loadAssignments()
}
const operatorOpen = ref(false), editingOperator = ref<Operator>()
const loginCodesEnabled = ref(false), loginCodeOpen = ref(false), loginCodeOperator = ref<Operator>()
const canManageLoginCodes = computed(() => loginCodesEnabled.value && !access.systemSuperuser)
void loginCodeCapabilities().then(ready => { loginCodesEnabled.value = ready }).catch(() => undefined)
function openLoginCodes(operator: Operator) { loginCodeOperator.value = operator; loginCodeOpen.value = true }
function editOperator(operator?: Operator) { editingOperator.value = operator; operatorOpen.value = true }
async function sync(operator: Operator) {
  if (busy.value) return
  busy.value = true
  try {
    const result = await accessApi.syncUser(operator.id)
    operator.sync_pending = result.sync_pending ? 1 : 0
    if (result.sync_pending) ElMessage.warning('全媒体账号仍待同步，请检查服务后重试')
    else ElMessage.success('全媒体账号同步成功')
  } catch (e) { ElMessage.error(accessError(e)) } finally { busy.value = false }
}
const entityOpen = ref(false), editingEntity = ref<Entity>()
const entityForm = reactive({ name: '', parent_id: -1, media_type_id: 1, business_type_id: 0, skill_element_id: 0 })
function editEntity(entity?: Entity) { editingEntity.value = entity; Object.assign(entityForm, { name: entity?.name ?? '', parent_id: entity?.parent_id ?? -1, media_type_id: entity?.media_type_id ?? 1, business_type_id: entity?.business_type_id ?? 0, skill_element_id: entity?.skill_element_id ?? 0 }); entityOpen.value = true }
async function saveEntity() {
  if (!entityForm.name.trim()) { ElMessage.warning('请输入名称'); return }
  if (await mutate(async () => { const result = await accessApi.saveEntity(kind.value, editingEntity.value?.id, entityForm); selectedId.value = result.id })) { entityOpen.value = false; await load() }
}
async function removeEntity() {
  if (!selected.value) return
  const entity = selected.value, target = kind.value
  try { await ElMessageBox.confirm(`确认删除“${entity.name}”？请先移除人员及相关引用。`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  if (await mutate(() => accessApi.deleteEntity(target, entity.id), '已删除')) await load()
}
const extensionOpen = ref(false), originalExtension = ref<string>()
const extensionForm = reactive<Extension>({ num: '', device: 0, channel_group: '', channel: 0, description: '', agent_mode: 0 })
function editExtension(extension?: Extension) { originalExtension.value = extension?.num; Object.assign(extensionForm, { num: extension?.num ?? '', device: extension?.device ?? 0, channel_group: extension?.channel_group ?? '', channel: extension?.channel ?? 0, description: extension?.description ?? '', agent_mode: extension?.agent_mode ?? 0 }); extensionOpen.value = true }
async function saveExtension() {
  if (!extensionForm.num.trim()) { ElMessage.warning('请输入分机号'); return }
  if (await mutate(() => accessApi.saveExtension(originalExtension.value, extensionForm))) { extensionOpen.value = false; await load() }
}
async function removeExtension(extension: Extension) {
  try { await ElMessageBox.confirm(`一般不建议删除分机号。确认删除 ${extension.num}？已绑定的分机将禁止删除。`, '删除分机号', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }) } catch { return }
  if (await mutate(() => accessApi.deleteExtension(extension.num), '分机号已删除')) await load()
}
const userPermissionsOpen = ref(false), permissionsUser = ref<Operator>(), userPermissionTab = ref('direct'), userOwnIds = ref<number[]>([]), userEffective = ref<EffectivePermission[]>([]), userPermissionLoading = ref(false), userPermissionError = ref('')
let userPermissionRequest = 0
async function openUserPermissions(user: Operator) {
  permissionsUser.value = user; userPermissionTab.value = 'direct'; userPermissionsOpen.value = true; await loadUserPermissions()
}
async function loadUserPermissions() {
  const request = ++userPermissionRequest, id = permissionsUser.value?.id
  if (!id) return
  userPermissionLoading.value = true; userPermissionError.value = ''; userOwnIds.value = []; userEffective.value = []
  try { const result = await accessApi.userPermissions(id); if (request === userPermissionRequest) { userOwnIds.value = result.own_ids; userScopes.value = result.scopes; userEffective.value = result.effective } }
  catch (e) { if (request === userPermissionRequest) userPermissionError.value = accessError(e) }
  finally { if (request === userPermissionRequest) userPermissionLoading.value = false }
}
const shownEffective = computed(() => userEffective.value.filter(p => userPermissionTab.value === 'effective' || p.source === userPermissionTab.value))
const visibleUserPermissionIds = computed(() => userPermissionTab.value === 'direct' ? userOwnIds.value : [...new Set(shownEffective.value.map(p => p.id))])
const userPermissionSources = computed(() => {
  const sources: Record<number, string> = {}
  for (const p of shownEffective.value) { const name = p.source === 'direct' ? '直接授予' : `${p.source === 'role' ? '角色' : '部门'}：${(p.source === 'role' ? data.value?.roles : data.value?.departments)?.find(e => e.id === p.owner_id)?.name ?? p.owner_id}`; sources[p.id] = sources[p.id] ? `${sources[p.id]}；${name}` : name }
  return sources
})
async function grantUser(id: number, granted: boolean, scope?: DataScope) {
  const userId = permissionsUser.value?.id
  if (!userId || userPermissionLoading.value) return
  if (await mutate(() => accessApi.permission('users', userId, id, granted, scope ?? userScopes.value[id]))) { await loadUserPermissions(); await access.refresh() }
}
onMounted(load)
</script>

<style scoped>
.access-page { padding: 24px; min-height: 620px; color: var(--el-text-color-primary); background: var(--el-bg-color); border-radius: 8px; font-size: 14px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; } h2 { font-size: 20px; margin: 0; font-weight: 600; }
.load-error { margin: 16px 0; } .toolbar { display: flex; gap: 12px; margin: 4px 0 18px; } .toolbar .el-input { max-width: 300px; } .toolbar .el-select { width: 140px; }
.assignment-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 540px; border: 1px solid var(--el-border-color-light); border-radius: 4px; }
.entity-list { padding: 16px; border-right: 1px solid var(--el-border-color-light); background: var(--el-fill-color-extra-light); min-width: 0; }
h3 { margin: 0 0 16px; font-size: 14px; font-weight: 600; } h3 > span { margin-left: 16px; font-size: 12px; font-weight: 400; color: var(--el-text-color-secondary); }
.entity-actions { display: flex; gap: 5px; margin: 12px 0; } .entity-actions .el-button + .el-button { margin-left: 0; }
.entity-buttons { display: grid; gap: 3px; max-height: 440px; overflow-y: auto; }
.entity-button { border: 0; background: transparent; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; text-align: left; font: inherit; color: inherit; cursor: pointer; border-radius: 4px; }
.entity-button:hover { background: var(--el-fill-color); } .entity-button.selected { background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 600; }
.assignment-main { padding: 20px; min-width: 0; } .hint, .page-footer { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.7; }
.page-footer { padding-top: 18px; } .el-select { width: 100%; }
@media(max-width: 1050px) { .assignment-layout { grid-template-columns: 210px minmax(0, 1fr); } .entity-list { padding: 12px; } .assignment-main { padding: 14px; } }
@media(max-width: 760px) { .access-page { padding: 14px; } .assignment-layout { grid-template-columns: 1fr; } .entity-list { border-right: none; border-bottom: 1px solid var(--el-border-color-light); } .entity-buttons { max-height: 170px; } .toolbar { flex-wrap: wrap; } }
</style>
<style>
.access-dialog { max-width: calc(100vw - 28px); }
</style>
