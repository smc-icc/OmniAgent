<template>
  <div class="sms-tpl-page" :class="{ 'is-embedded': embedded }">
    <div class="tpl-head">
      <div>
        <h2 v-if="!embedded">短信模板</h2>
        <p class="tpl-sub">
          模板由班长维护并提交运营商报备；坐席在会话中只能「选模板 + 填变量」，正文不可改。
        </p>
      </div>
      <div class="tpl-actions">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button v-if="canWrite" type="primary" :icon="Plus" @click="openCreate">
          新建模板
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="!isAdmin"
      type="info"
      :closable="false"
      show-icon
      title="只读视图"
      description="只有班长可以维护短信模板。你可以查看已审批通过的模板，在会话输入栏点击「发短信」使用。"
      class="tpl-alert"
    />

    <el-table v-loading="loading" :data="items" class="tpl-table" border stripe>
      <el-table-column prop="name" label="模板名称" min-width="180" show-overflow-tooltip />
      <el-table-column label="分类" width="110">
        <template #default="{ row }">{{ CATEGORY_LABEL[row.category] ?? row.category }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="STATUS_TAG[row.status] ?? 'info'" size="small">
            {{ STATUS_LABEL[row.status] ?? row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="变量" min-width="180">
        <template #default="{ row }">
          <span v-if="!row.variables?.length" class="tpl-muted">—</span>
          <template v-else>
            <el-tag
              v-for="v in row.variables"
              :key="v.key"
              size="small"
              effect="plain"
              class="tpl-var"
            >
              {{ v.key }}{{ v.required ? ' *' : '' }}
            </el-tag>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="报备 ID" width="150" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="tpl-muted">{{ row.provider_template_id || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.updated_at) }}</template>
      </el-table-column>
      <el-table-column v-if="canWrite" label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="quickStatus(row)">
            {{ row.status === 'approved' ? '停用' : '审批通过' }}
          </el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新建 / 编辑 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑短信模板' : '新建短信模板'"
      width="760px"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="104px">
        <el-form-item label="模板名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：工单受理通知" maxlength="120" show-word-limit />
        </el-form-item>

        <el-form-item label="分类">
          <el-select v-model="form.category" style="width: 100%">
            <el-option
              v-for="(label, key) in CATEGORY_LABEL"
              :key="key"
              :label="label"
              :value="key"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="签名前缀">
          <el-input v-model="form.signature" placeholder="例如：[SeaMi] " maxlength="40" />
          <div class="tpl-hint">会拼在正文最前面，运营商报备的签名需与此一致。</div>
        </el-form-item>

        <el-form-item label="正文" prop="body">
          <el-input
            v-model="form.body"
            type="textarea"
            :rows="4"
            placeholder="Dear {{name}}, your ticket {{ticket}} has been accepted."
          />
          <div class="tpl-hint">
            用 <code>&#123;&#123;变量名&#125;&#125;</code> 占位；变量必须是下面已声明的 key，否则发送时会被清空。
          </div>
        </el-form-item>

        <el-form-item label="变量">
          <div class="tpl-vars">
            <div v-for="(v, i) in form.variables" :key="i" class="tpl-var-row">
              <el-input v-model="v.key" placeholder="key，如 name" class="w-key" />
              <el-input v-model="v.label" placeholder="显示名，如 客户名" class="w-label" />
              <el-select v-model="v.source" placeholder="取值来源" class="w-src">
                <el-option
                  v-for="s in VARIABLE_SOURCES"
                  :key="s.value"
                  :label="s.label"
                  :value="s.value"
                />
              </el-select>
              <el-checkbox v-model="v.required">必填</el-checkbox>
              <el-button link type="danger" :icon="Delete" @click="form.variables.splice(i, 1)" />
            </div>
            <el-button link type="primary" :icon="Plus" @click="addVariable">
              添加变量
            </el-button>
          </div>
        </el-form-item>

        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="待审批" value="pending" />
            <el-option label="已通过（坐席可用）" value="approved" />
            <el-option label="已停用" value="disabled" />
          </el-select>
        </el-form-item>

        <el-form-item label="短信服务商">
          <el-input v-model="form.provider" placeholder="可留空；如 aliyun / tencent / yunpian" />
        </el-form-item>

        <el-form-item label="报备模板 ID">
          <el-input
            v-model="form.provider_template_id"
            placeholder="运营商报备后返回的模板编号，接真实网关时使用"
          />
        </el-form-item>

        <el-form-item label="效果预览">
          <div class="tpl-preview">{{ preview }}</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Delete, Plus, Refresh } from '@element-plus/icons-vue'
import {
  createSmsTemplate,
  deleteSmsTemplate,
  fetchSmsTemplates,
  updateSmsTemplate,
  type SmsTemplate,
  type SmsTemplateVariable,
} from '@/api/smsTemplates'
import { useSmsRoleStore } from '@/stores/smsRole'

/**
 * embedded=true 时作为「短信管理 → 模板管理」的内嵌面板使用：
 * 隐藏页面级标题、去掉外层留白，避免与外层卡片标题重复。
 */
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const embedded = computed(() => props.embedded)

const CATEGORY_LABEL: Record<string, string> = {
  notice: '通知类',
  followup: '回访类',
  marketing: '营销类',
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '待审批',
  approved: '已通过',
  disabled: '已停用',
}

const STATUS_TAG: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  draft: 'info',
  pending: 'warning',
  approved: 'success',
  disabled: 'danger',
}

/** 与后端 templates.routes.ts 的 VARIABLE_SOURCES 保持一致 */
const VARIABLE_SOURCES = [
  { value: 'manual', label: '手动填写' },
  { value: 'contact.name', label: '客户名称' },
  { value: 'contact.phone_number', label: '客户手机号' },
  { value: 'conversation.display_id', label: '会话编号' },
  { value: 'agent.name', label: '坐席名称' },
  { value: 'date.today', label: '当天日期' },
]

