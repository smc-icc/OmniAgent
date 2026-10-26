<template>
  <section class="extension-management">
    <header>
      <h3>分机分配与申请审批</h3>
      <el-button :loading="busy" @click="load">刷新申请</el-button>
    </header>
    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />
    <div v-if="access.can('extension.assign')" class="assignment-tools">
      <el-select
        v-model="selectedUser"
        filterable
        placeholder="选择当前 VDN 的坐席"
        @change="loadTarget"
        ><el-option
          v-for="u in users.filter((u) => u.enabled)"
          :key="u.id"
          :value="u.id"
          :label="u.work_no + ' · ' + u.name + ' · ' + (u.extension || '未绑定')"
      /></el-select>
      <el-select
        v-model="target"
        filterable
        clearable
        placeholder="选择分机；留空表示解绑"
        :disabled="!selectedUser || busy"
        ><el-option
          v-for="e in options"
          :key="e.num"
          :value="e.num"
          :label="e.num + ' ' + (e.description || '')"
      /></el-select>
      <el-button
        type="primary"
        :loading="busy"
        :disabled="!selectedUser || target === current"
        @click="assign"
        >{{ target ? (current ? '换绑' : '分配') : '解绑' }}</el-button
      >
      <p v-if="selectedUser">
        当前绑定：{{ current || '未绑定'
        }}<span v-if="operation"> · 处理中：{{ operation.error || operation.phase }}</span>
      </p>
    </div>
    <template v-if="access.can('extension.approve')">
      <el-table :data="requests" row-key="id" max-height="400" empty-text="暂无分机申请">
        <el-table-column label="坐席" min-width="120"
          ><template #default="{ row }">{{ userLabel(row.user_id) }}</template></el-table-column
        >
        <el-table-column label="申请" min-width="110"
          ><template #default="{ row }">{{ actionLabel(row.action) }}</template></el-table-column
        >
        <el-table-column prop="old_extension" label="原分机" min-width="100" />
        <el-table-column prop="target_extension" label="目标分机" min-width="100" />
        <el-table-column label="状态" min-width="100"
          ><template #default="{ row }">{{ statusLabel(row.status) }}</template></el-table-column
        >
        <el-table-column prop="reason" label="处理说明" min-width="160" />
        <el-table-column label="审批" min-width="150"
          ><template #default="{ row }"
            ><template v-if="['pending', 'executing'].includes(row.status)"
              ><el-button link type="primary" :disabled="busy" @click="approve(row)">{{
                row.status === 'executing' ? '重试' : '批准'
              }}</el-button
              ><el-button
                v-if="row.status === 'pending'"
                link
                type="danger"
                :disabled="busy"
                @click="reject(row)"
                >拒绝</el-button
              ></template
            ></template
          ></el-table-column
        >
      </el-table>
    </template>
  </section>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAccessStore } from '@/stores/access'
import { extensionApi, type BindingRequest, type BindingOperation } from '@/api/extension-binding'
import { accessError, type Operator } from '@/api/access'
const props = defineProps<{ users: Operator[] }>(),
  emit = defineEmits<{ changed: [] }>(),
  access = useAccessStore(),
  busy = ref(false),
  error = ref(''),
  requests = ref<BindingRequest[]>([]),
  selectedUser = ref<number>(),
  current = ref(''),
  version = ref(0),
  target = ref(''),
  options = ref<Array<{ num: string; description: string }>>([]),
  operation = ref<BindingOperation | null>(null)
let key = '',
  payload = ''
const actionLabel = (value: string) =>
  ({ bind: '绑定', unbind: '解绑', replace: '换绑' })[value] ?? value
const statusLabel = (value: string) =>
  ({
    pending: '待审批',
    executing: '处理中',
    approved: '已批准',
    rejected: '已拒绝',
    cancelled: '已撤销',
    stale: '已失效',
  })[value] ?? value
const userLabel = (id: number) => {
  const u = props.users.find((u) => u.id === id)
  return u ? u.work_no + ' · ' + u.name : String(id)
}
async function load() {
  error.value = ''
  if (access.can('extension.approve'))
    try {
      requests.value = await extensionApi.requests()
    } catch (e) {
      error.value = accessError(e)
    }
}
async function loadTarget() {
  if (!selectedUser.value) return
  busy.value = true
  error.value = ''
  try {
    const data = await extensionApi.target(selectedUser.value)
    current.value = data.binding.extension
    version.value = data.binding.version
    target.value = current.value
    options.value = data.extensions
    operation.value = data.operation
  } catch (e) {
    error.value = accessError(e)
  } finally {
    busy.value = false
  }
}
async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await fn()
    emit('changed')
    const saved = error.value
    if (selectedUser.value) await loadTarget()
    await load()
    if (saved) error.value = saved
  } catch (e) {
    error.value = accessError(e)
  } finally {
    busy.value = false
  }
}
async function assign() {
  await run(async () => {
    const next = JSON.stringify([selectedUser.value, target.value, version.value])
    if (next !== payload) {
      key = crypto.randomUUID()
      payload = next
    }
    const result = await extensionApi.assign(selectedUser.value!, {
      extension: target.value,
      expected_version: version.value,
      idempotency_key: key,
    })
    if (result.status !== 'completed') {
      error.value = result.message || '正在处理，稍后重试原操作'
      return
    }
    ElMessage.success('分机绑定已更新')
  })
}
async function approve(r: BindingRequest) {
  await run(async () => {
    const result = await extensionApi.approve(r.id)
    if (!['completed', 'approved'].includes(result.status))
      error.value = result.message || '变更正在处理中'
  })
}
async function reject(r: BindingRequest) {
  let reason: string
  try {
    reason = (
      await ElMessageBox.prompt('请输入拒绝原因', '拒绝分机申请', {
        inputValidator: (value) => value.length <= 500 || '原因不能超过 500 字',
        confirmButtonText: '拒绝',
        cancelButtonText: '取消',
      })
    ).value
  } catch {
    return
  }
  await run(async () => {
    await extensionApi.reject(r.id, reason)
  })
}
onMounted(load)
</script>
<style scoped>
.extension-management {
  margin-top: 24px;
}
.extension-management header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.assignment-tools {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  padding: 16px 0;
}
.assignment-tools .el-select {
  width: min(320px, 100%);
}
.assignment-tools p {
  width: 100%;
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
