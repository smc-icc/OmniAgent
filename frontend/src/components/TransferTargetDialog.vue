<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="640px"
    append-to-body
    destroy-on-close
    class="xfer-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    @opened="onOpened"
  >
    <!-- 组 → 技能 -->
    <div v-if="mode === 'skill'" class="xfer-split">
      <div class="xfer-pane">
        <div class="xfer-pane-hd">技能组</div>
        <el-scrollbar max-height="360px">
          <div
            v-for="g in groups"
            :key="g.id"
            class="xfer-row"
            :class="{ active: selectedGroupId === g.id }"
            @click="selectedGroupId = g.id"
          >
            {{ g.name }}
          </div>
        </el-scrollbar>
      </div>
      <div class="xfer-pane">
        <div class="xfer-pane-hd">技能（双击转移）</div>
        <el-scrollbar max-height="360px">
          <div
            v-for="s in currentSkills"
            :key="`${selectedGroupId}-${s.id}`"
            class="xfer-row"
            @dblclick="pickSkill(s)"
          >
            {{ s.name }}
          </div>
          <el-empty v-if="!currentSkills.length" description="请先选组" :image-size="64" />
        </el-scrollbar>
      </div>
    </div>

    <!-- 组 → 坐席 -->
    <div v-else-if="mode === 'agent' || mode === 'consult'" class="xfer-agent-wrap">
      <div v-if="mode === 'agent' && !hideCallModes" class="xfer-agent-mode">
        <el-radio-group v-model="agentMode" size="small">
          <el-radio-button label="hold">保持转</el-radio-button>
          <el-radio-button label="release">释放转</el-radio-button>
        </el-radio-group>
        <span class="xfer-agent-mode-hint">{{
          agentMode === 'hold'
            ? '本席保持客户；对方不接/超时则自动找回'
            : '盲转：对方接通后本席释放（不接则本席也不再自动接回）'
        }}</span>
      </div>
      <div class="xfer-split">
      <div class="xfer-pane">
        <div class="xfer-pane-hd">技能组</div>
        <el-scrollbar max-height="360px">
          <div
            v-for="g in groups"
            :key="g.id"
            class="xfer-row"
            :class="{ active: selectedGroupId === g.id }"
            @click="onSelectGroupForAgent(g.id)"
          >
            {{ g.name }}
          </div>
        </el-scrollbar>
      </div>
      <div class="xfer-pane">
        <div class="xfer-pane-hd">
          坐席（双击转移）
          <el-input
            v-model="agentSearch"
            size="small"
            clearable
            placeholder="工号/姓名"
            style="width: 140px; margin-left: auto"
            @input="debouncedLoadAgents"
          />
        </div>
        <el-scrollbar v-loading="agentsLoading" max-height="320px">
          <div
            v-for="a in agents"
            :key="a.workNo"
            class="xfer-row"
            @dblclick="pickAgent(a)"
          >
            <strong>{{ a.workNo }}</strong>
            <span class="xfer-meta">{{ a.name }}</span>
          </div>
          <el-empty v-if="!agentsLoading && !agents.length" description="无坐席" :image-size="64" />
        </el-scrollbar>
      </div>
      </div>
    </div>

    <!-- IVR 流程（VDN 下扁平树：根→流程节点） -->
    <div v-else-if="mode === 'ivr'" class="xfer-ivr">
      <div v-if="!hideCallModes" class="xfer-agent-mode">
        <el-radio-group v-model="ivrMode" size="small">
          <el-radio-button label="hold">保持转IVR</el-radio-button>
          <el-radio-button label="release">释放转IVR</el-radio-button>
        </el-radio-group>
        <span class="xfer-agent-mode-hint">{{
          ivrMode === 'hold'
            ? '本席保持；客户进 IVR，可取回'
            : '客户进 IVR 后本席释放为空闲'
        }}</span>
      </div>
      <div class="xfer-pane-hd">IVR 流程（双击转移）</div>
      <el-scrollbar max-height="320px">
        <div class="xfer-tree-root">IVR</div>
        <div
          v-for="f in ivrFlows"
          :key="f.id"
          class="xfer-row xfer-row-indent"
          @dblclick="pickIvr(f)"
        >
          {{ f.name }}
          <span class="xfer-meta">Flow {{ f.flowId }} · Node {{ f.nodeId }}</span>
        </div>
        <el-empty v-if="!ivrFlows.length" description="当前 VDN 无 IVR 流程" :image-size="72" />
      </el-scrollbar>
    </div>

    <!-- 外线拨号盘：类型由菜单决定，标题即类型，不再用 Tab 切换 -->
    <div v-else-if="mode === 'out'" class="xfer-out">
      <p class="xfer-agent-mode-hint">{{
        outMode === 'consult'
          ? '客户保持；本席先与外线通话，挂机后客户接到外线'
          : outMode === 'hold'
            ? '客户保持并转到外线，本席可取回'
            : '客户转到外线后本席释放为空闲'
      }}</p>
      <SoftDialPad v-model="outNumber" />
      <div class="xfer-out-actions">
        <el-button @click="emit('update:modelValue', false)">取消</el-button>
        <el-button type="primary" :disabled="!outNumber.trim()" :loading="submitting" @click="pickOut">
          确定
        </el-button>
      </div>
    </div>

    <template v-if="mode !== 'out'" #footer>
      <span class="xfer-hint">双击列表项执行转移</span>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import SoftDialPad from '@/components/SoftDialPad.vue'
