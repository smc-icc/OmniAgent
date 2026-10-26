<template>
  <el-dialog v-if="productModules.enabled('icc')"
    v-model="store.panelOpen"
    title="分机绑定"
    width="min(540px, 94vw)"
    :close-on-click-modal="false"
    :show-close="!busy"
    :close-on-press-escape="!busy"
  >
    <section v-loading="loading" class="binding-panel">
      <el-alert
        v-if="error || store.error"
        :title="error || store.error"
        type="error"
        :closable="false"
        show-icon
      />
      <template v-if="store.snapshot">
        <p>
          当前分机：<strong>{{ store.binding.extension || '未绑定' }}</strong> · {{ voiceLabel }}
        </p>
        <p v-if="store.snapshot.voice.error" role="alert">{{ store.snapshot.voice.error }}</p>
        <el-alert
          v-if="store.snapshot.operation"
          type="warning"
          :closable="false"
          title="分机变更正在处理，原绑定在确认签出前保留。"
        >
          <p>{{ store.snapshot.operation.error }}</p>
          <el-button :loading="busy" @click="retryChange">重试变更</el-button>
        </el-alert>
        <div v-else-if="store.snapshot.request">
          <p>
            待审批：{{ actionLabel(store.snapshot.request.action) }}
            {{ store.snapshot.request.target_extension }}
          </p>
          <p>申请不预占号码，审批前保留当前绑定。</p>
          <el-button :loading="busy" @click="cancel">撤销申请</el-button>
        </div>
        <template v-else>
          <label for="binding-extension">选择软件分机</label>
          <el-select
            id="binding-extension"
            v-model="target"
            filterable
            clearable
            placeholder="选择空闲分机；留空表示解绑"
            :disabled="busy || !!store.snapshot.voice.call_active"
          >
            <el-option
              v-for="e in options"
              :key="e.num"
              :value="e.num"
              :label="e.description ? e.num + ' · ' + e.description : e.num"
            />
          </el-select>
          <p v-if="store.snapshot.voice.call_active">
            当前存在振铃、通话或保持，结束后可解绑或换绑。
          </p>
          <div class="binding-actions">
            <el-button :loading="busy" :disabled="!changed" @click="submit(false)"
              >申请{{ actionLabel(action) }}</el-button
            >
            <el-button
              v-if="canDirect"
              type="primary"
              :loading="busy"
              :disabled="!changed || !!store.snapshot.voice.call_active"
              @click="submit(true)"
              >直接{{ actionLabel(action) }}</el-button
            >
          </div>
        </template>
        <el-button
          v-if="
            store.binding.extension &&
            ['failed', 'signed_out', 'signing_in'].includes(store.snapshot.voice.state)
          "
          type="primary"
          :loading="busy"
          :disabled="!!store.snapshot.operation"
          @click="retryVoice"
          >{{ store.snapshot.voice.state === 'failed' ? '重试话务启动' : '话务签入' }}</el-button
        >
        <p v-if="!store.binding.extension">未绑定分机可继续使用已授权的全媒体服务。</p>
      </template>
      <el-button :disabled="busy" @click="load">刷新</el-button>
    </section>
  </el-dialog>
</template>
<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules = useProductModulesStore()

import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useExtensionBindingStore } from '@/stores/extension-binding'
import { useAuthStore } from '@/stores/auth'
import { extensionApi } from '@/api/extension-binding'
import { accessError } from '@/api/access'
const store = useExtensionBindingStore(),
  auth = useAuthStore(),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  target = ref(''),
  options = ref<Array<{ num: string; description: string }>>([])
let key = '',
  keyPayload = ''
const changed = computed(() => target.value !== store.binding.extension)
const action = computed(() =>
  !store.binding.extension ? 'bind' : !target.value ? 'unbind' : 'replace',
)
const actionLabel = (a: string) => ({ bind: '绑定', unbind: '解绑', replace: '换绑' })[a] ?? a
const voiceLabel = computed(
  () =>
    ({
      unbound: '未启动话务',
      signing_in: '等待话务启动',
      signed_in: '话务已签入',
      failed: '话务启动失败',
      signed_out: '话务已签出',
    })[store.snapshot?.voice.state ?? 'unbound'],
)
const canDirect = computed(() => {
  const p = store.snapshot?.permissions ?? []
  return action.value === 'bind'
    ? p.includes('extension.bind_self')
    : action.value === 'unbind'
      ? p.includes('extension.unbind_self')
      : p.includes('extension.bind_self') && p.includes('extension.unbind_self')
})
async function load() {
  loading.value = true
  error.value = ''
  try {
    await store.refresh()
    options.value = await extensionApi.options()
  } catch (e) {
    error.value = accessError(e)
  } finally {
    loading.value = false
  }
}
watch(
  () => store.panelOpen,
  (open) => {
    if (open) {
      target.value = store.binding.extension
      void load()
    }
  },
)
async function perform(fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await fn()
    const savedError = error.value
    await load()
    if (savedError) error.value = savedError
  } catch (e) {
    error.value = accessError(e)
  } finally {
    busy.value = false
  }
}
async function activate() {
  try {
    await auth.startBoundSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : accessError(e)
    await store.refresh().catch(() => undefined)
  }
}
async function submit(direct: boolean) {
  await perform(async () => {
    const payload = JSON.stringify([target.value, store.binding.version, direct])
    if (payload !== keyPayload) {
      key = crypto.randomUUID()
      keyPayload = payload
    }
    const body = {
      extension: target.value,
      expected_version: store.binding.version,
      idempotency_key: key,
    }
    if (direct) {
      const result = await extensionApi.change(body)
      if (result.status !== 'completed') {
        error.value = result.message ?? '变更正在处理，请稍后重试'
        return
      }
      if (result.status === 'completed') await activate()
    } else {
      await extensionApi.request(body)
      ElMessage.success('申请已提交')
    }
  })
}
async function cancel() {
  await perform(() => extensionApi.cancel(store.snapshot!.request!.id))
}
async function retryChange() {
  await perform(async () => {
    const result = await extensionApi.retry(store.snapshot!.operation!.id)
    if (result.status === 'completed') await activate()
    else error.value = result.message ?? '变更正在处理'
  })
}
async function retryVoice() {
  await perform(activate)
}
</script>
<style scoped>
.binding-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.binding-panel p {
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.binding-panel .el-select {
  width: 100%;
}
.binding-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.binding-actions .el-button {
  margin: 0;
  min-height: 40px;
}
</style>
