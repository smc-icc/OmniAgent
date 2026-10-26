<template>
  <section class="knowledge-workspace" :class="{ compact }">
    <header v-if="!compact" class="kb-heading"><h2>知识库</h2><el-tag type="info">VDN {{ access.vdnId }}</el-tag></header>
    <el-tabs v-model="tab">
      <el-tab-pane label="资料检索" name="search" />
      <el-tab-pane v-if="!compact" label="文档管理" name="documents" />
    </el-tabs>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <div v-if="tab === 'search'" class="kb-search">
      <form class="kb-question" @submit.prevent="ask(false)">
        <el-input v-model="question" placeholder="输入问题" maxlength="1000" clearable />
        <el-button type="primary" native-type="submit" :icon="Search" :loading="asking" :disabled="!access.can('ai.execute') || !question.trim()">检索</el-button>
      </form>
      <div v-if="answer" class="kb-answer">
        <el-tag :type="answer.answered ? 'success' : 'info'">{{ answer.answered ? '原文摘录' : '无可靠依据' }}</el-tag>
        <p>{{ answer.answer }}</p>
        <ul><li v-for="source in answer.sources" :key="source.chunkId">[{{ source.number }}] {{ titleOf(source.documentId) }} <span class="kb-source-id">{{ source.documentId }}</span></li></ul>
        <el-button v-if="compact && conversationId && answer.answered" :icon="EditPen" :loading="asking" @click="ask(true)">生成客户回复草稿</el-button>
      </div>
      <el-empty v-else description="暂无检索结果" :image-size="64" />
    </div>
    <div v-else class="kb-management" v-loading="loading">
      <div class="kb-actions">
        <el-select v-model="baseId" placeholder="选择知识库" class="kb-base-picker">
          <el-option v-for="base in bases" :key="base.id" :label="base.name + (base.ready ? '' : base.error ? '（开通失败）' : '（开通中）')" :value="base.id" />
        </el-select>
        <el-button v-if="access.can('knowledge.create')" :icon="Plus" @click="newBaseOpen = true">新建</el-button>
        <el-button v-if="selectedBase?.canRetry" :icon="Refresh" :disabled="busy" @click="mutate('post', `/api/knowledge/bases/${baseId}/reindex`)">重试开通</el-button>
        <el-button :icon="Refresh" :loading="loading" title="刷新" aria-label="刷新" @click="load" />
        <el-button v-if="selectedBase?.canUpload" :icon="Upload" :disabled="!selectedBase.ready || busy" @click="fileInput?.click()">上传文档</el-button>
        <input ref="fileInput" class="kb-file" type="file" accept=".txt,.md,.pdf,.docx,.csv,.xlsx" @change="upload" />
        <el-select v-if="selectedBase?.canGrant" :model-value="selectedBase.readAccess" class="kb-audience" :disabled="busy" @change="changeAccess">
          <el-option label="本 VDN 授权用户可读" value="account" /><el-option label="仅创建者可读" value="owner" />
        </el-select>
      </div>
      <el-alert v-if="selectedBase?.error" :title="selectedBase.error" type="error" :closable="false" />
      <el-table :data="visibleDocs" empty-text="暂无文档" class="kb-table">
        <el-table-column prop="title" label="文档" min-width="180" show-overflow-tooltip />
        <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="row.error ? 'danger' : row.state === 'published' ? 'success' : 'info'">{{ stateLabel(row) }}</el-tag></template></el-table-column>
        <el-table-column label="用途" width="110"><template #default="{ row }">{{ row.audience === 'customer_approved' ? '客户回复' : '内部资料' }}</template></el-table-column>
        <el-table-column prop="chunks" label="片段" width="70" />
        <el-table-column label="错误" min-width="140"><template #default="{ row }">{{ row.error || '-' }}</template></el-table-column>
        <el-table-column label="操作" min-width="260"><template #default="{ row }">
          <el-button v-if="row.canPublish" link type="primary" :disabled="busy" @click="publish(row, false)">发布</el-button>
          <el-button v-if="row.canRetry" link type="primary" :disabled="busy" @click="mutate('post', `/api/knowledge/documents/${row.id}/reindex`)">重试索引</el-button>
          <el-button v-if="row.canPublish && row.canApproveCustomer" link type="primary" :disabled="busy" @click="publish(row, true)">审核为客户回复</el-button>
          <el-button v-if="row.canWithdraw" link :disabled="busy" @click="mutate('post', `/api/knowledge/documents/${row.id}/withdraw`)">撤回</el-button>
          <el-button v-if="row.canDownload" link :disabled="busy" @click="download(row)">下载</el-button>
          <el-button v-if="row.canDelete" link type="danger" :disabled="busy" @click="remove(row)">删除</el-button>
        </template></el-table-column>
      </el-table>
    </div>
    <el-dialog v-model="newBaseOpen" title="新建知识库" width="min(420px, 92vw)" append-to-body>
      <el-form @submit.prevent="createBase"><el-form-item label="名称"><el-input v-model="newBaseName" maxlength="100" /></el-form-item></el-form>
      <template #footer><el-button @click="newBaseOpen = false">取消</el-button><el-button type="primary" :loading="busy" :disabled="!newBaseName.trim()" @click="createBase">创建</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Search, Plus, Refresh, Upload, EditPen } from '@element-plus/icons-vue'