import {
  fetchTransferAgents,
  fetchTransferCatalog,
  type TransferAgent,
  type TransferGroup,
  type TransferIvrFlow,
  type TransferSkill,
} from '@/api/transfer'

export type TransferDialogMode = 'skill' | 'agent' | 'consult' | 'ivr' | 'out'

const props = defineProps<{
  modelValue: boolean
  mode: TransferDialogMode
  /** 外线默认：hold | release | consult（由菜单项决定初始值） */
  outDefault?: 'hold' | 'release' | 'consult'
  /** 转坐席默认：hold=AutoRetrieveCall1 | release=2（由菜单项决定初始值） */
  agentDefault?: 'hold' | 'release'
  /** 转 IVR 默认：hold=TransferType1 | release=0 */
  ivrDefault?: 'hold' | 'release'
  /** 多媒体会话：隐藏话务保持/释放选项 */
  hideCallModes?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [payload: Record<string, unknown>]
}>()

const loading = ref(false)
const submitting = ref(false)
const groups = ref<TransferGroup[]>([])
const ivrFlows = ref<TransferIvrFlow[]>([])
const selectedGroupId = ref<number | null>(null)
const agents = ref<TransferAgent[]>([])
const agentsLoading = ref(false)
const agentSearch = ref('')
const outNumber = ref('')
const outMode = ref<'hold' | 'release' | 'consult'>('hold')
const agentMode = ref<'hold' | 'release'>('release')
const ivrMode = ref<'hold' | 'release'>('hold')

let agentSearchTimer: ReturnType<typeof setTimeout> | null = null

const title = computed(() => {
  if (props.hideCallModes) {
    if (props.mode === 'agent') return '转移至坐席'
    if (props.mode === 'consult') return '邀请坐席'
    if (props.mode === 'ivr') return '转移至ITR'
  }
  if (props.mode === 'agent') {
    return agentMode.value === 'hold' ? '保持转坐席' : '释放转坐席'
  }
  if (props.mode === 'ivr') {
    return ivrMode.value === 'hold' ? '保持转IVR' : '释放转IVR'
  }
  if (props.mode === 'out') {
    if (outMode.value === 'consult') return '咨询转外线'
    return outMode.value === 'hold' ? '保持转外线' : '释放转外线'
  }
  const map: Record<TransferDialogMode, string> = {
    skill: '转移至技能',
    agent: '转移至坐席',
    consult: '咨询转坐席',
    ivr: '保持转IVR',
    out: '保持转外线',
  }
  return map[props.mode]
})

