<template>
  <el-card shadow="never" class="announcement-manage" v-loading="loading">
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false"><el-button link @click="reload">重新加载</el-button></el-alert>
    <el-tabs v-model="tab">
      <el-tab-pane label="公告列表" name="list">
        <div class="toolbar"><span>公告发布与接收范围管理</span><div><el-button @click="loadList">刷新</el-button><el-button v-if="access.can('announcement.create')" type="primary" @click="newAnnouncement">新增公告</el-button></div></div>
        <el-table :data="items" border stripe empty-text="暂无公告">
          <el-table-column prop="title" label="公告标题" min-width="200" show-overflow-tooltip />
          <el-table-column label="类型" width="100"><template #default="{ row }">{{ types[row.type] }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="state(row) === '生效中' ? 'success' : 'info'">{{ state(row) }}</el-tag></template></el-table-column>
          <el-table-column label="发布范围" width="130"><template #default="{ row }">{{ row.audience_mode === 'all' ? '全体操作员' : `指定 ${row.recipient_ids.length} 人` }}</template></el-table-column>
          <el-table-column label="有效期" min-width="190"><template #default="{ row }">{{ formatTime(row.starts_at) }}<br />至 {{ row.ends_at ? formatTime(row.ends_at) : '长期有效' }}</template></el-table-column>
          <el-table-column label="操作" width="180" fixed="right"><template #default="{ row }">
            <el-button link type="primary" @click="preview = row">查看</el-button>
            <el-button v-if="row.status === 'draft' && access.can('announcement.update')" link type="primary" @click="edit(row)">编辑</el-button>
            <el-button v-if="access.can('announcement.delete')" link type="danger" @click="removeNotice(row)">{{ row.status === 'published' ? '撤下' : '删除' }}</el-button>
          </template></el-table-column>
        </el-table>
        <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" class="pagination" @current-change="loadList" />
      </el-tab-pane>
      <el-tab-pane v-if="access.can('announcement.create') || editId" :label="editId ? '编辑草稿' : '公告发布'" name="publish">
        <el-form label-position="top" class="publish-form" @submit.prevent>
          <div class="form-row"><el-form-item label="公告标题" required class="title-field"><el-input v-model="form.title" maxlength="200" show-word-limit placeholder="请输入公告标题" /></el-form-item><el-form-item label="公告类型"><el-select v-model="form.type" style="width:150px"><el-option v-for="(label, key) in types" :key="key" :label="label" :value="key" /></el-select></el-form-item></div>
          <el-form-item label="公告内容" required><el-input v-model="form.body" type="textarea" :rows="6" maxlength="20000" show-word-limit placeholder="请输入公告正文" /></el-form-item>
          <div class="form-row"><el-form-item label="生效时间" required><el-date-picker v-model="start" type="datetime" placeholder="选择生效时间" format="YYYY-MM-DD HH:mm" /></el-form-item><el-form-item label="结束时间"><el-date-picker v-model="end" type="datetime" placeholder="不填则长期有效" format="YYYY-MM-DD HH:mm" clearable /></el-form-item></div>
          <el-form-item label="发布范围" required>
            <el-radio-group v-model="form.audience_mode"><el-radio value="selected">指定接收人</el-radio><el-radio value="all">全体操作员</el-radio></el-radio-group>
            <p class="hint">从六类来源添加接收人；发布后的名单固定，人员后续调组不影响本条公告。</p>
            <AnnouncementRecipients v-if="form.audience_mode === 'selected'" v-model="form.recipient_ids" :catalog="catalog" />
            <el-alert v-else title="本公告将对当前服务范围内的全体操作员开放，后续新加入的操作员也可查看。" type="info" :closable="false" />
          </el-form-item>
          <div class="form-actions"><el-button @click="tab = 'list'">返回列表</el-button><el-button :loading="saving" :disabled="!!loadError" @click="submit('draft')">保存草稿</el-button><el-button type="primary" :loading="saving" :disabled="!!loadError" @click="submit('published')">{{ editId ? '发布此草稿' : '发布公告' }}</el-button></div>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="自定义分组" name="custom">
        <div class="toolbar"><span>保存常用接收人组合，下次发布时直接选用</span><el-button v-if="access.can('announcement.create')" type="primary" @click="openGroup()">新增分组</el-button></div>
        <el-table :data="catalog.categories.custom || []" border empty-text="暂无自定义分组">
          <el-table-column prop="name" label="分组名称" min-width="200" />
          <el-table-column label="成员数" width="120"><template #default="{ row }">{{ row.operator_ids.length }} 人</template></el-table-column>
          <el-table-column label="操作" width="180"><template #default="{ row }"><el-button v-if="access.can('announcement.update')" link type="primary" @click="openGroup(row)">编辑成员</el-button><el-button v-if="access.can('announcement.delete')" link type="danger" @click="removeGroup(row)">删除</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
    <el-dialog v-model="groupOpen" :title="groupId ? '编辑自定义分组' : '新增自定义分组'" width="90%" top="5vh" :close-on-click-modal="false">
      <el-form label-position="top"><el-form-item label="分组名称" required><el-input v-model="groupName" maxlength="100" placeholder="如：夜班值班人员" /></el-form-item><el-form-item label="分组成员" required><AnnouncementRecipients v-model="groupMembers" :catalog="catalog" /></el-form-item></el-form>
      <template #footer><el-button @click="groupOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="submitGroup">保存分组</el-button></template>
    </el-dialog>
    <el-dialog :model-value="!!preview" :title="preview?.title || '公告详情'" width="650px" @close="preview = null">
      <template v-if="preview"><p class="hint">{{ state(preview) }} · {{ preview.audience_mode === 'all' ? '全体操作员' : `${preview.recipient_ids.length} 名指定接收人` }}</p><p class="hint">{{ formatTime(preview.starts_at) }} 至 {{ preview.ends_at ? formatTime(preview.ends_at) : '长期有效' }}</p><div class="notice-body">{{ preview.body }}</div><template v-if="preview.audience_mode === 'selected'"><h4>接收人</h4><div class="recipient-tags"><el-tag v-for="id in preview.recipient_ids" :key="id" type="info">{{ operatorLabel(id) }}</el-tag></div></template></template>
    </el-dialog>
  </el-card>
