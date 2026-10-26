<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="720px"
    append-to-body
    destroy-on-close
    class="ws-pick-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    @opened="onOpened"
  >
    <div v-if="kind === 'conference'" class="ws-conf-bar">
      <el-radio-group v-if="!inviteOnly" v-model="confTab" size="small">
        <el-radio-button label="create">{{ channel === 'media' ? '邀请座席' : '创建会议' }}</el-radio-button>
        <el-radio-button label="invite">邀请入会</el-radio-button>
        <el-radio-button label="kick">踢出成员</el-radio-button>
        <el-radio-button label="mode">会议模式</el-radio-button>
      </el-radio-group>
      <template v-if="channel !== 'media' && (confTab === 'create' || confTab === 'invite')">
        <el-radio-group v-model="targetKind" size="small">
          <el-radio-button label="agent">呼坐席</el-radio-button>
          <el-radio-button label="external">外线</el-radio-button>
        </el-radio-group>
      </template>
      <el-input-number
        v-if="channel !== 'media' && confTab === 'create'"
        v-model="confSize"
        :min="3"
        :max="32"
        size="small"
        controls-position="right"
      />
      <el-input
        v-if="channel !== 'media' && (confTab === 'create' || confTab === 'invite') && targetKind === 'external'"
        v-model="phoneNo"
        size="small"
        placeholder="外线号码"
        style="width: 160px"
      />
      <el-radio-group v-if="confTab === 'mode'" v-model="confMode" size="small">
        <el-radio-button :label="0">听说</el-radio-button>
        <el-radio-button :label="1">只听</el-radio-button>
      </el-radio-group>
    </div>

    <div v-if="showForceMode" class="ws-conf-bar">
      <span class="ws-force-mode-label">模式</span>
      <el-radio-group v-model="forceMediaMode" size="small">
        <el-radio-button label="media">多媒体</el-radio-button>
        <el-radio-button v-if="voiceEnabled" label="phone">电话</el-radio-button>
        <el-radio-button v-if="voiceEnabled" label="both">两者都</el-radio-button>
      </el-radio-group>
    </div>

    <div v-if="showPicker" class="xfer-split">
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
            <span class="xfer-meta">{{ filteredInGroup(g).length }}</span>
          </div>
          <el-empty v-if="!loading && !groups.length" description="请先签入技能组" :image-size="64" />
        </el-scrollbar>
      </div>
      <div class="xfer-pane">
        <div class="xfer-pane-hd">{{ listTitle }}</div>
        <el-scrollbar v-loading="loading" max-height="360px">
          <div
            v-for="a in currentAgents"
            :key="a.agentId"
            class="xfer-row"
            :class="{ active: isSelected(a) }"
            @click="onRowClick(a)"
            @dblclick="onRowDblClick(a)"
          >
            <el-checkbox
              v-if="multi"
              :model-value="isSelected(a)"
              @click.stop
              @change="toggle(a)"
            />
            <strong>{{ a.workNo }}</strong>
            <span>{{ a.name }}</span>
            <span class="xfer-meta">{{ a.extension ? `${a.extension} · ${statusLabel(a.status)}` : statusLabel(a.status) }}</span>
          </div>
          <el-empty
            v-if="!loading && selectedGroupId && !currentAgents.length"
            :description="emptyGroupHint"
            :image-size="64"
          />
          <el-empty
            v-if="!loading && !selectedGroupId && groups.length"
            description="请选择技能组，或直接点确定"
            :image-size="64"
          />
        </el-scrollbar>
      </div>
    </div>
    <el-empty
      v-else-if="kind === 'conference' && confTab === 'mode'"
      description="点确定切换本席会议模式（听说/只听）"
      :image-size="80"
    />

    <template #footer>
      <span class="xfer-hint">{{ footerHint }}</span>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAgentStore } from '@/stores/agent'