import { api } from '@/api/client'
import { useAccessStore } from '@/stores/access'
const props = defineProps<{ compact?: boolean; conversationId?: number | null }>()
const emit = defineEmits<{ draft: [text: string] }>()
interface Base { id: string; name: string; ready: boolean; canUpload: boolean; canGrant: boolean; canRetry: boolean; error?: string; readAccess: 'account' | 'owner' }
interface Document { id: string; baseId: string; title: string; state: string; audience: string; indexState: string; error?: string; chunks: number; canPublish: boolean; canWithdraw: boolean; canDelete: boolean; canDownload: boolean; canApproveCustomer: boolean; canRetry: boolean }
interface Answer { answered: boolean; answer: string; sources: { number: number; documentId: string; chunkId: string }[] }
const access = useAccessStore(), tab = ref('search'), bases = ref<Base[]>([]), documents = ref<Document[]>([]), baseId = ref('')
const question = ref(''), answer = ref<Answer | null>(null), error = ref(''), loading = ref(false), asking = ref(false), busy = ref(false)
const fileInput = ref<HTMLInputElement>(), newBaseOpen = ref(false), newBaseName = ref('')
const selectedBase = computed(() => bases.value.find(b => b.id === baseId.value))
const visibleDocs = computed(() => documents.value.filter(d => d.baseId === baseId.value && d.state !== 'deleted'))
const message = (e: any) => e?.response?.data?.error || '操作失败，请稍后重试'
const titleOf = (id: string) => documents.value.find(d => d.id === id)?.title || '来源文档'
function stateLabel(d: Document) { return d.error ? '索引失败' : ({ processing: '处理中', ready: '待审核', published: '已发布', withdrawn: '已撤回', deleted: '已删除', draft: '草稿' }[d.state] || d.state) }
let generation = 0
let request = 0
let unmounted = false
async function load() {
  const g = generation, r = ++request; loading.value = true
  try { const { data } = await api.get('/api/knowledge/bases'); if (g !== generation || r !== request || unmounted) return; bases.value = data.bases; documents.value = data.documents; if (!bases.value.some(b => b.id === baseId.value)) baseId.value = bases.value[0]?.id || '' }
  catch (e) { if (g === generation && r === request && !unmounted) error.value = message(e) }
  finally { if (r === request) loading.value = false }
}
async function mutate(method: 'post' | 'put' | 'delete', url: string, body?: unknown) {
  const g = generation
  busy.value = true; error.value = ''; answer.value = null
  try { await api.request({ method, url, data: body, timeout: 60000 }); if (g !== generation || unmounted) return false; await load(); return true }
  catch (e) { if (g === generation && !unmounted) error.value = message(e); return false }
  finally { busy.value = false }
}
async function createBase() { if (await mutate('post', '/api/knowledge/bases', { name: newBaseName.value.trim() })) { newBaseOpen.value = false; newBaseName.value = '' } }
async function changeAccess(value: 'account' | 'owner') { await mutate('put', `/api/knowledge/bases/${baseId.value}/access`, { readAccess: value }) }
async function upload(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file) return
  if (file.size > 20 * 1024 * 1024) { error.value = '文件超过 20 MB'; input.value = ''; return }
  const form = new FormData(); form.append('file', file)
  await mutate('post', `/api/knowledge/bases/${baseId.value}/documents`, form); input.value = ''
}
async function publish(d: Document, customerApproved: boolean) { await mutate('post', `/api/knowledge/documents/${d.id}/publish`, { customerApproved }) }
async function remove(d: Document) {
  const g = generation
  try { await ElMessageBox.confirm(`删除“${d.title}”？`, '删除文档', { type: 'warning' }) } catch { return }
  if (g !== generation || unmounted) return
  await mutate('delete', `/api/knowledge/documents/${d.id}`)
}
async function download(d: Document) {
  const g = generation
  try { const { data } = await api.get(`/api/knowledge/documents/${d.id}/download`, { responseType: 'blob' }); if (g !== generation || unmounted) return; const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = d.title; a.click(); URL.revokeObjectURL(url) }
  catch (e) { if (g === generation && !unmounted) error.value = message(e) }
}
async function ask(forReply: boolean) {
  const g = generation, conversationId = props.conversationId; asking.value = true; error.value = ''; answer.value = null
  try { const { data } = await api.post<Answer>('/api/knowledge/ask', { question: question.value.trim(), ...(forReply && conversationId ? { conversationId } : {}) }, { timeout: 180000 }); if (g !== generation || conversationId !== props.conversationId) return; answer.value = data; if (forReply && data.answered) emit('draft', data.answer) }
  catch (e) { if (g === generation) error.value = message(e) }
  finally { asking.value = false }
}
watch(() => [access.accountId, access.vdnId, props.conversationId, JSON.stringify(access.permissions), JSON.stringify(access.scopes)], () => { generation++; bases.value = []; documents.value = []; answer.value = null; error.value = ''; baseId.value = ''; void load() })
let timer: ReturnType<typeof setInterval>
onMounted(() => { void load(); timer = setInterval(() => { if (tab.value === 'documents' && !busy.value) void load() }, 5000) })
onBeforeUnmount(() => { generation++; unmounted = true; clearInterval(timer) })
</script>