</template>
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAccessStore } from '@/stores/access'
import AnnouncementRecipients from './AnnouncementRecipients.vue'
import { fetchRecipients, fetchManagedAnnouncements, saveAnnouncement, deleteAnnouncement, saveRecipientGroup, deleteRecipientGroup, type RecipientCatalog, type RecipientGroup, type AnnouncementInput, type ManagedAnnouncement } from '@/api/announcements'
const access = useAccessStore(), route = useRoute()
const types: Record<string, string> = { system: '系统公告', exam: '考试通知', training: '培训通知', emergency: '紧急公告' }
const tab = ref('list'), loading = ref(false), saving = ref(false), loadError = ref('')
const catalog = ref<RecipientCatalog>({ operators: [], categories: {} }), items = ref<ManagedAnnouncement[]>([]), total = ref(0), page = ref(1)
const blank = (): AnnouncementInput => ({ title: '', body: '', type: 'system', status: 'draft', audience_mode: 'selected', recipient_ids: [], starts_at: new Date().toISOString(), ends_at: null })
const form = ref(blank()), editId = ref<string>(), start = ref<Date | null>(new Date()), end = ref<Date | null>(null), preview = ref<ManagedAnnouncement | null>(null)
const groupOpen = ref(false), groupId = ref<number>(), groupName = ref(''), groupMembers = ref<number[]>([])
const errorMessage = (e: any) => e.response?.data?.errors?.join('；') || e.response?.data?.error || e.message || '操作失败，请重试'
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
function state(row: ManagedAnnouncement) { return row.status === 'draft' ? '草稿' : new Date(row.starts_at).getTime() > Date.now() ? '待生效' : row.ends_at && new Date(row.ends_at).getTime() <= Date.now() ? '已过期' : '生效中' }
function operatorLabel(id: number) { const o = catalog.value.operators.find(o => o.id === id); return o ? `${o.name} (${o.work_no})` : `不可用人员 #${id}` }
async function loadList() { try { const result = await fetchManagedAnnouncements(page.value); items.value = result.items; total.value = result.total } catch(e) { ElMessage.error(errorMessage(e)) } }
async function reload() { loading.value = true; loadError.value = ''; try { catalog.value = await fetchRecipients(); await loadList() } catch(e) { loadError.value = errorMessage(e) } finally { loading.value = false } }
function newAnnouncement() { form.value = blank(); editId.value = undefined; start.value = new Date(); end.value = null; tab.value = 'publish' }
function edit(row: ManagedAnnouncement) { form.value = { title: row.title, body: row.body, type: row.type, status: row.status, audience_mode: row.audience_mode, recipient_ids: [...row.recipient_ids], starts_at: row.starts_at, ends_at: row.ends_at }; editId.value = row.id; start.value = new Date(row.starts_at); end.value = row.ends_at ? new Date(row.ends_at) : null; tab.value = 'publish' }
async function submit(status: 'draft' | 'published') {
  if (saving.value) return
  if (!form.value.title.trim() || !form.value.body.trim()) return void ElMessage.warning('请填写公告标题和内容')
  if (!start.value || Number.isNaN(new Date(start.value).getTime())) return void ElMessage.warning('请选择生效时间')
  if (end.value && new Date(end.value) <= new Date(start.value)) return void ElMessage.warning('结束时间必须晚于开始时间')
  if (form.value.audience_mode === 'selected' && !form.value.recipient_ids.length) return void ElMessage.warning('请至少添加一名接收人')
  saving.value = true
  try { await saveAnnouncement({ ...form.value, status, recipient_ids: form.value.audience_mode === 'all' ? [] : form.value.recipient_ids, starts_at: new Date(start.value).toISOString(), ends_at: end.value ? new Date(end.value).toISOString() : null }, editId.value); ElMessage.success(status === 'draft' ? '草稿已保存' : '公告已发布'); newAnnouncement(); tab.value = 'list'; page.value = 1; await loadList() } catch(e) { ElMessage.error(errorMessage(e)) } finally { saving.value = false }
}
async function removeNotice(row: ManagedAnnouncement) {
  try { await ElMessageBox.confirm(row.status === 'published' ? `撤下「${row.title}」后，接收人将无法继续查看，是否撤下？` : `删除草稿「${row.title}」？`, '确认操作', { type: 'warning' }) } catch { return }
  try { await deleteAnnouncement(row.id); ElMessage.success('已删除'); if (items.value.length === 1 && page.value > 1) page.value--; await loadList() } catch(e) { ElMessage.error(errorMessage(e)) }
}
function openGroup(group?: RecipientGroup) { groupId.value = group?.id; groupName.value = group?.name || ''; groupMembers.value = [...(group?.operator_ids || [])]; groupOpen.value = true }
async function submitGroup() {
  if (saving.value) return
  if (!groupName.value.trim() || !groupMembers.value.length) return void ElMessage.warning('请填写分组名称并添加成员')
  saving.value = true
  try { await saveRecipientGroup({ name: groupName.value, operator_ids: groupMembers.value }, groupId.value); catalog.value = await fetchRecipients(); groupOpen.value = false; ElMessage.success('分组已保存') } catch(e) { ElMessage.error(errorMessage(e)) } finally { saving.value = false }
}
async function removeGroup(group: RecipientGroup) {
  try { await ElMessageBox.confirm(`删除「${group.name}」？已发布公告的接收人不会改变。`, '删除自定义分组', { type: 'warning' }) } catch { return }
  try { await deleteRecipientGroup(group.id); catalog.value = await fetchRecipients(); ElMessage.success('分组已删除') } catch(e) { ElMessage.error(errorMessage(e)) }
}
watch(() => route.query.tab, value => { if (value === 'publish' && access.can('announcement.create')) newAnnouncement() }, { immediate: true })
onMounted(reload)
</script>
<style scoped>
.announcement-manage{border-radius:8px}.toolbar,.form-row{display:flex;align-items:center;justify-content:space-between;gap:24px}.toolbar{margin:4px 0 20px;color:var(--el-text-color-secondary);font-size:14px}.pagination{justify-content:flex-end;margin-top:20px}.publish-form{padding:8px 4px}.form-row{justify-content:flex-start;align-items:flex-start}.title-field{flex:1}.hint{width:100%;font-size:13px;color:var(--el-text-color-secondary);line-height:1.8;margin:8px 0 16px}.form-actions{display:flex;justify-content:flex-end;padding-top:12px;border-top:1px solid var(--el-border-color-lighter)}.notice-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;min-height:100px}.recipient-tags{display:flex;flex-wrap:wrap;gap:8px;max-height:200px;overflow:auto}@media(max-width:700px){.form-row{flex-direction:column;gap:0}.title-field{width:100%}}
</style>
