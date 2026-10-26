<template>
  <el-drawer v-model="visible" title="AI 代理回复" size="360px" @open="onOpen">
    <div v-if="autoReply" class="ai-banner">
      <span>当前会话处于自动回复托管</span>
      <el-button size="small" type="warning" plain @click="emit('stop-auto-reply')">停止托管</el-button>
    </div>
    <div class="ai-actions">
      <el-button type="primary" :loading="loading" @click="fetchSuggestions">获取回复建议</el-button>
    </div>
    <div v-if="suggestions.length" class="suggestion-list">
      <div v-for="(s, i) in suggestions" :key="i" class="suggestion-card">
        <p>{{ s }}</p>
        <div class="suggestion-btns">
          <el-button size="small" @click="emit('fill', s)">填入输入框</el-button>
          <el-button size="small" type="primary" @click="emit('send', s)">直接发送</el-button>
        </div>
      </div>
    </div>
    <el-empty v-else-if="!loading" description="点击上方按钮获取 AI 建议" />
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { replySuggestion } from '@/api/captain'

const props = defineProps<{
  modelValue: boolean
  conversationId: number | null
  draft?: string
  autoReply?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  fill: [text: string]
  send: [text: string]
  'stop-auto-reply': []
}>()

const visible = ref(props.modelValue)
const suggestions = ref<string[]>([])
const loading = ref(false)

watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
  },
)
watch(visible, (v) => emit('update:modelValue', v))

function onOpen() {
  suggestions.value = []
}

async function fetchSuggestions() {
  if (!props.conversationId) return
  loading.value = true
  try {
    suggestions.value = await replySuggestion(props.conversationId, props.draft)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.ai-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fdf6ec;
  border-radius: 6px;
  font-size: 13px;
  color: #e6a23c;
}
.ai-actions {
  margin-bottom: 16px;
}
.suggestion-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.suggestion-card {
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}
.suggestion-card p {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.suggestion-btns {
  display: flex;
  gap: 8px;
}
</style>
