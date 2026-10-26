<template>
  <div class="agent-map-shell">
    <aside v-if="settingMode" class="map-settings">
      <div class="settings-title">区域管理</div>
      <div class="region-row">
        <el-select v-model="localConfig.active_region_id" size="small" @change="persist">
          <el-option v-for="region in localConfig.regions" :key="region.id" :label="region.name" :value="region.id" />
        </el-select>
        <el-button size="small" :icon="Plus" circle @click="addRegion" />
        <el-button size="small" :icon="Delete" circle :disabled="localConfig.regions.length <= 1" @click="removeRegion" />
      </div>
      <el-input v-model="activeRegion.name" size="small" maxlength="80" placeholder="区域名称" @change="persist" />

      <div class="settings-label">地图背景</div>
      <div class="background-actions">
        <el-upload :show-file-list="false" :auto-upload="false" accept="image/*" :on-change="onBackgroundChange">
          <el-button size="small">选择图片</el-button>
        </el-upload>
        <el-button size="small" :disabled="!activeRegion.background" @click="clearBackground">清除</el-button>
      </div>
      <p class="settings-hint">支持 JPG/PNG/WebP，单张不超过 1.5MB。</p>

      <div class="settings-title agent-tree-title">坐席管理</div>
      <el-tree :data="agentTree" node-key="id" default-expand-all :expand-on-click-node="false">
        <template #default="{ data }">
          <span
            class="agent-tree-node"
            :class="{ draggable: data.agent }"
            :draggable="Boolean(data.agent)"
            :role="data.agent ? 'button' : undefined"
            :tabindex="data.agent ? 0 : undefined"
            :aria-label="data.agent ? `拖动坐席 ${data.label} 到地图` : undefined"
            @dragstart="data.agent && beginAgentDrag($event, data.agent.agent_id)"
          >
            <span v-if="data.agent" class="status-dot" :class="`status-${data.agent.status}`" />
            <span>{{ data.label }}</span>
            <small v-if="data.agent">{{ data.agent.extension || '无分机' }}</small>
          </span>
        </template>
      </el-tree>
    </aside>

    <main class="map-workspace">
      <div class="map-region-tabs">
        <el-radio-group v-model="localConfig.active_region_id" size="small" @change="persist">
          <el-radio-button v-for="region in localConfig.regions" :key="region.id" :value="region.id">
            {{ region.name }}
          </el-radio-button>
        </el-radio-group>
        <span class="map-sync">{{ saving ? '正在保存…' : `状态刷新：${lastRefresh || '—'}` }}</span>
      </div>

      <div
        ref="canvasRef"
        class="map-canvas"
        :class="{ editing: settingMode }"
        :style="canvasStyle"
        @dragover.prevent
        @drop="onCanvasDrop"
      >
        <div v-if="!activeRegion.background" class="map-grid" />
        <div v-if="!activeRegion.placements.length" class="map-empty">
          {{ settingMode ? '从左侧拖动坐席到地图中' : '该区域尚未配置坐席' }}
        </div>

        <article
          v-for="placement in activeRegion.placements"
          :key="placement.agent_id"
          class="agent-portrait"
          :class="[`portrait-${agentFor(placement.agent_id).status}`, { movable: settingMode }]"
          :style="{ left: `${placement.x}%`, top: `${placement.y}%` }"
          :draggable="settingMode"
          @dragstart="beginAgentDrag($event, placement.agent_id)"
        >
          <button v-if="settingMode" class="portrait-remove" title="从地图移除" @click="removeAgent(placement.agent_id)">×</button>
          <div class="portrait-head">
            <span class="portrait-avatar"><el-icon><UserFilled /></el-icon></span>
            <div>
              <strong>{{ agentFor(placement.agent_id).name }}</strong>
              <span class="portrait-status">{{ statusText(agentFor(placement.agent_id).status) }}</span>
            </div>
          </div>
          <dl>
            <div><dt>工号</dt><dd>{{ agentFor(placement.agent_id).work_no || placement.agent_id }}</dd></div>
            <div><dt>分机</dt><dd>{{ agentFor(placement.agent_id).extension || '—' }}</dd></div>
            <div><dt>来电</dt><dd>{{ agentFor(placement.agent_id).current_call || '—' }}</dd></div>
            <div><dt>多媒体</dt><dd>{{ mediaText(agentFor(placement.agent_id).media_status?.multimedia) }}</dd></div>
          </dl>
        </article>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Delete, Plus, UserFilled } from '@element-plus/icons-vue'
