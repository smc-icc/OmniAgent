<template>
  <div v-if="productModules.enabled('icc') || agent.callPhase !== 'idle'" class="phone-call-toolbar">
    <div
      v-for="(group, gi) in toolbarGroups"
      :key="gi"
      class="phone-toolbar-group"
    >
      <template v-for="item in group">
        <el-dropdown
          v-if="item.menu"
          :key="item.id"
          trigger="click"
          popper-class="phone-toolbar-dropdown"
          :disabled="item.disabled"
          @command="(cmd: string | number) => onMenuCommand(item.id, String(cmd))"
        >
          <button
            type="button"
            class="phone-toolbar-item"
            :class="{ disabled: item.disabled }"
            :title="item.label"
          >
            <img :src="item.icon" :alt="item.label" class="phone-toolbar-icon" />
            <span class="phone-toolbar-caption">
              <span class="phone-toolbar-label">{{ item.label }}</span>
              <el-icon class="phone-toolbar-caret"><ArrowDown /></el-icon>
            </span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="m in item.menu"
                :key="m.id"
                :command="m.id"
              >
                <span class="phone-toolbar-menu-row">
                  <img v-if="m.icon" :src="m.icon" alt="" class="phone-toolbar-menu-icon" />
                  <span class="phone-toolbar-menu-divider" />
                  <span class="phone-toolbar-menu-label">{{ m.label }}</span>
                </span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <button
          v-else
          :key="item.id"
          type="button"
          class="phone-toolbar-item"
          :class="{
            active: item.id === activeItem || (item.id === 'mute' && agent.callMuted),
            ringing: item.id === 'answer' && callPhase === 'ringing',
            muted: item.id === 'mute' && agent.callMuted,
            pending: item.id === 'mute' && muteBusy,
            disabled: item.disabled,
          }"
          :title="item.label"
          :disabled="item.disabled"
          @click="onAction(item.id)"
        >
          <img :src="item.icon" :alt="item.label" class="phone-toolbar-icon" />
          <span class="phone-toolbar-label">{{ item.label }}</span>
        </button>
      </template>
      <span v-if="gi < toolbarGroups.length - 1" class="phone-toolbar-divider" />
    </div>

    <TransferTargetDialog
      v-model="transferVisible"
      :mode="transferMode"
      :out-default="transferOutDefault"
      :agent-default="transferAgentDefault"
      :ivr-default="transferIvrDefault"
      :hide-call-modes="isMedia"
      @confirm="onTransferConfirm"
    />
    <WorkspaceAgentPickDialog
      v-model="inviteOpen"
      kind="conference"
      invite-only
      :initial-tab="'invite'"
      :initial-target="inviteTarget"
    />
  </div>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
const productModules = useProductModulesStore()

import { computed, ref } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api/client'
import { useAgentStore } from '@/stores/agent'
import { useDesktopCallMediaStore } from '@/stores/desktop-call-media'
import { CCS_OFFER } from '@/types/agent-ccs'
import { formatCcsAck } from '@/utils/ccs-errors'
import TransferTargetDialog, { type TransferDialogMode } from '@/components/TransferTargetDialog.vue'
import WorkspaceAgentPickDialog from '@/components/WorkspaceAgentPickDialog.vue'

import shiftIcon from '@/assets/images/icon/Enable/shift.png'
import shiftGroupIcon from '@/assets/images/icon/Enable/shiftToGroupAndSkill.png'
import shiftIvrIcon from '@/assets/images/icon/Enable/shiftToIVR.png'
import callBanquetsIcon from '@/assets/images/icon/Enable/callBanquets.png'
import answerIcon from '@/assets/images/icon/Enable/answer.png'
import releaseIcon from '@/assets/images/icon/Enable/release.png'
import keepIcon from '@/assets/images/icon/Enable/keep.png'
import continueIcon from '@/assets/images/icon/Enable/continue.png'
import muteIcon from '@/assets/images/icon/Enable/mute.png'
import inviteAgentIcon from '@/assets/images/icon/Enable/inviteAgent.png'
import testOutboundIcon from '@/assets/images/icon/Enable/testOutbound.png'
// import missedIcon from '@/assets/images/icon/Enable/missed.png'

import shiftIconOff from '@/assets/images/icon/Disable/shift.png'
import answerIconOff from '@/assets/images/icon/Disable/answer.png'
import releaseIconOff from '@/assets/images/icon/Disable/release.png'
import keepIconOff from '@/assets/images/icon/Disable/keep.png'
import continueIconOff from '@/assets/images/icon/Disable/continue.png'
import muteIconOff from '@/assets/images/icon/Disable/mute.png'
import inviteAgentIconOff from '@/assets/images/icon/Disable/inviteAgent.png'
// import missedIconOff from '@/assets/images/icon/Disable/missed.png'