import { useProductModulesStore } from '@/stores/product-modules'
import { ccsAckCode, formatCcsAck, formatCcsThrown } from '@/utils/ccs-errors'
import { CCS_OFFER, isSupervisorOffer } from '@/types/agent-ccs'
import {
  fetchMediaOnlineAgents,
  fetchOnlineAgents,
  mediaConference,
  mediaImsForce,
  mediaMonitor,
  type ForceMediaMode,
  type WorkspaceOnlineAgent,
  type WorkspaceOnlineGroup,
} from '@/api/workspace'

export type AgentPickKind = 'call_agent' | 'conference' | 'monitor' | 'im'
export type ConfTab = 'create' | 'invite' | 'kick' | 'mode'
export type MonitorAction =
  | 'barge'
  | 'intercept'
  | 'listen'
  | 'force_hangup'
  | 'force_logout'
  | 'force_busy'
  | 'force_idle'
  | 'force_block'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    kind: AgentPickKind
    monitorAction?: MonitorAction
    initialTab?: ConfTab
    inviteOnly?: boolean
    initialTarget?: 'agent' | 'external'
    channel?: 'media' | 'phone'
    conversationId?: number | null
  }>(),
  { channel: 'phone', conversationId: null },
)

const emit = defineEmits<{
  'update:modelValue': [boolean]
  picked: [WorkspaceOnlineAgent]
}>()

const agent = useAgentStore()
const loading = ref(false)
const submitting = ref(false)
const selectedGroupId = ref<number | null>(null)
const groups = ref<WorkspaceOnlineGroup[]>([])
const selectedIds = ref<number[]>([])
const confTab = ref<'create' | 'invite' | 'kick' | 'mode'>('create')
const targetKind = ref<'agent' | 'external'>('agent')
const confSize = ref(8)
const phoneNo = ref('')
const confMode = ref(0)
const productModules = useProductModulesStore()
const voiceEnabled = computed(() => productModules.enabled('icc'))
const forceMediaMode = ref<ForceMediaMode>('media')
const isMedia = computed(() => props.channel === 'media')

const showForceMode = computed(() => {
  if (props.kind !== 'monitor') return false
  return ['force_idle', 'force_busy', 'force_block'].includes(props.monitorAction ?? '')
})

const talkingFilter = computed(() => {
  if (props.kind !== 'monitor') return false
  return ['barge', 'intercept', 'listen', 'force_hangup'].includes(props.monitorAction ?? '')
})

const multi = computed(() => {
  if (props.kind === 'monitor' && props.monitorAction === 'force_block') return true
  if (props.kind === 'conference' && (confTab.value === 'invite' || confTab.value === 'kick')) return true
  return false
})

const showPicker = computed(() => {
  if (props.kind !== 'conference') return true
  if (confTab.value === 'mode') return false
  if (!isMedia.value && (confTab.value === 'create' || confTab.value === 'invite') && targetKind.value === 'external') return false
  return true
})

const dialogTitle = computed(() => {
  if (props.kind === 'call_agent') return isMedia.value ? '联系坐席' : '呼叫坐席'
  if (props.kind === 'im') return '联系坐席'
  if (props.kind === 'conference') return props.inviteOnly ? '邀请入会' : '会议管理'
  const labels: Record<string, string> = {
    barge: '强插',
    intercept: '拦截',
    listen: '监听',
    force_hangup: isMedia.value ? '强制结束' : '强制挂机',
    force_logout: '强制注销',
    force_busy: '强制示忙',
    force_idle: '强制示闲',
    force_block: '强制闭塞',
  }
  return `监控 · ${labels[props.monitorAction ?? ''] ?? '选坐席'}`
})

const listTitle = computed(() => {
  if (talkingFilter.value) return isMedia.value ? '会话中坐席（双击执行）' : '通话中坐席（双击执行）'
  return '在线坐席（双击执行）'
})

const emptyGroupHint = computed(() => {
  if (talkingFilter.value) return isMedia.value ? '该组无全媒体会话' : '该组无通话中坐席'
  return '该组无在线坐席'
})