import { ElMessage, type UploadFile } from 'element-plus'
import {
  fetchMonitorMapConfig,
  saveMonitorMapConfig,
  type AgentStatusRow,
  type MonitorMapConfig,
  type MonitorMapPlacement,
} from '@/api/monitor'

const props = defineProps<{
  agents: AgentStatusRow[]
  settingMode: boolean
  lastRefresh: string
}>()

const canvasRef = ref<HTMLElement | null>(null)
const saving = ref(false)
let persistRunning = false
let persistQueued = false
const draggedAgentId = ref('')
const knownAgents = ref<Record<string, AgentStatusRow>>({})
const localConfig = ref<MonitorMapConfig>({
  version: 1,
  active_region_id: 'default',
  regions: [{ id: 'default', name: '默认区域', background: '', placements: [] }],
})

watch(
  () => props.agents,
  (rows) => {
    const onlineIds = new Set(rows.map((agent) => agent.agent_id))
    for (const [id, agent] of Object.entries(knownAgents.value)) {
      if (!onlineIds.has(id)) knownAgents.value[id] = { ...agent, status: 'offline', current_call: undefined }
    }
    for (const agent of rows) knownAgents.value[agent.agent_id] = agent
  },
  { immediate: true, deep: true },
)

const activeRegion = computed(() => {
  return localConfig.value.regions.find((region) => region.id === localConfig.value.active_region_id)
    || localConfig.value.regions[0]
})

const agentTree = computed(() => {
  const groups = new Map<string, AgentStatusRow[]>()
  for (const agent of Object.values(knownAgents.value)) {
    const team = agent.team || '未分组'
    groups.set(team, [...(groups.get(team) || []), agent])
  }
  return [...groups.entries()].map(([team, agents]) => ({
    id: `team:${team}`,
    label: `${team}（${agents.length}）`,
    children: agents.map((agent) => ({
      id: `agent:${agent.agent_id}`,
      label: `${agent.name} · ${agent.work_no || agent.agent_id}`,
      agent,
    })),
  }))
})

const canvasStyle = computed(() => ({
  backgroundImage: activeRegion.value.background ? `url("${activeRegion.value.background}")` : 'none',
}))

function agentFor(agentId: string): AgentStatusRow {
  return knownAgents.value[agentId] || {
    user_id: 0,
    agent_id: agentId,
    work_no: agentId,
    extension: '',
    name: `坐席 ${agentId}`,
    team: '未分组',
    status: 'offline',
    media_status: { voice: 'offline', multimedia: 'offline' },
    duration_sec: 0,
    handled_today: 0,
  }
}

function statusText(status: string) {
  return ({ ready: '就绪', busy: '通话中', break: '小休', offline: '离线' } as Record<string, string>)[status] || status
}

function mediaText(status?: string) {
  return ({ ready: '在线', busy: '会话中', offline: '离线' } as Record<string, string>)[status || 'offline'] || status || '离线'
}

