<template>
  <el-dialog v-model="open" title="坐席登录授权码" width="min(540px, 94vw)" :close-on-click-modal="false" destroy-on-close>
    <template v-if="operator">
      <p class="code-seat">{{ operator.name }} · {{ operator.work_no }}</p>
      <p class="code-note">仅用于此坐席的移动登录，不增加权限。每个授权码有效 15 分钟，只能使用一次。</p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <div v-if="issued" class="issued-code">
        <label for="issued-seat-login-code">新签发的授权码（关闭后不再显示）</label>
        <textarea id="issued-seat-login-code" :value="issued.code" rows="2" readonly spellcheck="false" />
        <p>{{ formatTime(issued.expiresAt) }} 前有效</p>
        <el-button @click="copy">复制授权码</el-button>
      </div>
      <div class="code-actions">
        <el-button type="primary" :loading="busy" :disabled="!operator.enabled" @click="issue">签发授权码</el-button>
        <el-button :disabled="busy" @click="load">刷新有效授权码</el-button>
      </div>
      <el-table :data="codes" v-loading="busy" empty-text="暂无有效授权码" size="small">
        <el-table-column label="签发时间" min-width="150"><template #default="{ row }">{{ formatTime(row.issuedAt) }}</template></el-table-column>
        <el-table-column label="到期时间" min-width="150"><template #default="{ row }">{{ formatTime(row.expiresAt) }}</template></el-table-column>
        <el-table-column label="操作" width="80"><template #default="{ row }"><el-button link type="danger" :disabled="busy" @click="revoke(row.id)">撤销</el-button></template></el-table-column>
      </el-table>
    </template>
    <template #footer><el-button @click="open = false">关闭</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { accessApi, accessError, type Operator, type LoginCodeMetadata, type IssuedLoginCode } from '@/api/access'
const props = defineProps<{ operator?: Operator }>()
const open = defineModel<boolean>({ default: false })
const codes = ref<LoginCodeMetadata[]>([])
const issued = ref<IssuedLoginCode | null>(null)
const busy = ref(false)
const error = ref('')
let generation = 0
const formatTime = (time: number) => new Date(time).toLocaleString('zh-CN', { hour12: false })
watch([open, () => props.operator?.id], () => {
  generation++; codes.value = []; issued.value = null; error.value = ''; busy.value = false
  if (open.value && props.operator) void load()
})
async function load() {
  if (!props.operator || busy.value) return
  const id = props.operator.id, current = generation
  busy.value = true; error.value = ''
  try { const result = await accessApi.loginCodes(id); if (current === generation) codes.value = result.codes }
  catch (e) { if (current === generation) error.value = accessError(e) }
  finally { if (current === generation) busy.value = false }
}
async function issue() {
  if (!props.operator?.enabled || busy.value) return
  const id = props.operator.id, current = generation
  busy.value = true; error.value = ''; issued.value = null
  try {
    const result = await accessApi.issueLoginCode(id)
    if (current === generation) { issued.value = result; codes.value = [...codes.value, { id: result.id, issuerId: result.issuerId, issuedAt: result.issuedAt, expiresAt: result.expiresAt }] }
  } catch (e) { if (current === generation) error.value = accessError(e) }
  finally { if (current === generation) busy.value = false }
}
async function revoke(codeId: string) {
  if (!props.operator || busy.value) return
  const id = props.operator.id, current = generation
  busy.value = true; error.value = ''
  try {
    await accessApi.revokeLoginCode(id, codeId)
    if (current === generation) { codes.value = codes.value.filter(code => code.id !== codeId); if (issued.value?.id === codeId) issued.value = null }
  } catch (e) { if (current === generation) error.value = accessError(e) }
  finally { if (current === generation) busy.value = false }
}
async function copy() {
  if (!issued.value) return
  try { await navigator.clipboard.writeText(issued.value.code); ElMessage.success('授权码已复制') }
  catch { ElMessage.warning('复制失败，请选中授权码后手动复制') }
}
</script>

<style scoped>
.code-seat { margin: 0 0 12px; font-weight: 600; }
.code-note { color: #667085; line-height: 1.6; }
.issued-code { background: #f5f8fc; border: 1px solid #d0d5dd; border-radius: 6px; padding: 16px; margin: 16px 0; }
.issued-code label { display: block; margin-bottom: 8px; }
.issued-code textarea { width: 100%; box-sizing: border-box; font-family: monospace; font-size: 16px; padding: 10px; border: 1px solid #d0d5dd; border-radius: 4px; resize: none; }
.issued-code p { color: #667085; font-size: 13px; }
.code-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
.code-actions :deep(.el-button + .el-button) { margin-left: 0; }
</style>
