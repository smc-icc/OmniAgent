<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="680px"
    append-to-body
    destroy-on-close
    class="ws-pick-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    @opened="onOpened"
  >
    <div class="xfer-split">
      <div class="xfer-pane">
        <div class="xfer-pane-hd">技能组</div>
        <el-scrollbar max-height="360px">
          <div
            v-for="g in groups"
            :key="g.id"
            class="xfer-row"
            :class="{ active: selectedGroupId === g.id }"
            @click="selectedGroupId = g.id"
            @dblclick="onGroupDblClick(g)"
          >
            {{ g.name }}
            <span class="xfer-meta">{{ groupCount(g) }}</span>
          </div>
          <el-empty v-if="!loading && !groups.length" :description="isMedia ? '暂无排队会话' : '请先签入技能组'" :image-size="64" />
        </el-scrollbar>
      </div>
      <div class="xfer-pane">
        <div class="xfer-pane-hd">{{ listPaneTitle }}</div>
        <el-scrollbar v-loading="loading" max-height="360px">
          <template v-if="mode === 'snatch'">
            <div
              v-for="a in currentAgents"
              :key="a.agentId"
              class="xfer-row"
              @dblclick="pickSnatch(a)"
            >
              <strong>{{ a.workNo }}</strong>
              <span>{{ a.name }}</span>
              <span class="xfer-meta">{{ a.callerNo || '—' }}</span>
            </div>
            <el-empty
              v-if="!loading && selectedGroupId != null && !currentAgents.length"
              :description="snatchEmptyHint"
              :image-size="64"
            />
          </template>
          <template v-else>
            <div
              v-for="c in currentCalls"
              :key="c.logicNo"
              class="xfer-row ws-call-row"
              @dblclick="pickQueue(c)"
            >
              <strong>{{ c.callerNo || '—' }}</strong>
              <span class="xfer-meta">{{ formatCallTime(c.startTime) }} · 等待 {{ formatWait(c.enterAcdTime) }} · VIP {{ c.vipLevel }}</span>
            </div>
            <el-empty
              v-if="!loading && selectedGroupId != null && !currentCalls.length"
              :description="queueEmptyHint"
              :image-size="64"
            />
          </template>
          <el-empty
            v-if="!loading && selectedGroupId == null && groups.length"
            description="请选择技能组，或直接点确定取第一通"
            :image-size="64"
          />
        </el-scrollbar>
      </div>
    </div>
    <template #footer>
      <span class="xfer-hint">双击分组=该组第一通；未选组点确定=全部组第一通</span>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAgentStore } from '@/stores/agent'
import { formatCcsAck } from '@/utils/ccs-errors'
import {
  fetchMediaQueueSessions,
  fetchMediaSnatchTargets,
  fetchQueueCalls,
  fetchSnatchTargets,
  snatchMediaSession,
  takeQueuedCall,
  takeQueuedMediaSession,
  type WorkspaceQueueCall,
  type WorkspaceQueueGroup,
  type WorkspaceSnatchAgent,
  type WorkspaceSnatchGroup,
} from '@/api/workspace'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    mode: 'snatch' | 'queue'
    channel?: 'media' | 'phone'
  }>(),
  { channel: 'phone' },
)

const emit = defineEmits<{
  'update:modelValue': [boolean]
}>()

const agent = useAgentStore()
const loading = ref(false)
const submitting = ref(false)
const selectedGroupId = ref<number | null>(null)
const snatchGroups = ref<WorkspaceSnatchGroup[]>([])
const queueGroups = ref<WorkspaceQueueGroup[]>([])

const groups = computed(() => (props.mode === 'snatch' ? snatchGroups.value : queueGroups.value))
const isMedia = computed(() => props.channel === 'media')
const listPaneTitle = computed(() => {
  if (props.mode === 'snatch') return isMedia.value ? '会话中坐席（双击抢接）' : '振铃坐席（双击抢接）'
  return isMedia.value ? '排队会话（双击接会话）' : '排队呼叫（双击接听）'
})
const snatchEmptyHint = computed(() => (isMedia.value ? '该组无会话中坐席' : '该组无振铃坐席'))
const queueEmptyHint = computed(() => (isMedia.value ? '该组无排队会话' : '该组无排队电话'))

const dialogTitle = computed(() => {
  if (props.mode === 'snatch') return '抢接坐席'
  const total = queueGroups.value.reduce((n, g) => (g.id === -1 ? g.count : n), 0)
    || queueGroups.value.reduce((n, g) => n + (g.id > 0 ? g.count : 0), 0)
  if (isMedia.value) return total > 0 ? `排队会话（共 ${total} 通）` : '排队会话'
  return total > 0 ? `排队电话（共 ${total} 通）` : '排队电话'
})

const currentAgents = computed(() => {
  if (props.mode !== 'snatch' || selectedGroupId.value == null) return []
  return snatchGroups.value.find((g) => g.id === selectedGroupId.value)?.agents ?? []
})

