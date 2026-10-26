<template>
  <footer class="omni-input" :style="{ height: inputHeight + 'px' }">
    <div class="input-resize-handle" @mousedown.prevent="onInputResizeStart" title="拖动调整输入框高度"></div>

    <div v-if="autoReply" class="ai-hosting-bar">
      <span>AI 自动回复托管中</span>
      <el-button v-permission="'conversation.ai'" size="small" link type="warning" @click="disableAutoReply">停止托管</el-button>
    </div>

    <div class="input-toolbar">
      <div class="input-toolbar-left">
        <el-popover placement="top-start" :width="400" trigger="click" popper-class="emoji-popover">
          <template #reference>
            <el-button text class="tool-btn" title="表情" :disabled="disabled">
              <el-icon><Sunny /></el-icon>
            </el-button>
          </template>
          <EmojiPicker @pick="insertEmoji" />
        </el-popover>

        <div class="tool-split" :class="{ 'is-disabled': disabled }">
          <el-button
            text
            class="tool-btn"
            title="截图"
            :disabled="disabled"
            @click="onScreenshotAction('screenshot')"
          >
            <el-icon><Scissor /></el-icon>
          </el-button>
          <el-popover
            v-model:visible="screenshotMenuVisible"
            placement="top-start"
            :width="260"
            trigger="click"
            popper-class="screenshot-menu-popover"
            :disabled="disabled"
          >
            <template #reference>
              <el-button text class="tool-btn tool-caret-btn" title="截图菜单" :disabled="disabled">
                <el-icon class="tool-caret"><ArrowDown /></el-icon>
              </el-button>
            </template>
            <ScreenshotMenu
              :hide-window="hideWindow"
              @update:hide-window="setHideWindow"
              @action="onScreenshotMenuAction"
            />
          </el-popover>
        </div>

        <el-button text class="tool-btn" title="发送文件" :disabled="disabled" @click="fileInputRef?.click()">
          <el-icon><Folder /></el-icon>
        </el-button>
        <el-button text class="tool-btn" title="发送图片" :disabled="disabled" @click="imageInputRef?.click()">
          <el-icon><Picture /></el-icon>
        </el-button>
        <el-button v-permission="'conversation.reply'" text class="tool-btn" title="窗口抖动" :disabled="disabled" @click="sendShake">
          <el-icon><Iphone /></el-icon>
        </el-button>
        <el-button text class="tool-btn" title="红包" :disabled="disabled" @click="showRedPacket = true">
          <span class="tool-emoji">🧧</span>
        </el-button>

        <!-- 跨渠道触达：给当前客户发短信（模板由班长维护并报备，坐席只填变量） -->
        <el-button v-permission="'sms.send'"
          text
          class="tool-btn"
          title="发短信"
          :disabled="disabled || !conversationId"
          @click="smsDialogVisible = true"
        >
          <el-icon><ChatDotRound /></el-icon>
        </el-button>

        <!-- 跨渠道触达：给当前客户发邮件（信封图标，与短信区分开） -->
        <el-button v-permission="'email.send'"
          text
          class="tool-btn"
          title="发邮件"
          :disabled="disabled || !conversationId"
          @click="emailDialogVisible = true"
        >
          <el-icon><Message /></el-icon>
        </el-button>

        <el-dropdown trigger="click" :disabled="disabled" @command="onAiCommand">
          <el-button text class="tool-btn tool-btn-dropdown" title="AI 助手" :disabled="disabled">
            <el-icon><MagicStick /></el-icon>
            <el-icon class="tool-caret"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="copilot">代理回复</el-dropdown-item>
              <el-dropdown-item command="auto_reply">
                {{ autoReply ? '关闭自动回复' : '自动回复' }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <input ref="fileInputRef" type="file" class="hidden-input" @change="onFileSelected" />
    <input ref="imageInputRef" type="file" accept="image/*" multiple class="hidden-input" @change="onImageSelected" />

    <div class="composer-body">
      <div v-if="pendingImages.length" class="composer-attachments">
        <div
          v-for="img in pendingImages"
          :key="img.id"
          class="attachment-thumb"
          title="双击查看原图"
          @dblclick="openImagePreview(img.previewUrl)"
        >
          <img :src="img.previewUrl" :alt="img.file.name" />
          <button type="button" class="attachment-remove" title="移除" @click.stop="removePendingImage(img.id)">
            ×
          </button>
        </div>
      </div>

      <el-input
        ref="textareaRef"
        v-model="draft"
        placeholder="在此输入内容"
        class="chat-input"
        :rows="pendingImages.length ? 2 : 3"
        type="textarea"
        resize="none"
        :disabled="disabled"
        @keydown="onDraftKeydown"
        @paste="onPaste"
      />
    </div>

    <div class="input-footer-actions">
      <el-button size="small" class="btn-close" @click="onClose">关闭</el-button>
      <el-dropdown v-permission="'conversation.reply'"
        split-button
        type="primary"
        size="small"
        :disabled="(!canSend) || disabled"
        @click="sendMessage"
        @command="handleSendCommand"
      >
        发送
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="send_close">发送并关闭</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <RedPacketDialog v-model="showRedPacket" @confirm="onRedPacketConfirm" />

    <!-- 跨渠道触达：发送短信；发送后触发 sent 以刷新消息流，让"短信触达"记录立即出现 -->
    <SmsSendDialog
      v-model="smsDialogVisible"
      :conversation-id="conversationId"
      @sent="emit('sent')"
    />

    <!-- 跨渠道触达：发送邮件 -->
    <EmailSendDialog
      v-model="emailDialogVisible"
      :conversation-id="conversationId"
      @sent="emit('sent')"
    />

    <AiCopilotPanel
      v-model="showCopilot"
      :conversation-id="conversationId"
      :draft="draft"
      :auto-reply="autoReply"
      @fill="onCopilotFill"
      @send="onCopilotSend"
      @stop-auto-reply="disableAutoReply"
    />

    <ScreenshotRecordBar :visible="recording" @stop="stopScreenRecord" />

    <el-image-viewer
      v-if="previewVisible"
      :url-list="previewUrlList"
      :initial-index="0"
      teleported
      @close="previewVisible = false"
    />
  </footer>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, toRef, inject, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Sunny,
  Picture,
  ArrowDown,
  Scissor,
  Folder,
  Iphone,
  MagicStick,
  Message,
  ChatDotRound,
} from '@element-plus/icons-vue'
import { api } from '@/api/client'
import { useChatMedia } from '@/composables/useChatMedia'
import { useSessionAi } from '@/composables/useSessionAi'
import { useScreenshotCapture } from '@/composables/useScreenshotCapture'
import { useScreenshotShortcuts } from '@/composables/useScreenshotShortcuts'
import {
  SCREENSHOT_HIDE_TARGET,
  SCREENSHOT_LONG_TARGET,
  type ScreenshotAction,
} from './screenshot-context'
import EmojiPicker from './EmojiPicker.vue'
import RedPacketDialog from './RedPacketDialog.vue'
import AiCopilotPanel from './AiCopilotPanel.vue'
import ScreenshotMenu from './ScreenshotMenu.vue'
import ScreenshotRecordBar from './ScreenshotRecordBar.vue'
import SmsSendDialog from './SmsSendDialog.vue'
import EmailSendDialog from './EmailSendDialog.vue'

