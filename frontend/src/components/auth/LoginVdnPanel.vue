<template>
  <el-card v-if="view" shadow="never" class="login-vdn-card">
    <template #header>登录 VDN</template>
    <el-descriptions :column="1" border size="small">
      <el-descriptions-item label="本次登录 VDN">{{ label(view.current) }}</el-descriptions-item>
      <el-descriptions-item label="默认登录 VDN">
        <div class="login-vdn-row">
          <span>{{ label(view.default) }}</span>
          <el-button v-if="view.options.length > 1" size="small" @click="open">更改</el-button>
        </div>
      </el-descriptions-item>
    </el-descriptions>
    <p class="login-vdn-hint">默认 VDN 只影响下次登录。当前会话保持本次进入的 VDN。</p>

    <el-dialog v-model="visible" title="更改默认登录 VDN" width="440px">
      <VdnPicker v-model="selectedKey" :choices="view.options" :disabled="saving" />
      <p class="login-vdn-hint">保存后从下次登录生效，不切换当前会话。</p>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import VdnPicker, { type VdnChoice } from '@/components/auth/VdnPicker.vue'

interface LoginVdnView {
  scope: 'seats' | 'all'
  current: VdnChoice | null
  default: VdnChoice | null
  options: VdnChoice[]
}

const auth = useAuthStore()
const router = useRouter()
const view = ref<LoginVdnView | null>(null)
const visible = ref(false)
const saving = ref(false)
const selectedKey = ref('')

function label(choice: VdnChoice | null) {
  if (!choice) return '—'
  return choice.vdn_id ? `${choice.name} · VDN ${choice.vdn_id}` : choice.name
}
function keyOf(choice: VdnChoice) {
  return `${choice.user_id}:${choice.vdn_id ?? 0}`
}

async function load() {
  try {
    const { data } = await api.get<LoginVdnView>('/api/v1/profile/login-vdn')
    view.value = data
  } catch {
    view.value = null
  }
}

function open() {
  if (!view.value) return
  const current = view.value.default ?? view.value.current
  selectedKey.value = current ? keyOf(current) : ''
  visible.value = true
}

async function save() {
  const chosen = view.value?.options.find(item => keyOf(item) === selectedKey.value)
  if (!chosen) {
    ElMessage.warning('请选择 VDN')
    return
  }
  saving.value = true
  try {
    await api.put('/api/v1/profile/login-vdn', { user_id: chosen.user_id, vdn_id: chosen.vdn_id })
    visible.value = false
    await load()
    try {
      await ElMessageBox.confirm(`默认登录 VDN 已改为「${chosen.name}」。请退出后重新登录。`, '请退出登录', {
        confirmButtonText: '退出登录',
        cancelButtonText: '稍后退出',
        type: 'warning',
        showClose: false,
      })
    } catch {
      return
    }
    await auth.logout()
    await router.replace({ name: 'login' })
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => { void load() })
</script>

<style scoped>
.login-vdn-card { margin-bottom: 12px; }
.login-vdn-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.login-vdn-hint { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: #909399; }
</style>
