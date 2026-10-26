<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAccessStore } from '@/stores/access'
import { fetchVdnWorkingHours, saveVdnWorkingHours } from '@/api/vdn-working-hours'
import { dayNames, draftVdnHours, serializeVdnHours, type VdnHourDraft } from '@/utils/vdn-working-hours'
const access = useAccessStore()
const rows = ref<VdnHourDraft[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const loadedVdnId = ref<number | null>(null)
const canEdit = computed(() => access.can('settings.update'))
let generation = 0
function message(cause: unknown) {
  const problem = cause as { response?: { status?: number; data?: { error?: string; errors?: string[] } }; message?: string }
  if (problem.response?.status === 403) return '没有当前 VDN 值班时间的操作权限'
  return problem.response?.data?.errors?.join('；') || problem.response?.data?.error || problem.message || '值班时间加载失败，请重试'
}
async function load() {
  const version = ++generation
  loadedVdnId.value = null
  error.value = ''
  if (!access.can('settings.read')) { rows.value = []; error.value = '没有值班时间查看权限'; return }
  loading.value = true
  try {
    const result = await fetchVdnWorkingHours()
    if (version !== generation) return
    if (result.vdn_id !== access.vdnId) throw new Error('登录归属已变化，请刷新页面')
    rows.value = draftVdnHours(result.working_hours)
    loadedVdnId.value = result.vdn_id
  } catch (cause) { if (version === generation) { rows.value = []; error.value = message(cause) } }
  finally { if (version === generation) loading.value = false }
}
async function save() {
  if (!canEdit.value || loading.value || saving.value || loadedVdnId.value == null) return
  const vdnId = loadedVdnId.value
  saving.value = true
  error.value = ''
  try {
    if (vdnId !== access.vdnId) throw new Error('登录归属已变化，请重新加载值班时间')
    const result = await saveVdnWorkingHours(serializeVdnHours(rows.value))
    if (result.vdn_id !== vdnId || access.vdnId !== vdnId) throw new Error('登录归属已变化，请重新加载值班时间')
    rows.value = draftVdnHours(result.working_hours)
    ElMessage.success(`VDN ${vdnId} 的值班时间已保存`)
  } catch (cause) { error.value = message(cause) }
  finally { saving.value = false }
}
onMounted(load)
watch(() => access.vdnId, () => { void load() })
</script>

<template>
  <el-card shadow="never" class="vdn-hours">
    <template #header>
      <div class="hours-header"><div><strong>本 VDN 值班时间</strong><p>当前 VDN：{{ access.vdnId }}。此处设置用于 IVR 的工作时间判断。</p></div><el-button :loading="loading" :disabled="saving" @click="load">刷新</el-button></div>
    </template>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="hours-error" />
    <el-skeleton v-if="loading" :rows="7" animated />
    <template v-else-if="loadedVdnId != null">
      <p v-if="!canEdit" class="hours-note">你可以查看值班时间；保存需要值班时间修改权限。</p>
      <div class="hours-week">
        <div v-for="row in rows" :key="row.day_of_week" class="hours-day">
          <strong>{{ dayNames[row.day_of_week] }}</strong>
          <el-select v-model="row.mode" :aria-label="`${dayNames[row.day_of_week]}值班状态`" :disabled="!canEdit || saving" class="hours-mode">
            <el-option label="按时段值班" value="hours" /><el-option label="全天值班" value="all_day" /><el-option label="全天休息" value="closed" />
          </el-select>
          <div v-if="row.mode === 'hours'" class="hours-range"><el-time-picker v-model="row.open_time" format="HH:mm" value-format="HH:mm" :clearable="false" :aria-label="`${dayNames[row.day_of_week]}开始时间`" :disabled="!canEdit || saving" /><span>至</span><el-time-picker v-model="row.close_time" format="HH:mm" value-format="HH:mm" :clearable="false" :aria-label="`${dayNames[row.day_of_week]}结束时间`" :disabled="!canEdit || saving" /></div>
          <span v-else class="hours-note">{{ row.mode === 'all_day' ? '00:00—24:00' : '当天不值班' }}</span>
        </div>
      </div>
      <el-button type="primary" :disabled="!canEdit || loading" :loading="saving" class="hours-save" @click="save">保存值班时间</el-button>
    </template>
    <el-button v-else-if="error && access.can('settings.read')" @click="load">重新加载</el-button>
  </el-card>
</template>

<style scoped>
.vdn-hours { color: #303744; }
.hours-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.hours-header strong { font-size: 19px; }
.hours-header p, .hours-note { color: #667085; font-size: 13px; line-height: 1.6; }
.hours-header p { margin: 8px 0 0; }
.hours-error { margin-bottom: 16px; }
.hours-week { max-width: 800px; }
.hours-day { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; padding: 16px 0; border-bottom: 1px solid #eef0f3; }
.hours-day > strong { min-width: 36px; font-size: 14px; }
.hours-mode { width: 150px; }
.hours-range { display: flex; align-items: center; gap: 10px; }
.hours-range :deep(.el-date-editor) { width: 130px; }
.hours-save { margin-top: 24px; }
@media (max-width: 600px) { .hours-range { flex-basis: 100%; padding-left: 0; } .hours-range :deep(.el-date-editor) { width: min(38vw, 150px); } .hours-day { gap: 12px; } }
</style>