const currentSkills = computed(() => {
  const g = groups.value.find((x) => x.id === selectedGroupId.value)
  return g?.skills ?? []
})

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      outMode.value =
        props.outDefault === 'release'
          ? 'release'
          : props.outDefault === 'consult'
            ? 'consult'
            : 'hold'
      agentMode.value = props.agentDefault === 'hold' ? 'hold' : 'release'
      ivrMode.value = props.ivrDefault === 'release' ? 'release' : 'hold'
      outNumber.value = ''
    }
  },
)

async function onOpened() {
  if (props.mode === 'out') return
  loading.value = true
  try {
    const data = await fetchTransferCatalog(
      props.mode === 'agent' || props.mode === 'consult' || props.mode === 'skill'
        ? props.mode
        : undefined,
    )
    groups.value = data.groups || []
    ivrFlows.value = data.ivr_flows || []
    selectedGroupId.value = groups.value[0]?.id ?? null
    if ((props.mode === 'agent' || props.mode === 'consult') && selectedGroupId.value) {
      await loadAgents()
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载转移目录失败')
  } finally {
    loading.value = false
  }
}

async function onSelectGroupForAgent(id: number) {
  selectedGroupId.value = id
  await loadAgents()
}

async function loadAgents() {
  if (!selectedGroupId.value) {
    agents.value = []
    return
  }
  agentsLoading.value = true
  try {
    const data = await fetchTransferAgents(selectedGroupId.value, agentSearch.value)
    agents.value = data.agents || []
  } catch (e) {
    agents.value = []
    ElMessage.error(e instanceof Error ? e.message : '加载坐席失败')
  } finally {
    agentsLoading.value = false
  }
}

function debouncedLoadAgents() {
  if (agentSearchTimer) clearTimeout(agentSearchTimer)
  agentSearchTimer = setTimeout(() => {
    void loadAgents()
  }, 280)
}

function pickSkill(s: TransferSkill) {
  if (!selectedGroupId.value) return
  emit('confirm', {
    kind: 'skill',
    AgentGroup: selectedGroupId.value,
    SkillID: s.id,
  })
  emit('update:modelValue', false)
}

function pickAgent(a: TransferAgent) {
  // Focus EU_CCS_TransferAgentTye：
  // 0=协商/手动找回  1=保持转（拒接自动找回）  2=释放/盲转（旧逻辑）
  let autoRetrieve = 2
  if (props.mode === 'consult') autoRetrieve = 0
  else if (agentMode.value === 'hold') autoRetrieve = 1
  emit('confirm', {
    kind: props.mode === 'consult' ? 'consult' : 'agent',
    WorkNO: a.workNo,
    AgentGroupID: a.groupId || selectedGroupId.value || 0,
    AutoRetrieveCall: autoRetrieve,
  })
  emit('update:modelValue', false)
}

function pickIvr(flow: TransferIvrFlow) {
  // Focus EU_CCS_TransferType：0=释放转 1=保持转
  emit('confirm', {
    kind: 'ivr',
    FlowID: flow.flowId,
    NodeID: flow.nodeId,
    TransferType: ivrMode.value === 'hold' ? 1 : 0,
  })
  emit('update:modelValue', false)
}

function pickOut() {
  const num = outNumber.value.trim()
  if (!num) return
  submitting.value = true
  try {
    emit('confirm', {
      kind: 'out',
      szPhoneNO: num,
      TransferType: outMode.value === 'consult' ? 2 : outMode.value === 'hold' ? 1 : 0,
    })
    emit('update:modelValue', false)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.xfer-agent-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.xfer-agent-mode {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.xfer-agent-mode-hint {
  font-size: 12px;
  color: #64748b;
}
.xfer-split {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
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
.xfer-ivr {
  min-height: 320px;
}
.xfer-tree-root {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}
.xfer-row-indent {
  padding-left: 28px;
}
.xfer-out {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.xfer-out-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.xfer-hint {
  float: left;
  color: #94a3b8;
  font-size: 12px;
  line-height: 32px;
}
</style>