const props = defineProps<{
  conversationId: number | null
  sessionId: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  sent: []
  close: []
  'ai-mode-change': [autoReply: boolean]
}>()

const draft = ref('')
const inputHeight = ref(180)
const inputResizing = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const imageInputRef = ref<HTMLInputElement | null>(null)
const textareaRef = ref<{ textarea?: HTMLTextAreaElement } | null>(null)
const showRedPacket = ref(false)
const showCopilot = ref(false)
const screenshotMenuVisible = ref(false)
const smsDialogVisible = ref(false)
const emailDialogVisible = ref(false)

interface PendingImage {
  id: string
  file: File
  previewUrl: string
}

const pendingImages = ref<PendingImage[]>([])
const previewVisible = ref(false)
const previewUrlList = ref<string[]>([])

const canSend = computed(() => !!draft.value.trim() || pendingImages.value.length > 0)

let pendingImageSeq = 0

const hideTarget = inject(SCREENSHOT_HIDE_TARGET, ref<HTMLElement | null>(null))
const longTarget = inject(SCREENSHOT_LONG_TARGET, ref<HTMLElement | null>(null))
const conversationIdRef = computed(() => props.conversationId)

const {
  hideWindow,
  recording,
  setHideWindow,
  captureScreenshot,
  startScreenRecord,
  stopScreenRecord,
  captureLongScreenshot,
  extractText,
  screenTranslate,
} = useScreenshotCapture({
  conversationId: conversationIdRef,
  hideTarget,
  longTarget,
  onSent: () => emit('sent'),
  onFillDraft: (text) => {
    draft.value = text
  },
})

