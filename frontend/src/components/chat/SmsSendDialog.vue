<template>
  <el-dialog
    v-model="visible"
    title="发送短信"
    width="580px"
    append-to-body
    @open="onOpen"
  >
    <div v-loading="loading" class="sms-dialog">
      <el-alert
        v-if="!templates.length && !loading"
        type="warning"
        :closable="false"
        show-icon
        title="暂无可用短信模板"
        description="短信模板由班长在「短信模板」中维护并审批；审批通过（approved）后坐席才能选用。"
      />

      <template v-else>
        <el-form label-width="76px" size="default">
          <el-form-item label="短信模板">
            <el-select v-model="templateId" placeholder="请选择模板" style="width: 100%">
              <el-option v-for="t in templates" :key="t.id" :label="t.name" :value="t.id" />
            </el-select>
          </el-form-item>

          <template v-if="current">
            <!-- 正文只读：合规要求（内容对应运营商报备模板），坐席只能填变量 -->
            <el-form-item label="内容预览">
              <div class="preview">{{ rendered }}</div>
            </el-form-item>

            <el-form-item
              v-for="v in current.variables"
              :key="v.key"
              :label="v.label || v.key"
            >
              <el-input
                v-model="values[v.key]"
                :placeholder="placeholderFor(v)"
                clearable
              />
              <span v-if="v.required" class="req">必填</span>
            </el-form-item>

            <el-form-item label="收件人">
              <el-input v-model="to" placeholder="留空则发给当前客户手机号" />
              <div v-if="contactPhone" class="hint">客户手机号：{{ contactPhone }}</div>
              <div v-else class="hint warn">当前客户没有手机号，请手动填写</div>
            </el-form-item>

            <el-form-item label="计费">
              <span class="hint">{{ rendered.length }} 字 · 约 {{ segments }} 条</span>
            </el-form-item>
          </template>
        </el-form>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="sending"
        :disabled="!canSend"
        @click="submit"
      >
        发送
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchSmsSendContext,
  sendSmsFromTemplate,
  type SmsSendContext,
  type SmsTemplate,
  type SmsTemplateVariable,
} from '@/api/smsTemplates'

const props = defineProps<{
  modelValue: boolean
  conversationId: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  sent: [{ text: string; messageId: number | null }]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const loading = ref(false)
const sending = ref(false)
const ctx = ref<SmsSendContext | null>(null)
const templateId = ref<number | null>(null)
const values = ref<Record<string, string>>({})
const to = ref('')

const templates = computed<SmsTemplate[]>(() =>
  (ctx.value?.templates ?? []).filter((t) => t.status === 'approved' || ctx.value?.role === 'administrator'),
)
const current = computed<SmsTemplate | null>(
  () => templates.value.find((t) => t.id === templateId.value) ?? null,
)
const contactPhone = computed(() => String(ctx.value?.contact?.phone_number ?? '').trim())

/** 与后端 renderTemplate 保持一致的预览 */
const rendered = computed(() => {
  const tpl = current.value
  if (!tpl) return ''
  let text = String(tpl.body ?? '')
  for (const v of tpl.variables ?? []) {
    const raw = values.value[v.key]
    const val = raw != null && String(raw).length ? String(raw) : String(v.default ?? '')
    text = text.split(`{{${v.key}}}`).join(val)
  }
  text = text.replace(/\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/g, '')
  const sig = String(tpl.signature ?? '').trim()
  return (sig ? `${sig}${text}` : text).trim()
})

/** 短信按 70 字一条（中文）粗略估算 */
const segments = computed(() => Math.max(1, Math.ceil(rendered.value.length / 70)))

const canSend = computed(() => {
  if (!current.value || sending.value) return false
  if (!to.value.trim() && !contactPhone.value) return false
  const missing = (current.value.variables ?? []).filter(
    (v) => v.required && !String(values.value[v.key] ?? v.default ?? '').trim(),
  )
  return missing.length === 0
})

function placeholderFor(v: SmsTemplateVariable): string {
  if (v.default) return `默认：${v.default}`
  return '请输入'
}

/** 按变量来源自动填充（客户名/手机号/会话号） */
function autoFill(tpl: SmsTemplate) {
  const c = ctx.value?.contact
  const conv = ctx.value?.conversation
  const next: Record<string, string> = {}
  for (const v of tpl.variables ?? []) {
    let val = ''
    if (v.source === 'contact.name') val = String(c?.name ?? '')
    else if (v.source === 'contact.phone_number') val = String(c?.phone_number ?? '')
    else if (v.source === 'conversation.display_id') val = conv ? String(conv.display_id) : ''
    else if (v.source === 'date.today') val = new Date().toLocaleDateString('zh-CN')
    if (!val && v.default) val = String(v.default)
    next[v.key] = val
  }
  values.value = next
}

watch(templateId, () => {
  const tpl = current.value
  if (tpl) autoFill(tpl)
})

watch(
  () => ctx.value,
  () => {
    if (!to.value && contactPhone.value) to.value = contactPhone.value
  },
)

async function onOpen() {
  loading.value = true
  try {
    ctx.value = await fetchSmsSendContext(props.conversationId)
    templateId.value = templates.value.length === 1 ? templates.value[0].id : null
    if (templateId.value != null) {
      const tpl = current.value
      if (tpl) autoFill(tpl)
    }
    if (contactPhone.value) to.value = contactPhone.value
  } catch (e) {
    ElMessage.error(`加载短信上下文失败：${(e as Error).message}`)
  } finally {
    loading.value = false
  }
}

async function submit() {
  const tpl = current.value
  if (!tpl) return
  sending.value = true
  try {
    const payload = {
      to: to.value.trim() || contactPhone.value,
      variables: values.value,
      ...(props.conversationId ? { conversationId: props.conversationId } : {}),
    }
    const res = await sendSmsFromTemplate(tpl.id, payload)
    ElMessage.success('短信已提交发送')
    emit('sent', res)
    visible.value = false
  } catch (e) {
    // 后端在未配置网关时返回可读错误，这里直接展示
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    ElMessage.error(msg ?? `发送失败：${(e as Error).message}`)
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.sms-dialog {
  min-height: 120px;
}
.preview {
  white-space: pre-wrap;
  word-break: break-word;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  color: #1f2937;
  font-size: 14px;
  line-height: 1.7;
  width: 100%;
  box-sizing: border-box;
}
.hint {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.6;
}
.hint.warn {
  color: #e6a23c;
}
.req {
  margin-left: 8px;
  font-size: 12px;
  color: #f56c6c;
}
</style>