<style scoped>
.knowledge-workspace { padding: 20px; background: #fff; color: #303a42; min-width: 0; letter-spacing: 0; }
.kb-heading { display: flex; gap: 12px; align-items: center; border-bottom: 1px solid #cdd6dd; padding-bottom: 12px; }
h2 { font-size: 20px; margin: 0; }
.kb-question, .kb-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
.kb-question .el-input { flex: 1; min-width: 140px; }
.kb-base-picker { width: 240px; max-width: 100%; }.kb-audience { width: 210px; max-width: 100%; }.kb-file { display: none; }
.kb-management { min-width: 0; }.kb-table { border: 1px solid #cdd6dd; width: 100%; }
.kb-answer { border-top: 2px solid #438c73; padding-top: 16px; margin-top: 20px; }
.kb-answer p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; font-size: 14px; }
.kb-answer ul { padding-left: 18px; color: #62717c; font-size: 12px; overflow-wrap: anywhere; }.kb-source-id { color: #78858d; }
.compact { padding: 8px; }.compact .kb-answer { margin-top: 12px; }.compact .kb-question { align-items: stretch; }
@media (max-width: 640px) { .knowledge-workspace { padding: 12px; }.kb-actions { align-items: stretch; }.kb-base-picker { width: 100%; }.kb-answer p { font-size: 13px; } }
</style>