const smsRole = useSmsRoleStore()
const isAdmin = computed(() => smsRole.isAdministrator)
const canWrite = computed(() => isAdmin.value)

const loading = ref(false)
const saving = ref(false)
const items = ref<SmsTemplate[]>([])

const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()

const form = reactive<{
  name: string
  category: SmsTemplate['category']
  signature: string
  body: string
  variables: SmsTemplateVariable[]
  status: SmsTemplate['status']
  provider: string
  provider_template_id: string
}>({
  name: '',
  category: 'notice',
  signature: '',
  body: '',
  variables: [],
  status: 'draft',
  provider: '',
  provider_template_id: '',
})

const rules: FormRules = {
  name: [{ required: true, message: '请填写模板名称', trigger: 'blur' }],
  body: [{ required: true, message: '请填写短信正文', trigger: 'blur' }],
}

/** 与后端 renderTemplate 一致的预览（变量按 key 原样显示） */
const preview = computed(() => {
  let text = String(form.body ?? '')
  for (const v of form.variables) {
    if (!v?.key) continue
    const shown = v.default ? String(v.default) : `〔${v.label || v.key}〕`
    text = text.split(`{{${v.key}}}`).join(shown)
  }
  text = text.replace(/\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/g, '')
  const sig = String(form.signature ?? '').trim()
  return (sig ? `${sig}${text}` : text).trim() || '（正文为空）'
})

function fmtTime(v?: string): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

function addVariable() {
  form.variables.push({ key: '', label: '', source: 'manual', required: false })
}

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    name: '',
    category: 'notice',
    signature: '',
    body: '',
    variables: [],
    status: 'draft',
    provider: '',
    provider_template_id: '',
  })
  dialogVisible.value = true
}

function openEdit(row: SmsTemplate) {
  editingId.value = row.id
  Object.assign(form, {
    name: row.name ?? '',
    category: row.category ?? 'notice',
    signature: row.signature ?? '',
    body: row.body ?? '',
    variables: (row.variables ?? []).map((v) => ({ ...v })),
    status: row.status ?? 'draft',
    provider: row.provider ?? '',
    provider_template_id: row.provider_template_id ?? '',
  })
  dialogVisible.value = true
}

async function load() {
  loading.value = true
  try {
    const res = await fetchSmsTemplates()
    items.value = res.items ?? []
    // 顺带把角色同步进 store（页面可能未经过 MainLayout 的 onMounted）
    smsRole.role = res.role === 'administrator' ? 'administrator' : 'agent'
    smsRole.loaded = true
  } catch (e) {
    ElMessage.error(`加载模板失败：${(e as Error).message}`)
  } finally {
    loading.value = false
  }
}

async function save() {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return

  const cleaned = form.variables.filter((v) => String(v.key ?? '').trim())
  const dup = cleaned
    .map((v) => String(v.key).trim())
    .find((k, i, arr) => arr.indexOf(k) !== i)
  if (dup) {
    ElMessage.warning(`变量 key 重复：${dup}`)
    return
  }

  const payload = {
    name: form.name.trim(),
    category: form.category,
    signature: form.signature,
    body: form.body,
    variables: cleaned.map((v) => ({
      ...v,
      key: String(v.key).trim(),
      label: String(v.label ?? '').trim(),
    })),
    status: form.status,
    provider: form.provider.trim() || null,
    provider_template_id: form.provider_template_id.trim() || null,
  }

  saving.value = true
  try {
    if (editingId.value) {
      await updateSmsTemplate(editingId.value, payload)
      ElMessage.success('模板已更新')
    } else {
      await createSmsTemplate(payload)
      ElMessage.success('模板已创建')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    ElMessage.error(errText(e, '保存失败'))
  } finally {
    saving.value = false
  }
}

async function quickStatus(row: SmsTemplate) {
  const next = row.status === 'approved' ? 'disabled' : 'approved'
  try {
    await updateSmsTemplate(row.id, { status: next })
    ElMessage.success(next === 'approved' ? '已通过，坐席可用' : '已停用')
    await load()
  } catch (e) {
    ElMessage.error(errText(e, '操作失败'))
  }
}

async function remove(row: SmsTemplate) {
  try {
    await ElMessageBox.confirm(
      `确定删除模板「${row.name}」？已发送过的短信记录不受影响，但坐席将无法再选用该模板。`,
      '删除短信模板',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await deleteSmsTemplate(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(errText(e, '删除失败'))
  }
}

function errText(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  if (msg) return `[${fallback}] ${msg}`
  return `${fallback}：${(e as Error).message ?? '未知错误'}`
}

onMounted(load)
</script>

<style scoped>
.sms-tpl-page {
  padding: 18px 20px;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
}
/* 内嵌到「短信管理」时，外层已有卡片与内边距，这里不再重复 */
.sms-tpl-page.is-embedded {
  padding: 0;
  height: auto;
  overflow: visible;
}
.tpl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.tpl-head h2 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
}
.tpl-sub {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}
.tpl-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.tpl-alert {
  margin-bottom: 12px;
}
.tpl-table {
  width: 100%;
}
.tpl-muted {
  color: #94a3b8;
}
.tpl-var {
  margin: 0 4px 2px 0;
}
.tpl-vars {
  width: 100%;
}
.tpl-var-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.w-key {
  width: 150px;
  flex-shrink: 0;
}
.w-label {
  width: 150px;
  flex-shrink: 0;
}
.w-src {
  width: 150px;
  flex-shrink: 0;
}
.tpl-hint {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.7;
}
.tpl-preview {
  width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.7;
  color: #1f2937;
}
</style>