const currentCalls = computed(() => {
  if (props.mode !== 'queue' || selectedGroupId.value == null) return []
  return queueGroups.value.find((g) => g.id === selectedGroupId.value)?.calls ?? []
})

function groupCount(g: WorkspaceSnatchGroup | WorkspaceQueueGroup) {
  if ('agents' in g) return g.agents.length
  return g.count
}

function formatCallTime(sec: number) {
  if (!sec) return '--'
  const d = new Date(sec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatWait(enterAcdTime: number) {
  if (!enterAcdTime) return '0秒'
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - enterAcdTime))
  if (sec < 60) return `${sec}秒`
  const m = Math.floor(sec / 60)
  return `${m}分${sec % 60}秒`
}

function firstSnatch(groupId: number | null): WorkspaceSnatchAgent | null {
  if (groupId != null) {
    return snatchGroups.value.find((g) => g.id === groupId)?.agents[0] ?? null
  }
  const seen = new Set<number>()
  for (const g of snatchGroups.value) {
    for (const a of g.agents) {
      if (seen.has(a.agentId)) continue
      seen.add(a.agentId)
      return a
    }
  }
  return null
}

function firstQueue(groupId: number | null): WorkspaceQueueCall | null {
  const list = groupId == null
    ? queueGroups.value.flatMap((g) => g.calls)
    : (queueGroups.value.find((g) => g.id === groupId)?.calls ?? [])
  return list[0] ?? null
}

async function onOpened() {
  selectedGroupId.value = null
  loading.value = true
  try {
    if (props.mode === 'snatch') {
      snatchGroups.value = isMedia.value ? await fetchMediaSnatchTargets() : await fetchSnatchTargets()
      const hit = snatchGroups.value.find((g) => g.agents.length > 0)
      if (hit) selectedGroupId.value = hit.id
    } else {
      queueGroups.value = isMedia.value ? await fetchMediaQueueSessions() : await fetchQueueCalls()
      const hit = queueGroups.value.find((g) => g.count > 0)
      if (hit) selectedGroupId.value = hit.id
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function pickSnatch(a: WorkspaceSnatchAgent) {
  if (submitting.value) return
  submitting.value = true
  try {
    if (isMedia.value) {
      const convId = a.conversationId || a.logicNo
      await snatchMediaSession(convId)
      ElMessage.success(`已抢接 ${a.workNo} 的会话`)
    } else {
      const ack = await agent.invokeAgent('DoAgentSnatchCall', {
        DstAgentID: a.agentId,
        CallID: a.logicNo || -1,
        CallIDType: 0,
      }) as Record<string, unknown>
      const rc = Number(ack.Status ?? ack.Result ?? ack.err ?? 0)
      if (rc !== 0) throw new Error(formatCcsAck(ack))
      ElMessage.success(`已抢接 ${a.workNo}`)
    }
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '抢接失败')
  } finally {
    submitting.value = false
  }
}

async function pickQueue(c: WorkspaceQueueCall) {
  if (submitting.value) return
  submitting.value = true
  try {
    if (isMedia.value) {
      await takeQueuedMediaSession(c.conversationId || c.logicNo)
      ElMessage.success('已接排队会话')
    } else {
      await takeQueuedCall(c.logicNo)
      ElMessage.success('已分配排队电话')
    }
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '分配失败')
  } finally {
    submitting.value = false
  }
}

function onGroupDblClick(g: WorkspaceSnatchGroup | WorkspaceQueueGroup) {
  selectedGroupId.value = g.id
  if (props.mode === 'snatch') {
    const a = firstSnatch(g.id)
    if (!a) {
      ElMessage.info(isMedia.value ? '该组无会话中坐席' : '该组无振铃坐席')
      return
    }
    void pickSnatch(a)
    return
  }
  const c = firstQueue(g.id)
  if (!c) {
    ElMessage.info(isMedia.value ? '该组无排队会话' : '该组无排队电话')
    return
  }
  void pickQueue(c)
}

function onConfirm() {
  if (props.mode === 'snatch') {
    const a = firstSnatch(selectedGroupId.value)
    if (!a) {
      ElMessage.info(isMedia.value ? '当前无会话中坐席' : '当前无振铃坐席')
      return
    }
    void pickSnatch(a)
    return
  }
  const c = firstQueue(selectedGroupId.value)
  if (!c) {
    ElMessage.info(isMedia.value ? '当前无排队会话' : '当前无排队电话')
    return
  }
  void pickQueue(c)
}
</script>

<style scoped>
.xfer-split {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 12px;
  min-height: 380px;
}
.xfer-pane {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.xfer-pane-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.xfer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: #0f172a;
  cursor: pointer;
  user-select: none;
}
.xfer-row:hover {
  background: #eff6ff;
}
.xfer-row.active {
  background: #dbeafe;
  font-weight: 600;
}
.xfer-meta {
  margin-left: auto;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 400;
}
.ws-call-row {
  flex-wrap: wrap;
}
.xfer-hint {
  float: left;
  color: #94a3b8;
  font-size: 12px;
  line-height: 32px;
}
</style>