function beginAgentDrag(event: DragEvent, agentId: string) {
  if (!props.settingMode) return
  draggedAgentId.value = agentId
  event.dataTransfer?.setData('text/plain', agentId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onCanvasDrop(event: DragEvent) {
  if (!props.settingMode || !canvasRef.value) return
  const agentId = event.dataTransfer?.getData('text/plain') || draggedAgentId.value
  if (!agentId) return
  const rect = canvasRef.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(92, ((event.clientX - rect.left) / rect.width) * 100))
  const y = Math.max(0, Math.min(88, ((event.clientY - rect.top) / rect.height) * 100))
  const existing = activeRegion.value.placements.find((item) => item.agent_id === agentId)
  if (existing) {
    existing.x = x
    existing.y = y
  } else {
    activeRegion.value.placements.push({ agent_id: agentId, x, y } satisfies MonitorMapPlacement)
  }
  void persist()
}

function removeAgent(agentId: string) {
  activeRegion.value.placements = activeRegion.value.placements.filter((item) => item.agent_id !== agentId)
  void persist()
}

function addRegion() {
  const id = `region-${Date.now()}`
  localConfig.value.regions.push({ id, name: `区域 ${localConfig.value.regions.length + 1}`, background: '', placements: [] })
  localConfig.value.active_region_id = id
  void persist()
}

function removeRegion() {
  if (localConfig.value.regions.length <= 1) return
  localConfig.value.regions = localConfig.value.regions.filter((region) => region.id !== activeRegion.value.id)
  localConfig.value.active_region_id = localConfig.value.regions[0].id
  void persist()
}

function clearBackground() {
  activeRegion.value.background = ''
  void persist()
}

function onBackgroundChange(file: UploadFile) {
  const raw = file.raw
  if (!raw || raw.size > 1.5 * 1024 * 1024) {
    ElMessage.warning('背景图片不能超过 1.5MB')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const dataUri = String(reader.result || '')
    if (dataUri.length > 2_250_000) {
      ElMessage.warning('图片编码后超出限制，请选择更小的图片')
      return
    }
    activeRegion.value.background = dataUri
    void persist()
  }
  reader.readAsDataURL(raw)
}

async function persist() {
  persistQueued = true
  if (persistRunning) return
  persistRunning = true
  saving.value = true
  try {
    while (persistQueued) {
      persistQueued = false
      const snapshot = structuredClone(localConfig.value)
      const saved = await saveMonitorMapConfig(snapshot)
      // 编辑期间又有变更时不能用旧响应覆盖本地状态；下一轮会保存最新快照。
      if (!persistQueued) localConfig.value = saved
    }
  } finally {
    persistRunning = false
    saving.value = false
  }
}

onMounted(async () => {
  localConfig.value = await fetchMonitorMapConfig()
})
</script>

<style scoped>
.agent-map-shell { display: flex; gap: 12px; min-height: 620px; }
.map-settings { width: 260px; flex: 0 0 260px; padding: 14px; border: 1px solid #dcdfe6; border-radius: 8px; background: #fff; overflow: auto; }
.settings-title { margin-bottom: 10px; font-size: 14px; font-weight: 700; color: #303133; }
.agent-tree-title { margin-top: 22px; padding-top: 16px; border-top: 1px solid #ebeef5; }
.region-row, .background-actions { display: flex; gap: 6px; margin-bottom: 8px; }
.region-row .el-select { flex: 1; }
.settings-label { margin: 16px 0 8px; font-size: 13px; color: #606266; }
.settings-hint { margin: 6px 0; color: #909399; font-size: 11px; }
.agent-tree-node { display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; }
.agent-tree-node.draggable { cursor: grab; }
.agent-tree-node small { margin-left: auto; color: #909399; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #909399; }
.status-ready { background: #67c23a; }
.status-busy { background: #f56c6c; }
.status-break { background: #e6a23c; }
.map-workspace { min-width: 0; flex: 1; }
.map-region-tabs { display: flex; align-items: center; justify-content: space-between; min-height: 34px; margin-bottom: 8px; }
.map-sync { color: #909399; font-size: 12px; }
.map-canvas { position: relative; min-height: 570px; overflow: hidden; border: 1px solid #dcdfe6; border-radius: 10px; background: #eef2f7 center/cover no-repeat; }
.map-canvas.editing { border-color: #409eff; box-shadow: inset 0 0 0 1px #409eff; }
.map-grid { position: absolute; inset: 0; opacity: .5; background-image: linear-gradient(#d8dee9 1px, transparent 1px), linear-gradient(90deg, #d8dee9 1px, transparent 1px); background-size: 32px 32px; }
.map-empty { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); color: #909399; font-size: 14px; }
.agent-portrait { position: absolute; z-index: 2; width: 190px; padding: 10px; transform: translate(-10%, -10%); border: 2px solid #909399; border-radius: 10px; background: rgba(255,255,255,.94); box-shadow: 0 5px 18px rgba(31,45,61,.16); }
.agent-portrait.movable { cursor: move; }
.portrait-ready { border-color: #67c23a; }
.portrait-busy { border-color: #f56c6c; }
.portrait-break { border-color: #e6a23c; }
.portrait-offline { opacity: .68; filter: grayscale(.5); }
.portrait-remove { position: absolute; right: -7px; top: -8px; width: 20px; height: 20px; border: 0; border-radius: 50%; color: #fff; background: #f56c6c; cursor: pointer; }
.portrait-head { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }
.portrait-avatar { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; color: #fff; background: #606266; font-size: 20px; }
.portrait-head strong, .portrait-status { display: block; }
.portrait-head strong { color: #303133; font-size: 13px; }
.portrait-status { margin-top: 2px; color: #909399; font-size: 11px; }
dl { margin: 0; font-size: 11px; }
dl div { display: grid; grid-template-columns: 48px 1fr; line-height: 1.6; }
dt { color: #909399; }
dd { margin: 0; overflow: hidden; color: #303133; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 680px) {
  .agent-map-shell { flex-direction: column; }
  .map-settings { width: auto; flex-basis: auto; }
  .map-canvas { min-height: 520px; }
}
</style>
