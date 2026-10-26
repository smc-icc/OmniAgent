<template>
  <el-dialog
    v-model="visible"
    title="发送邮件"
    width="580px"
    append-to-body
    @open="onOpen"
  >
    <div v-loading="loading" class="mail-dialog">
      <el-alert
        v-if="!smtpEnabled && !loading"
        type="warning"
        :closable="false"
        show-icon
        title="邮件渠道未开启 SMTP"
        description="请先在 Conf 的「渠道接入 → 邮件」里配置 SMTP 服务器与授权码，否则无法发信。"
      />

      <el-form label-width="76px" size="default">
        <el-form-item label="发件人">
          <span class="mail-from">{{ fromEmail || '（未配置邮件渠道）' }}</span>
        </el-form-item>

        <el-form-item label="收件人">
          <el-input v-model="to" placeholder="客户邮箱，可修改" clearable />
          <div v-if="contactEmail" class="hint">客户邮箱：{{ contactEmail }}</div>
          <div v-else class="hint warn">当前客户没有邮箱，请手动填写</div>
        </el-form-item>

        <el-form-item label="主题">
          <el-input v-model="subject" placeholder="例如：关于您的工单跟进" clearable />
        </el-form-item>

        <el-form-item label="正文">
          <el-input
            v-model="content"
            type="textarea"
            :rows="7"
            placeholder="邮件正文（纯文本）"
          />
        </el-form-item>
      </el-form>
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
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api/client'

const props = defineProps<{
  modelValue: boolean
  conversationId: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  sent: [{ to: string; subject: string; messageId: number | null }]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const loading = ref(false)
const sending = ref(false)
const fromEmail = ref('')
const smtpEnabled = ref(false)
const contactEmail = ref('')
const to = ref('')
const subject = ref('')
const content = ref('')

/** 与后端 sendEmailFromAgent 的校验保持一致 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const canSend = computed(
  () =>
    !sending.value
    && EMAIL_RE.test(to.value.trim())
    && content.value.trim().length > 0,
)

async function onOpen() {
  loading.value = true
  try {
    const { data } = await api.get('/api/email/send-context', {
      params: props.conversationId ? { conversationId: props.conversationId } : {},
    })
    fromEmail.value = data?.from_email ?? ''
    smtpEnabled.value = Boolean(data?.smtp_enabled)
    contactEmail.value = String(data?.contact?.email ?? '').trim()
    to.value = String(data?.suggested_to ?? contactEmail.value ?? '').trim()
    // 主题默认带会话号，方便客户侧对上下文
    const displayId = data?.conversation?.display_id
    subject.value = displayId ? `关于您的咨询 #${displayId}` : ''
    content.value = ''
  } catch (e) {
    ElMessage.error(`加载邮件上下文失败：${(e as Error).message}`)
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!canSend.value) return
  sending.value = true
  try {
    const { data } = await api.post('/api/email/send', {
      to: to.value.trim(),
      subject: subject.value.trim(),
      content: content.value,
      ...(props.conversationId ? { conversationId: props.conversationId } : {}),
    })
    ElMessage.success('邮件已发送')
    emit('sent', {
      to: data?.to ?? to.value.trim(),
      subject: data?.subject ?? subject.value.trim(),
      messageId: data?.messageId ?? null,
    })
    visible.value = false
  } catch (e) {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    ElMessage.error(msg ?? `发送失败：${(e as Error).message}`)
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.mail-dialog {
  min-height: 120px;
}
.mail-from {
  color: #475569;
  font-size: 14px;
}
.hint {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.6;
}
.hint.warn {
  color: #e6a23c;
}
</style>
