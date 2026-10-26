<template>
  <footer class="omni-input" :style="{ height: inputHeight + 'px' }">
    <div class="input-resize-handle" title="拖动调整输入框高度" @mousedown.prevent="onInputResizeStart" />

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

        <el-button text class="tool-btn" title="发送图片" :disabled="disabled" @click="imageInputRef?.click()">
          <el-icon><Picture /></el-icon>
        </el-button>
        <el-button text class="tool-btn" title="发送视频" :disabled="disabled" @click="videoInputRef?.click()">
          <el-icon><VideoCamera /></el-icon>
        </el-button>
        <el-button text class="tool-btn" title="发送文件" :disabled="disabled" @click="fileInputRef?.click()">
          <el-icon><Folder /></el-icon>
        </el-button>
      </div>
    </div>

    <input ref="imageInputRef" type="file" accept="image/*" multiple class="hidden-input" @change="onImageSelected" />
    <input ref="videoInputRef" type="file" accept="video/*" class="hidden-input" @change="onVideoSelected" />
    <input ref="fileInputRef" type="file" class="hidden-input" @change="onFileSelected" />

    <div class="composer-body">
      <div v-if="pendingItems.length" class="composer-attachments">
        <div
          v-for="item in pendingItems"
          :key="item.id"
          class="attachment-thumb"
          :class="{ 'is-file': item.kind !== 'image' }"
          :title="item.file.name"
        >
          <img v-if="item.kind === 'image' && item.previewUrl" :src="item.previewUrl" :alt="item.file.name" />
          <div v-else class="attachment-file">
            <el-icon><Folder /></el-icon>
            <span>{{ item.file.name }}</span>
          </div>
          <button type="button" class="attachment-remove" title="移除" @click.stop="removePending(item.id)">
            ×
          </button>
        </div>
      </div>

      <el-input
        ref="textareaRef"
        v-model="draft"
        placeholder="在此输入内容"
        class="chat-input"
        :rows="pendingItems.length ? 2 : 3"
        type="textarea"
        resize="none"
        :disabled="disabled"
        @keydown="onDraftKeydown"
        @paste="onPaste"
      />
    </div>

    <div class="input-footer-actions">
      <el-button
        type="primary"
        size="small"
        :disabled="!canSend || disabled || sending"
        :loading="sending"
        @click="sendMessage"
      >
        发送
      </el-button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { Sunny, Picture, Folder, VideoCamera } from '@element-plus/icons-vue'
import { useChatMedia } from '@/composables/useChatMedia'
import { useAgentInternalStore } from '@/stores/agentInternal'
import {
  encodeInternalMediaMessage,
  guessInternalMediaKind,
  internalMediaLabel,
  type InternalMediaKind,
} from '@/utils/internalMedia'
import EmojiPicker from './EmojiPicker.vue'

const props = defineProps<{
  peerAgentId: number | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  sent: []
}>()

const agentIm = useAgentInternalStore()
const { uploadFile, extractPasteImageFile } = useChatMedia()

const draft = ref('')
const inputHeight = ref(180)
const sending = ref(false)
const imageInputRef = ref<HTMLInputElement | null>(null)
const videoInputRef = ref<HTMLInputElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const textareaRef = ref<{ textarea?: HTMLTextAreaElement } | null>(null)

type PendingItem = {
  id: string
  kind: InternalMediaKind
  file: File
  previewUrl?: string
}

const pendingItems = ref<PendingItem[]>([])
let pendingSeq = 0

const canSend = computed(() => !!draft.value.trim() || pendingItems.value.length > 0)

watch(
  () => props.peerAgentId,
  () => {
    draft.value = ''
    clearPending()
  },
)

onBeforeUnmount(() => clearPending())

function clearPending() {
  for (const it of pendingItems.value) {
    if (it.previewUrl) URL.revokeObjectURL(it.previewUrl)
  }
  pendingItems.value = []
}

function addPending(file: File, kind?: InternalMediaKind) {
  const k = kind || guessInternalMediaKind(file)
  if (k === 'image' && !file.type.startsWith('image/')) {
    ElMessage.warning('仅支持图片文件')
    return
  }
  if (k === 'video' && !file.type.startsWith('video/')) {
    ElMessage.warning('仅支持视频文件')
    return
  }
  const isFirst = pendingItems.value.length === 0
  pendingItems.value.push({
    id: `pi-${Date.now()}-${pendingSeq++}`,
    kind: k,
    file,
    previewUrl: k === 'image' ? URL.createObjectURL(file) : undefined,
  })
  if (isFirst) inputHeight.value = Math.min(360, inputHeight.value + 88)
}

function removePending(id: string) {
  const idx = pendingItems.value.findIndex((i) => i.id === id)
  if (idx < 0) return
  const it = pendingItems.value[idx]
  if (it.previewUrl) URL.revokeObjectURL(it.previewUrl)
  pendingItems.value.splice(idx, 1)
  if (pendingItems.value.length === 0) inputHeight.value = Math.max(140, inputHeight.value - 88)
}

function onInputResizeStart(e: MouseEvent) {
  const startY = e.clientY
  const startH = inputHeight.value
  const onMove = (ev: MouseEvent) => {
    inputHeight.value = Math.max(140, Math.min(360, startH + (startY - ev.clientY)))
  }
  const onUp = () => {
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

function onDraftKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void sendMessage()
  }
}

function onPaste(e: ClipboardEvent) {
  if (props.disabled) return
  const file = extractPasteImageFile(e)
  if (!file) return
  e.preventDefault()
  addPending(file, 'image')
}

function onImageSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  input.value = ''
  if (!files?.length) return
  for (const f of files) addPending(f, 'image')
}

function onVideoSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) addPending(file, 'video')
}

function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  addPending(file, guessInternalMediaKind(file))
}

async function sendMessage() {
  if (!props.peerAgentId || !canSend.value || sending.value) return
  const text = draft.value.trim()
  const items = [...pendingItems.value]
  sending.value = true
  try {
    for (const item of items) {
      const uploaded = await uploadFile(item.file)
      const media = {
        kind: item.kind,
        file_url: uploaded.file_url,
        file_name: item.file.name,
        content_type: uploaded.content_type,
        byte_size: uploaded.byte_size,
      }
      const wire = encodeInternalMediaMessage(media)
      await agentIm.send(wire, {
        displayText: internalMediaLabel(media),
        media,
      })
    }
    if (items.length) clearPending()
    if (text) {
      await agentIm.send(text)
      draft.value = ''
    }
    emit('sent')
  } catch (err) {
    ElMessage.error((err as Error).message || '发送失败')
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.hidden-input {
  display: none;
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
  flex-shrink: 0;
}
.attachment-thumb.is-file {
  width: auto;
  min-width: 120px;
  max-width: 180px;
  padding: 8px;
  height: auto;
  min-height: 56px;
}
.attachment-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.attachment-file {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #606266;
  word-break: break-all;
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