type ToolbarItem = {
  id: string
  label: string
  icon: string
  disabled?: boolean
  menu?: Array<{ id: string; label: string; icon?: string }>
}

const props = withDefaults(
  defineProps<{
    /** voice=话务 CCS；media=全媒体会话 */
    channel?: 'voice' | 'media'
    conversationId?: number | null
    sessionLive?: boolean
  }>(),
  { channel: 'voice', conversationId: null, sessionLive: false },
)

const agent = useAgentStore()
const desktopMedia = useDesktopCallMediaStore()
const muteBusy = ref(false)
const transferVisible = ref(false)
const transferMode = ref<TransferDialogMode>('agent')
const transferOutDefault = ref<'hold' | 'release' | 'consult'>('hold')
const transferAgentDefault = ref<'hold' | 'release'>('release')
const transferIvrDefault = ref<'hold' | 'release'>('hold')
const inviteOpen = ref(false)
const inviteTarget = ref<'agent' | 'external'>('agent')

const isMedia = computed(() => props.channel === 'media')

const callPhase = computed(() => {
  if (agent.callPhase === 'ringing') return 'ringing'
  if (agent.callPhase === 'held') return 'held'
  if (agent.callPhase === 'talking') return 'talking'
  return 'idle'
})

const activeItem = computed(() => {
  if (callPhase.value === 'ringing') return 'answer'
  if (callPhase.value === 'held') return 'continue'
  return null
})

const toolbarGroups = computed<ToolbarItem[][]>(() => {
  const ringing = callPhase.value === 'ringing'
  const talking = callPhase.value === 'talking'
  const held = callPhase.value === 'held'
  const inCall = talking || held
  const offerType = Number(agent.currentCall?.CallOfferedType ?? 0)
  // 监听/强插始终只释放；拦截接通后接管通话，用完整工具栏
  const supervisor = offerType === CCS_OFFER.Monitor || offerType === CCS_OFFER.Insert
    || (offerType === CCS_OFFER.Intercept && !talking)

  const pick = (on: string, off: string, enabled: boolean) => (enabled ? on : off)

  if (isMedia.value) {
    const live = !!props.sessionLive
    return [
      [
        {
          id: 'transfer',
          label: '转移',
          icon: pick(shiftIcon, shiftIconOff, live),
          disabled: !live,
          menu: [
            { id: 'skill', label: '转移至技能', icon: shiftGroupIcon },
            { id: 'agent_release', label: '转移至坐席', icon: keepIcon },
            { id: 'ivr_release', label: '转移至ITR', icon: shiftIvrIcon },
          ],
        },
      ],
      [
        {
          id: 'invite',
          label: '邀请',
          icon: pick(inviteAgentIcon, inviteAgentIconOff, live),
          disabled: !live,
          menu: [
            { id: 'invite_agent', label: '邀请坐席', icon: inviteAgentIcon },
          ],
        },
      ],
    ]
  }

  if (supervisor) {
    return [
      [
        {
          id: 'release',
          label: '释放',
          icon: pick(releaseIcon, releaseIconOff, inCall || ringing),
          disabled: !inCall && !ringing,
        },
      ],
    ]
  }

  return [
    [
      {
        id: 'transfer',
        label: '转移',
        icon: pick(shiftIcon, shiftIconOff, talking),
        disabled: !talking,
        menu: [
          { id: 'skill', label: '转移至技能', icon: shiftGroupIcon },
          { id: 'agent_hold', label: '保持转坐席', icon: keepIcon },
          { id: 'agent_release', label: '释放转坐席', icon: keepIcon },
          { id: 'consult', label: '咨询转坐席', icon: callBanquetsIcon },
          { id: 'out_consult', label: '咨询转外线', icon: callBanquetsIcon },
          { id: 'ivr_hold', label: '保持转IVR', icon: shiftIvrIcon },
          { id: 'ivr_release', label: '释放转IVR', icon: shiftIvrIcon },
          { id: 'out_hold', label: '保持转外线', icon: keepIcon },
          { id: 'out_release', label: '释放转外线', icon: keepIcon },
        ],
      },
    ],
    [
      {
        id: 'answer',
        label: '应答',
        icon: pick(answerIcon, answerIconOff, ringing),
        disabled: !ringing,
      },
    ],
    [
      {
        id: 'release',
        label: '释放',
        icon: pick(releaseIcon, releaseIconOff, inCall || ringing),
        disabled: !inCall && !ringing,
      },
      {
        id: 'hold',
        label: '保持',
        icon: pick(keepIcon, keepIconOff, talking),
        disabled: !talking,
      },
      {
        id: 'resume',
        label: '恢复',
        icon: pick(continueIcon, continueIconOff, held),
        disabled: !held,
      },
      {
        id: 'mute',
        label: muteBusy.value ? '处理中' : agent.callMuted ? '取消静音' : '静音',
        icon: pick(muteIcon, muteIconOff, inCall),
        disabled: !inCall || muteBusy.value,
      },
    ],
    [
      {
        id: 'invite',
        label: '邀请',
        icon: pick(inviteAgentIcon, inviteAgentIconOff, inCall),
        disabled: !inCall,
        menu: [
          { id: 'invite_agent', label: '邀请坐席', icon: inviteAgentIcon },
          { id: 'invite_out', label: '邀请外线', icon: testOutboundIcon },
        ],
      },
    ],
  ]
})