const shortcutsEnabled = computed(() => !props.disabled && !!props.conversationId)

useScreenshotShortcuts(shortcutsEnabled, (action) => onScreenshotAction(action))

const { sendFileAttachment, sendImage, sendRedPacket, extractPasteImageFile } = useChatMedia()
const { autoReply, loadAssistants, loadAiState, enableAutoReply, disableAutoReply } =
  useSessionAi(toRef(props, 'sessionId'))

watch(autoReply, (v) => emit('ai-mode-change', v))

onMounted(async () => {
  await loadAssistants()
  await loadAiState()
})

watch(
  () => props.sessionId,
  () => {
    loadAiState()
    clearPendingImages()
  },
)

onBeforeUnmount(() => {
  clearPendingImages()
})

function addPendingImage(file: File) {
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('仅支持图片文件')
    return
  }
  const isFirst = pendingImages.value.length === 0
  pendingImages.value.push({
    id: `pi-${Date.now()}-${pendingImageSeq++}`,
    file,
    previewUrl: URL.createObjectURL(file),
  })
  if (isFirst) {
    inputHeight.value = Math.min(360, inputHeight.value + 88)
  }
}

function removePendingImage(id: string) {
  const idx = pendingImages.value.findIndex((i) => i.id === id)
  if (idx < 0) return
  URL.revokeObjectURL(pendingImages.value[idx].previewUrl)
  pendingImages.value.splice(idx, 1)
  if (pendingImages.value.length === 0) {
    inputHeight.value = Math.max(140, inputHeight.value - 88)
  }
}

function clearPendingImages() {
  for (const img of pendingImages.value) {
    URL.revokeObjectURL(img.previewUrl)
  }
  pendingImages.value = []
}

function openImagePreview(url: string) {
  previewUrlList.value = [url]
  previewVisible.value = true
}