const footerHint = computed(() => {
  if (props.kind === 'conference' && (confTab.value === 'create' || confTab.value === 'invite') && targetKind.value === 'external') {
    return '填写外线号码后点确定'
  }
  if (multi.value) return '可多选，点确定执行'
  return '双击坐席立即执行；已选组点确定=该组第一人'
})

function statusLabel(status: number) {
  if (status & 0x0100) return '通话'
  if (status & 0x0200) return '保持'
  if (status & 0x80) return '呼出'
  if (status & 0x40) return '占用'
  if (status & 0x08) return '闭塞'
  if (status & 0x02) return '示忙'
  if (status & 0x04) return '小休'
  if (status & 0x0400) return '文书'
  if (status & 0x20) return '空闲'
  return `状态${status}`
}

function isInCall(a: WorkspaceOnlineAgent) {
  if (isMedia.value) return !!a.mediaConversationId
  const status = a.status
  return !!(status & 0x0100) || !!(status & 0x0200) || !!(status & 0x80)
}

function filteredInGroup(g: WorkspaceOnlineGroup) {
  const list = g.agents ?? []
  if (!talkingFilter.value) return list
  return list.filter((a) => isInCall(a))
}

const currentAgents = computed(() => {
  if (selectedGroupId.value == null) return []
  const g = groups.value.find((x) => x.id === selectedGroupId.value)
  return g ? filteredInGroup(g) : []
})

function isSelected(a: WorkspaceOnlineAgent) {
  return selectedIds.value.includes(a.agentId)
}

function toggle(a: WorkspaceOnlineAgent) {
  if (isSelected(a)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== a.agentId)
    return
  }
  selectedIds.value = [...selectedIds.value, a.agentId]
}

function onRowClick(a: WorkspaceOnlineAgent) {
  if (multi.value) {
    toggle(a)
    return
  }
  selectedIds.value = [a.agentId]
}

function firstAgent(groupId: number | null): WorkspaceOnlineAgent | null {
  if (groupId != null) {
    const g = groups.value.find((x) => x.id === groupId)
    return g ? (filteredInGroup(g)[0] ?? null) : null
  }
  const seen = new Set<number>()
  for (const g of groups.value) {
    for (const a of filteredInGroup(g)) {
      if (seen.has(a.agentId)) continue
      seen.add(a.agentId)
      return a
    }
  }
  return null
}

function findAgent(id: number) {
  for (const g of groups.value) {
    const a = g.agents.find((x) => x.agentId === id)
    if (a) return a
  }
  return null
}