const actionLabels: Record<string, string> = {
  answer: '应答',
  release: '释放',
  hold: '保持',
  resume: '恢复',
  mute: '静音',
  invite: '邀请',
  // missed: '未接',
}

const transferLabels: Record<string, string> = {
  skill: '转移至技能',
  agent_hold: '保持转坐席',
  agent_release: '释放转坐席',
  ivr_hold: '保持转IVR',
  ivr_release: '释放转IVR',
  consult: '咨询转坐席',
  out_hold: '保持转外线',
  out_release: '释放转外线',
  out_consult: '咨询转外线',
}

function resetCallState() {
  muteBusy.value = false
}

async function onAction(id: string) {
  if (isMedia.value) return
  try {
    switch (id) {
      case 'answer':
        await desktopMedia.answer()
        ElMessage.success('已应答来电')
        break
      case 'release':
        await desktopMedia.release()
        resetCallState()
        ElMessage.success('通话已释放')
        break
      case 'hold':
        await agent.holdCall()
        ElMessage.success('通话已保持')
        break
      case 'resume':
        await agent.retrieveCall()
        ElMessage.success('通话已恢复')
        break
      case 'mute': {
        if (muteBusy.value) return
        muteBusy.value = true
        try {
          const next = !agent.callMuted
          await desktopMedia.setMuted(next)
          ElMessage.success(next ? '已静音' : '已取消静音')
        } finally {
          muteBusy.value = false
        }
        break
      }
      default:
        ElMessage.info(`${actionLabels[id] ?? id}：功能对接中`)
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  }
}

async function onMenuCommand(parent: string, cmd: string) {
  if (isMedia.value) {
    if (!props.sessionLive) {
      ElMessage.warning('当前会话已结束，无法操作')
      return
    }
    if (parent === 'invite') {
      transferMode.value = 'consult'
      transferVisible.value = true
      return
    }
    if (parent !== 'transfer') return
    const open = (mode: TransferDialogMode) => {
      transferMode.value = mode
      transferVisible.value = true
    }
    if (cmd === 'skill') open('skill')
    else if (cmd === 'agent_release' || cmd === 'agent' || cmd === 'agent_hold') open('agent')
    else if (cmd === 'ivr_release' || cmd === 'ivr' || cmd === 'ivr_hold') {
      if (!props.conversationId) {
        ElMessage.warning('请先选择会话')
        return
      }
      try {
        await api.post('/api/itr/sessions/start', {
          conversationId: String(props.conversationId),
          channelType: 'web_widget',
        })
        ElMessage.success('已转至 ITR')
      } catch (e) {
        ElMessage.error(e instanceof Error ? e.message : '启动 ITR 失败')
      }
    }
    else ElMessage.info(`转移 · ${transferLabels[cmd] ?? cmd}：多媒体会话暂不支持`)
    return
  }
  if (parent === 'invite') {
    if (callPhase.value !== 'talking' && callPhase.value !== 'held') {
      ElMessage.warning('当前非通话中，无法邀请')
      return
    }
    inviteTarget.value = cmd === 'invite_out' ? 'external' : 'agent'
    inviteOpen.value = true
    return
  }
  if (parent !== 'transfer') return
  if (agent.callPhase !== 'talking') {
    ElMessage.warning('当前非通话中，无法转移')
    return
  }
  // 通话相位优先：偶发 status 误清 currentCall 时先 hydrate 再判
  if (!agent.currentCall) {
    if (agent.callPhase === 'talking' || agent.callPhase === 'held') {
      try {
        await agent.hydrateStatus()
      } catch {
        /* ignore */
      }
    }
    if (!agent.currentCall) {
      ElMessage.warning('当前无通话，无法转移')
      return
    }
  }
  const open = (mode: TransferDialogMode, def?: 'hold' | 'release' | 'consult') => {
    transferMode.value = mode
    if (mode === 'out' && def) transferOutDefault.value = def
    if (mode === 'agent' && def && def !== 'consult') transferAgentDefault.value = def
    if (mode === 'ivr' && def && def !== 'consult') transferIvrDefault.value = def
    transferVisible.value = true
  }
  if (cmd === 'skill') open('skill')
  else if (cmd === 'agent_hold') open('agent', 'hold')
  else if (cmd === 'agent_release' || cmd === 'agent') open('agent', 'release')
  else if (cmd === 'consult') open('consult')
  else if (cmd === 'ivr_hold' || cmd === 'ivr') open('ivr', 'hold')
  else if (cmd === 'ivr_release') open('ivr', 'release')
  else if (cmd === 'out_hold') open('out', 'hold')
  else if (cmd === 'out_release') open('out', 'release')
  else if (cmd === 'out_consult') open('out', 'consult')
  else ElMessage.info(`转移 · ${transferLabels[cmd] ?? cmd}：功能对接中`)
}

async function onTransferConfirm(payload: Record<string, unknown>) {
  if (isMedia.value) {
    await onMediaTransferConfirm(payload)
    return
  }
  const callId = agent.currentCall?.CallID ?? 0
  const callIdType = agent.currentCall?.CallIDType ?? 0
  const base = { CallID: callId, CallIDType: callIdType }
  try {
    const kind = String(payload.kind || '')
    if (kind === 'skill') {
      await agent.invokeAgent('DoAgentTransferAgentGroup', {
        ...base,
        AgentGroup: Number(payload.AgentGroup || 0),
        SkillID: Number(payload.SkillID || 0),
        TransHoldTimeLong: -1,
      })
      ElMessage.success('已发起转移至技能')
    } else if (kind === 'agent' || kind === 'consult') {
      const ack = await agent.invokeAgent('DoAgentTransferAgent', {
        ...base,
        WorkNO: String(payload.WorkNO || ''),
        AgentGroupID: Number(payload.AgentGroupID || 0),
        SkillID: 0,
        PrivateInfo: '',
        AutoRetrieveCall: Number(payload.AutoRetrieveCall ?? (kind === 'consult' ? 0 : 2)),
      })
      const st = Number(ack.Status ?? ack.Result ?? 0)
      if (st !== 0) {
        ElMessage.error(formatCcsAck(ack as Record<string, unknown>))
        return
      }
      ElMessage.success(
        kind === 'consult'
          ? '已发起咨询转坐席'
          : Number(payload.AutoRetrieveCall) === 1
            ? '已发起保持转坐席'
            : '已发起释放转坐席',
      )
    } else if (kind === 'ivr') {
      const ack = await agent.invokeAgent('DoAgentTransferIVR', {
        ...base,
        TransferType: Number(payload.TransferType ?? 0),
        FlowID: Number(payload.FlowID || 0),
        NodeID: Number(payload.NodeID || 0),
        PrivateInfo: '',
      })
      const st = Number(ack.Status ?? ack.Result ?? 0)
      if (st !== 0) {
        // 失败弹窗由 OnAgentTransferIVRAck 统一提示「转IVR失败，回转坐席！」
        return
      }
      ElMessage.success(
        Number(payload.TransferType) === 1 ? '已发起保持转IVR' : '已发起释放转IVR',
      )
    } else if (kind === 'out') {
      await agent.invokeAgent('DoAgentTransferOut', {
        ...base,
        szPhoneNO: String(payload.szPhoneNO || ''),
        szCallerNO: '',
        TransferType: Number(payload.TransferType ?? 0),
        ConnectMode: 0,
      })
      ElMessage.success(
        Number(payload.TransferType) === 2
          ? '已发起咨询转外线'
          : Number(payload.TransferType) === 1
            ? '已发起保持转外线'
            : '已发起释放转外线',
      )
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '转移失败')
  }
}

defineExpose({ resetCallState, openTransfer })

function openTransfer(cmd = 'agent_release') {
  void onMenuCommand('transfer', cmd)
}

async function onMediaTransferConfirm(payload: Record<string, unknown>) {
  const id = props.conversationId
  if (!id) {
    ElMessage.warning('请先选择会话')
    return
  }
  const kind = String(payload.kind || '')
  try {
    if (kind === 'skill') {
      await api.post(`/api/omnichannel/sessions/${id}/transfer`, {
        mode: 'skill',
        agentGroupId: Number(payload.AgentGroup || 0),
        skillId: Number(payload.SkillID || 0),
      })
      ElMessage.success('已按技能重新排队')
      return
    }
    if (kind === 'agent') {
      const workNO = String(payload.WorkNO || '').trim()
      if (!workNO) {
        ElMessage.warning('请选择目标坐席')
        return
      }
      await api.post(`/api/omnichannel/sessions/${id}/transfer`, {
        mode: 'agent',
        workNO,
      })
      ElMessage.success('已转接至坐席')
      return
    }
    if (kind === 'consult') {
      const workNO = String(payload.WorkNO || '').trim()
      if (!workNO) {
        ElMessage.warning('请选择目标坐席')
        return
      }
      await api.post(`/api/omnichannel/sessions/${id}/invite`, { workNO })
      ElMessage.success('已邀请坐席加入会话')
      return
    }
    if (kind === 'ivr') {
      await api.post('/api/itr/sessions/start', {
        conversationId: String(id),
        channelType: 'web_widget',
        flowId: Number(payload.FlowID || 0) || undefined,
      })
      ElMessage.success('已转至 ITR')
      return
    }
    ElMessage.info('多媒体会话暂不支持该转移方式')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  }
}
</script>

<style scoped>
.phone-call-toolbar {
  display: flex;
  align-items: stretch;
  flex-wrap: nowrap;
  overflow-x: auto;
  gap: 0;
  padding: 3px 6px;
  background: linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
  border-bottom: 1px solid #d8e3f0;
  flex-shrink: 0;
}
.phone-toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.phone-toolbar-divider {
  width: 1px;
  align-self: stretch;
  margin: 3px 5px;
  background: #c5d5e8;
  flex-shrink: 0;
}
.phone-toolbar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 44px;
  padding: 3px 5px 2px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  line-height: 1;
}
.phone-toolbar-item:hover:not(.disabled):not(:disabled) {
  background: rgba(255, 255, 255, 0.65);
  border-color: #d0dbe8;
}
.phone-toolbar-item.active {
  background: #fff3cd;
  border-color: #e6c46a;
}
.phone-toolbar-item.ringing .phone-toolbar-icon {
  animation: phone-ring-shake 0.7s ease-in-out infinite;
  transform-origin: 70% 20%;
}
@keyframes phone-ring-shake {
  0% { transform: rotate(0deg); }
  12% { transform: rotate(16deg); }
  24% { transform: rotate(-14deg); }
  36% { transform: rotate(12deg); }
  48% { transform: rotate(-10deg); }
  60% { transform: rotate(6deg); }
  72% { transform: rotate(-4deg); }
  84%,
  100% { transform: rotate(0deg); }
}
.phone-toolbar-item.muted {
  background: #fde8e8;
  border-color: #d98a8a;
}
.phone-toolbar-item.muted .phone-toolbar-label {
  color: #c45656;
  font-weight: 600;
}
.phone-toolbar-item.disabled,
.phone-toolbar-item:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.phone-toolbar-icon {
  width: 21px;
  height: 21px;
  object-fit: contain;
  display: block;
}
.phone-toolbar-caption {
  position: relative;
  display: inline-block;
  text-align: center;
}
.phone-toolbar-label {
  display: block;
  font-size: 11px;
  color: #303133;
  white-space: nowrap;
  line-height: 1.2;
}
.phone-toolbar-caret {
  position: absolute;
  left: 100%;
  top: 50%;
  margin-left: 1px;
  transform: translateY(-50%);
  font-size: 9px;
  color: #909399;
}
.phone-toolbar-menu-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 26px;
}
.phone-toolbar-menu-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex-shrink: 0;
}
.phone-toolbar-menu-divider {
  width: 1px;
  height: 20px;
  background: #ebeef5;
  margin: 0 8px;
  flex-shrink: 0;
}
.phone-toolbar-menu-label {
  font-size: 12px;
  line-height: 1.2;
  color: #303133;
  white-space: nowrap;
}
</style>

<style>
.phone-toolbar-dropdown.el-popper {
  padding: 2px 0;
  max-height: min(70vh, 420px);
  overflow-y: auto;
}
.phone-toolbar-dropdown .el-dropdown-menu__item {
  padding: 2px 8px;
  line-height: normal;
}
</style>