function onInputResizeStart(e: MouseEvent) {
  inputResizing.value = true
  const startY = e.clientY
  const startH = inputHeight.value
  const onMove = (ev: MouseEvent) => {
    inputHeight.value = Math.max(140, Math.min(360, startH + (startY - ev.clientY)))
  }
  const onUp = () => {
    inputResizing.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function insertEmoji(emoji: string) {
  const el = textareaRef.value?.textarea
  if (!el) {
    draft.value += emoji
    return
  }
  const start = el.selectionStart ?? draft.value.length
  const end = el.selectionEnd ?? start
  draft.value = draft.value.slice(0, start) + emoji + draft.value.slice(end)
  const pos = start + emoji.length
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

async function sendMessage() {
  if (!props.conversationId || !canSend.value) return
  const text = draft.value.trim()
  const images = [...pendingImages.value]
  try {
    for (const img of images) {
      await sendImage(props.conversationId, img.file)
    }
    if (images.length) clearPendingImages()
    if (text) {
      await api.post(`/api/v1/accounts/1/conversations/${props.conversationId}/messages`, {
        content: text,
        message_type: 'outgoing',
        private: false,
      })
      draft.value = ''
    }
    emit('sent')
  } catch (err) {
    ElMessage.error((err as Error).message || '发送失败')
  }
}

function handleSendCommand(cmd: string) {
  if (cmd === 'send_close') {
    sendMessage().then(() => emit('close'))
  }
}

function onDraftKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function onPaste(e: ClipboardEvent) {
  if (!props.conversationId || props.disabled) return
  const file = extractPasteImageFile(e)
  if (!file) return
  e.preventDefault()
  addPendingImage(file)
}

async function sendText() {
  await sendMessage()
}

function onScreenshotMenuAction(action: ScreenshotAction) {
  screenshotMenuVisible.value = false
  onScreenshotAction(action)
}

async function onScreenshotAction(action: ScreenshotAction) {
  if (!props.conversationId || props.disabled) return
  switch (action) {
    case 'screenshot':
      await captureScreenshot()
      break
    case 'record':
      await startScreenRecord()
      break
    case 'long':
      await captureLongScreenshot()
      break
    case 'ocr':
      await extractText()
      break
    case 'translate':
      await screenTranslate()
      break
  }
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.conversationId) return
  try {
    await sendFileAttachment(props.conversationId, file)
    emit('sent')
  } catch (err) {
    ElMessage.error((err as Error).message || '文件发送失败')
  }
}

function onImageSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  input.value = ''
  if (!files?.length || !props.conversationId) return
  for (const file of files) {
    addPendingImage(file)
  }
}

async function sendShake() {
  if (!props.sessionId) return
  try {
    await api.post(`/api/omnichannel/sessions/${props.sessionId}/shake`)
    ElMessage.success('已发送窗口抖动')
    emit('sent')
  } catch {
    ElMessage.error('抖动发送失败')
  }
}

function onAiCommand(cmd: string) {
  if (cmd === 'copilot') {
    showCopilot.value = true
    return
  }
  if (cmd === 'auto_reply') {
    if (autoReply.value) {
      disableAutoReply()
    } else {
      enableAutoReply()
    }
  }
}

async function onRedPacketConfirm(payload: { title: string; amount?: string }) {
  if (!props.conversationId) return
  try {
    await sendRedPacket(props.conversationId, payload.title, payload.amount)
    emit('sent')
  } catch {
    ElMessage.error('红包发送失败')
  }
}

function onCopilotFill(text: string) {
  draft.value = text
  showCopilot.value = false
}

async function onCopilotSend(text: string) {
  draft.value = text
  await sendText()
  showCopilot.value = false
}

function onClose() {
  draft.value = ''
  clearPendingImages()
  emit('close')
}

defineExpose({
  openRedPacket: () => { showRedPacket.value = true },
  setDraft: (text: string) => { draft.value = text },
  appendDraft: (text: string) => { draft.value += text },
})
</script>

<style scoped>
.hidden-input {
  display: none;
}
.ai-hosting-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  font-size: 12px;
  color: #e6a23c;
  background: #fdf6ec;
  border-bottom: 1px solid #faecd8;
}
.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 0;
  flex-shrink: 0;
}
.composer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.input-toolbar-left {
  display: flex;
  align-items: center;
  gap: 2px;
}
.tool-btn {
  padding: 4px 6px;
  color: #606266;
}
.tool-split {
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
}
.tool-split.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
.tool-split:hover {
  background: rgba(0, 0, 0, 0.04);
}
.tool-caret-btn {
  padding-left: 0;
  min-width: 18px;
}
.tool-caret {
  font-size: 10px;
}
.tool-emoji {
  font-size: 18px;
  line-height: 1;
}
.composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 12px 0;
  flex-shrink: 0;
}
.attachment-thumb {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #e4e7ed;
  background: #f5f7fa;
  cursor: zoom-in;
  flex-shrink: 0;
}
.attachment-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  user-select: none;
  pointer-events: none;
}
.attachment-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.attachment-remove:hover {
  background: rgba(0, 0, 0, 0.75);
}
.chat-input {
  flex: 1;
  min-height: 0;
  padding: 4px 12px;
}
.chat-input :deep(.el-textarea__inner) {
  border: none;
  box-shadow: none;
  resize: none;
  padding: 8px 0;
  min-height: 48px;
}
.input-footer-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 10px;
  flex-shrink: 0;
  border-top: 1px solid #f0f2f5;
  background: #fff;
}
.input-resize-handle {
  height: 4px;
  cursor: ns-resize;
  background: transparent;
  flex-shrink: 0;
}
.input-resize-handle:hover {
  background: #e4e7ed;
}
.omni-input {
  display: flex;
  flex-direction: column;
  border-top: 1px solid #ebeef5;
  background: #fff;
  min-height: 140px;
  overflow: hidden;
}
</style>

<style>
.emoji-popover.el-popover {
  padding: 8px 10px !important;
  box-sizing: border-box;
}
.screenshot-menu-popover.el-popover {
  padding: 0 !important;
  border-radius: 10px !important;
  border: 1px solid rgba(0, 0, 0, 0.06) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12) !important;
  backdrop-filter: blur(12px);
  background: rgba(255, 255, 255, 0.92) !important;
}
.screenshot-text-result-box .el-message-box__message {
  white-space: pre-wrap;
  max-height: 320px;
  overflow: auto;
  text-align: left;
}
</style>
