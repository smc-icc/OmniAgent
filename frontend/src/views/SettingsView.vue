<template>
  <div class="st-root">
    <div class="st-header">
      <h3 class="st-title">⚙ 设置</h3>
    </div>

    <el-card shadow="never" class="st-card">
      <template #header>坐席信息</template>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="姓名">{{ agent.profile.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="工号">{{ agent.profile.work_no || '—' }}</el-descriptions-item>
        <el-descriptions-item label="ID">{{ agent.profile.id || '—' }}</el-descriptions-item>
        <el-descriptions-item label="分机号"><ExtensionBindingStatus /></el-descriptions-item>
        <el-descriptions-item label="技能组">{{ agent.profile.team || '—' }}</el-descriptions-item>
        <el-descriptions-item label="部门">{{ profileForm.department || agent.profile.department || '—' }}</el-descriptions-item>
        <el-descriptions-item label="职位">{{ profileForm.title || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <LoginVdnPanel />

    <el-card shadow="never" class="st-card">
      <template #header>工作台</template>
      <div class="st-row">
        <span>新会话桌面通知</span>
        <el-switch v-model="notifyNewSession" />
      </div>
      <div class="st-row">
        <span>消息提示音</span>
        <el-switch v-model="soundEnabled" />
      </div>
    </el-card>

    <el-card shadow="never" class="st-card">
      <template #header>登录终端</template>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="策略">一账号仅一个终端，一终端仅一个账号</el-descriptions-item>
        <el-descriptions-item label="本机标识">{{ terminal.device_label || '—' }}</el-descriptions-item>
        <el-descriptions-item label="登录时间">{{ terminal.issued_at || '—' }}</el-descriptions-item>
      </el-descriptions>
      <p class="st-hint">其他浏览器再用同一账号登录时，本机会话会立即退出。</p>
    </el-card>

    <el-card shadow="never" class="st-card">
      <template #header>小休申请</template>
      <div class="st-actions">
        <el-button type="primary" link @click="$router.push({ name: 'rest-requests' })">
          查看小休申请记录
        </el-button>
      </div>
      <p class="st-hint">坐席可查看自己发起的申请；班长可查看自己审批过的记录。</p>
    </el-card>

    <el-card shadow="never" class="st-card">
      <template #header>账号</template>
      <div class="st-actions">
        <el-button type="primary" link @click="openProfile">个人信息</el-button>
        <el-button type="primary" link @click="openPassword">修改密码</el-button>
      </div>
    </el-card>

    <el-dialog v-model="profileDlg" title="个人信息" width="440px">
      <el-form label-width="72px">
        <el-form-item label="姓名">
          <el-input v-model="profileForm.name" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="profileForm.display_name" />
        </el-form-item>
        <el-form-item label="部门">
          <el-input v-model="profileForm.department" />
        </el-form-item>
        <el-form-item label="职位">
          <el-input v-model="profileForm.title" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" :loading="profileSaving" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pwdDlg" title="修改密码" width="420px">
      <el-form label-width="80px">
        <el-form-item label="旧密码">
          <el-input v-model="pwdForm.old_password" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.new_password" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="pwdForm.confirm" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" :loading="pwdSaving" @click="savePassword">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import ExtensionBindingStatus from '@/components/ExtensionBindingStatus.vue'
import LoginVdnPanel from '@/components/auth/LoginVdnPanel.vue'
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAgentStore } from '@/stores/agent'
import { api } from '@/api/client'
import { fetchDashboardProfile } from '@/api/dashboard'

const route = useRoute()
const agent = useAgentStore()
const terminal = reactive({ device_label: '', issued_at: '' })

const profileDlg = ref(false)
const profileSaving = ref(false)
const profileForm = reactive({
  name: '',
  display_name: '',
  department: '',
  title: '',
})

const pwdDlg = ref(false)
const pwdSaving = ref(false)
const pwdForm = reactive({
  old_password: '',
  new_password: '',
  confirm: '',
})

const notifyNewSession = ref(localStorage.getItem('oa.notifyNewSession') !== '0')
const soundEnabled = ref(localStorage.getItem('oa.soundEnabled') !== '0')

function persist(key: string, val: boolean) {
  localStorage.setItem(key, val ? '1' : '0')
}

async function hydrateProfileForm() {
  try {
    const p = await fetchDashboardProfile()
    profileForm.name = p.name || agent.profile.name || ''
    profileForm.display_name = agent.profile.name || p.name || ''
    profileForm.department = p.department || ''
    profileForm.title = p.title || ''
  } catch {
    profileForm.name = agent.profile.name || ''
    profileForm.department = agent.profile.department || ''
  }
}

function openProfile() {
  void hydrateProfileForm()
  profileDlg.value = true
}

function openPassword() {
  pwdForm.old_password = ''
  pwdForm.new_password = ''
  pwdForm.confirm = ''
  pwdDlg.value = true
}

async function saveProfile() {
  profileSaving.value = true
  try {
    await api.put('/api/v1/profile', {
      name: profileForm.name,
      display_name: profileForm.display_name || profileForm.name,
      department: profileForm.department,
      title: profileForm.title,
    })
    agent.profile.name = profileForm.name
    agent.profile.department = profileForm.department
    ElMessage.success('已保存')
    profileDlg.value = false
  } catch {
    ElMessage.error('保存失败')
  } finally {
    profileSaving.value = false
  }
}

async function savePassword() {
  if (!pwdForm.old_password || !pwdForm.new_password) {
    ElMessage.warning('请填写完整')
    return
  }
  if (pwdForm.new_password.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  if (pwdForm.new_password !== pwdForm.confirm) {
    ElMessage.warning('两次新密码不一致')
    return
  }
  pwdSaving.value = true
  try {
    await api.post('/api/agent/change-password', {
      old_password: pwdForm.old_password,
      new_password: pwdForm.new_password,
    })
    ElMessage.success('密码已修改')
    pwdDlg.value = false
  } catch (e: unknown) {
    const msg =
      e && typeof e === 'object' && 'response' in e
        ? String((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? '')
        : ''
    ElMessage.error(msg || '修改失败')
  } finally {
    pwdSaving.value = false
  }
}

onMounted(async () => {
  try {
    const { data } = await api.get<{ device_label?: string; issued_at?: string }>('/api/agent/login-session')
    terminal.device_label = data.device_label ?? ''
    terminal.issued_at = data.issued_at ? new Date(data.issued_at).toLocaleString('zh-CN') : ''
  } catch {
    terminal.device_label = ''
    terminal.issued_at = ''
  }
  await hydrateProfileForm()
  const tab = String(route.query.tab || '')
  if (tab === 'profile') openProfile()
  if (tab === 'password') openPassword()
})

watch(
  () => route.query.tab,
  (tab) => {
    if (tab === 'profile') openProfile()
    if (tab === 'password') openPassword()
  },
)

watch(notifyNewSession, (v) => persist('oa.notifyNewSession', v))
watch(soundEnabled, (v) => persist('oa.soundEnabled', v))
</script>

<style scoped>
.st-root {
  max-width: 880px;
}
.st-header {
  margin-bottom: 12px;
}
.st-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}
.st-card {
  margin-bottom: 12px;
}
.st-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 14px;
  color: #303133;
}
.st-actions {
  display: flex;
  gap: 16px;
}
.st-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #909399;
}
</style>