async function onOpened() {
  selectedGroupId.value = null
  selectedIds.value = []
  confTab.value = props.inviteOnly ? 'invite' : (props.initialTab ?? 'create')
  targetKind.value = props.initialTarget ?? 'agent'
  phoneNo.value = ''
  confSize.value = 8
  confMode.value = 0
  forceMediaMode.value = voiceEnabled.value ? 'both' : 'media'
  if (isMedia.value) targetKind.value = 'agent'
  loading.value = true
  try {
    groups.value = isMedia.value ? await fetchMediaOnlineAgents() : await fetchOnlineAgents()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function invokeAck(method: string, payload: Record<string, unknown>, okMsg: string) {
  if (submitting.value) return false
  submitting.value = true
  const supervisor = isSupervisorOffer(Number(agent.currentCall?.CallOfferedType ?? 0))
  try {
    const ack = (await agent.invokeAgent(method, payload)) as Record<string, unknown>
    if (ccsAckCode(ack) !== 0) throw new Error(formatCcsAck(ack))
    if (supervisor) agent.confirmSupervisorConnected()
    ElMessage.success(okMsg)
    emit('update:modelValue', false)
    return true
  } catch (e) {
    if (supervisor) agent.clearCallUi()
    ElMessage.error(formatCcsThrown(e))
    return false
  } finally {
    submitting.value = false
  }
}

async function pickCallAgent(a: WorkspaceOnlineAgent) {
  if (submitting.value) return
  submitting.value = true
  try {
    await agent.callAgent(a)
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    submitting.value = false
  }
}

async function applyForceStatus(agentIds: number[], act: MonitorAction, okMsg: string) {
  const key =
    act === 'force_idle' ? 'idle'
    : act === 'force_busy' ? 'busy'
    : act === 'force_block' ? 'block'
    : act === 'force_logout' ? 'logout'
    : null
  if (!key) return false
  const mode: ForceMediaMode = act === 'force_logout'
    ? (isMedia.value ? 'media' : 'phone')
    : (voiceEnabled.value ? forceMediaMode.value : 'media')
  if (submitting.value) return false
  submitting.value = true
  const errors: string[] = []
  try {
    if (mode === 'media' || mode === 'both') {
      try {
        await mediaImsForce({ action: key, agentIds })
      } catch (e) {
        errors.push(`多媒体：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (mode === 'phone' || mode === 'both') {
      try {
        if (act === 'force_block') {
          const ack = (await agent.invokeAgent('DoAgentForceBlock', {
            DstAgentID: agentIds,
            DstAgentIDCount: agentIds.length,
          })) as Record<string, unknown>
          if (ccsAckCode(ack) !== 0) throw new Error(formatCcsAck(ack))
        } else {
          const method =
            act === 'force_idle' ? 'DoAgentForceIdle'
            : act === 'force_busy' ? 'DoAgentForceBusy'
            : 'DoAgentForceLogOut'
          for (const id of agentIds) {
            const ack = (await agent.invokeAgent(method, { DstAgentID: id })) as Record<string, unknown>
            if (ccsAckCode(ack) !== 0) throw new Error(formatCcsAck(ack))
          }
        }
      } catch (e) {
        errors.push(`电话：${formatCcsThrown(e)}`)
      }
    }
    if (errors.length === 0) {
      ElMessage.success(okMsg)
      emit('update:modelValue', false)
      return true
    }
    if (mode === 'both' && errors.length === 1) {
      ElMessage.warning(`${okMsg}（部分失败）${errors[0]}`)
      emit('update:modelValue', false)
      return false
    }
    ElMessage.error(errors.join('；'))
    return false
  } finally {
    submitting.value = false
  }
}

async function pickMonitor(a: WorkspaceOnlineAgent) {
  const act = props.monitorAction
  if (!act) return
  if (act === 'force_idle' || act === 'force_busy' || act === 'force_block' || act === 'force_logout') {
    const label =
      act === 'force_idle' ? '示闲'
      : act === 'force_busy' ? '示忙'
      : act === 'force_block' ? '闭塞'
      : '注销'
    await applyForceStatus([a.agentId], act, `已强制${label} ${a.workNo}`)
    return
  }
  if (isMedia.value) {
    if (submitting.value) return
    submitting.value = true
    try {
      const action = act === 'force_hangup' ? 'end' : act
      await mediaMonitor({
        action: action as 'barge' | 'listen' | 'intercept' | 'end',
        agentId: a.agentId,
        conversationId: a.mediaConversationId,
      })
      const msg =
        act === 'barge' ? `已强插 ${a.workNo} 的会话`
        : act === 'listen' ? `已监听 ${a.workNo} 的会话`
        : act === 'intercept' ? `已拦截 ${a.workNo} 的会话`
        : `已强制结束 ${a.workNo} 的会话`
      ElMessage.success(msg)
      emit('update:modelValue', false)
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '监控操作失败')
    } finally {
      submitting.value = false
    }
    return
  }
  const offerType =
    act === 'barge' ? CCS_OFFER.Insert : act === 'listen' ? CCS_OFFER.Monitor : act === 'intercept' ? CCS_OFFER.Intercept : 0
  if (offerType) {
    agent.beginSupervisorSession({
      offeredType: offerType,
      workNo: a.workNo,
      name: a.name,
    })
  }
  if (act === 'barge') {
    await invokeAck('DoAgentForceInsert', { DstWorkNO: a.workNo }, `已强插 ${a.workNo}`)
    return
  }
  if (act === 'listen') {
    await invokeAck('DoAgentMonitor', { DstWorkNO: a.workNo }, `已监听 ${a.workNo}`)
    return
  }
  if (act === 'force_hangup') {
    await invokeAck('DoAgentForceRelease', { DstWorkNO: a.workNo }, `已强制挂机 ${a.workNo}`)
    return
  }
  if (act === 'intercept') {
    await invokeAck('DoAgentIntercept', { DstAgentID: a.agentId }, `已拦截 ${a.workNo}`)
  }
}

async function pickIm(a: WorkspaceOnlineAgent) {
  emit('picked', a)
  emit('update:modelValue', false)
}

function onRowDblClick(a: WorkspaceOnlineAgent) {
  if (props.kind === 'call_agent') {
    void pickCallAgent(a)
    return
  }
  if (props.kind === 'im') {
    void pickIm(a)
    return
  }
  if (props.kind === 'monitor') {
    void pickMonitor(a)
    return
  }
  onRowClick(a)
  void onConfirm()
}

async function inviteOrCreate(payload: Record<string, unknown>, fallback: Record<string, unknown>, okMsg: string) {
  if (submitting.value) return
  submitting.value = true
  try {
    const ack = (await agent.invokeAgent('DoAgentInviteToConf', payload)) as Record<string, unknown>
    if (ccsAckCode(ack) === 0) {
      ElMessage.success(okMsg)
      emit('update:modelValue', false)
      return
    }
    const createAck = (await agent.invokeAgent('DoAgentConfCall', fallback)) as Record<string, unknown>
    if (ccsAckCode(createAck) !== 0) throw new Error(formatCcsAck(createAck))
    ElMessage.success(okMsg)
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error(formatCcsThrown(e))
  } finally {
    submitting.value = false
  }
}

async function onConfirm() {
  if (props.kind === 'call_agent' || props.kind === 'im') {
    const a = selectedIds.value[0] ? findAgent(selectedIds.value[0]) : firstAgent(selectedGroupId.value)
    if (!a) {
      ElMessage.info('当前无在线坐席')
      return
    }
    if (props.kind === 'im') {
      void pickIm(a)
      return
    }
    void pickCallAgent(a)
    return
  }
  if (props.kind === 'monitor') {
    if (props.monitorAction === 'force_block') {
      const ids = selectedIds.value.length
        ? selectedIds.value
        : firstAgent(selectedGroupId.value)
          ? [firstAgent(selectedGroupId.value)!.agentId]
          : []
      if (!ids.length) {
        ElMessage.info('当前无在线坐席')
        return
      }
      await applyForceStatus(ids, 'force_block', `已强制闭塞 ${ids.length} 人`)
      return
    }
    const a = selectedIds.value[0] ? findAgent(selectedIds.value[0]) : firstAgent(selectedGroupId.value)
    if (!a) {
      ElMessage.info(talkingFilter.value
        ? (isMedia.value ? '当前无全媒体会话' : '当前无通话中坐席')
        : '当前无在线坐席')
      return
    }
    void pickMonitor(a)
    return
  }

  if (isMedia.value) {
    const convId = props.conversationId
    if (!convId) {
      ElMessage.info('请先选中一通全媒体会话')
      return
    }
    if (submitting.value) return
    submitting.value = true
    try {
      if (confTab.value === 'mode') {
        await mediaConference({ action: 'mode', conversationId: convId, mode: confMode.value })
        ElMessage.success(confMode.value === 1 ? '已切换为只听' : '已切换为听说')
        emit('update:modelValue', false)
        return
      }
      const ids = selectedIds.value.length
        ? selectedIds.value
        : firstAgent(selectedGroupId.value)
          ? [firstAgent(selectedGroupId.value)!.agentId]
          : []
      if (!ids.length) {
        ElMessage.info(confTab.value === 'kick' ? '请选择要踢出的坐席' : '请选择要邀请的坐席')
        return
      }
      await mediaConference({
        action: confTab.value === 'kick' ? 'kick' : 'invite',
        conversationId: convId,
        agentIds: ids,
      })
      ElMessage.success(confTab.value === 'kick' ? `已踢出 ${ids.length} 人` : `已邀请 ${ids.length} 人入会话`)
      emit('update:modelValue', false)
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '会议操作失败')
    } finally {
      submitting.value = false
    }
    return
  }

  if (confTab.value === 'mode') {
    await invokeAck(
      'DoAgentChangeConfMode',
      { CallID: -1, CallIDType: 0, Mode: confMode.value },
      confMode.value === 1 ? '已切换为只听' : '已切换为听说',
    )
    return
  }
  if (confTab.value === 'create') {
    if (targetKind.value === 'external') {
      const phone = phoneNo.value.trim()
      if (!phone) {
        ElMessage.info('请输入外线号码')
        return
      }
      await invokeAck(
        'DoAgentConfCall',
        { ulConfSize: confSize.value, szPhoneNo: phone, AgentCalltype: 4 },
        '已发起会议外呼',
      )
      return
    }
    const a = selectedIds.value[0] ? findAgent(selectedIds.value[0]) : firstAgent(selectedGroupId.value)
    if (!a) {
      ElMessage.info('请选择要呼入会议的坐席')
      return
    }
    await invokeAck(
      'DoAgentConfCall',
      { ulConfSize: confSize.value, szPhoneNo: a.workNo, AgentCalltype: 0 },
      `已发起会议呼叫 ${a.workNo}`,
    )
    return
  }
  if (confTab.value === 'invite') {
    if (targetKind.value === 'external') {
      const phone = phoneNo.value.trim()
      if (!phone) {
        ElMessage.info('请输入外线号码')
        return
      }
      await inviteOrCreate(
        { ulAgentCount: 0, ulNonAgentCount: 1, Agents: [], NonAgents: phone },
        { ulConfSize: confSize.value, szPhoneNo: phone, AgentCalltype: 4 },
        '已邀请外线入会',
      )
      return
    }
    const ids = selectedIds.value.length
      ? selectedIds.value
      : firstAgent(selectedGroupId.value)
        ? [firstAgent(selectedGroupId.value)!.agentId]
        : []
    if (!ids.length) {
      ElMessage.info('请选择要邀请的坐席')
      return
    }
    const first = findAgent(ids[0]) ?? firstAgent(selectedGroupId.value)
    await inviteOrCreate(
      { ulAgentCount: ids.length, ulNonAgentCount: 0, Agents: ids, NonAgents: '' },
      { ulConfSize: confSize.value, szPhoneNo: first?.workNo ?? '', AgentCalltype: 0 },
      `已邀请 ${ids.length} 人入会`,
    )
    return
  }
  if (confTab.value === 'kick') {
    const ids = selectedIds.value.length
      ? selectedIds.value
      : firstAgent(selectedGroupId.value)
        ? [firstAgent(selectedGroupId.value)!.agentId]
        : []
    if (!ids.length) {
      ElMessage.info('请选择要踢出的坐席')
      return
    }
    await invokeAck(
      'DoAgentKickOut',
      { agentCount: ids.length, nonAgentCount: 0, agents: ids, nonAgents: [] },
      `已踢出 ${ids.length} 人`,
    )
  }
}
</script>

<style scoped>
.ws-conf-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.ws-force-mode-label {
  font-size: 13px;
  color: #475569;
}
.xfer-split {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 12px;
  min-height: 360px;
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
.xfer-hint {
  float: left;
  color: #94a3b8;
  font-size: 12px;
  line-height: 32px;
}
</style>
