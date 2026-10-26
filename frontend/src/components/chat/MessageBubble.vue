<template>
  <div class="bubble-row" :class="message.from === 'agent' ? 'out' : 'in'">
    <div
      class="bubble"
      :class="{
        bot: message.kind === 'bot',
        shake: message.kind === 'shake',
        'red-packet': message.kind === 'red_packet',
      }"
    >
      <template v-if="message.kind === 'bot'">
        <div class="bot-cap">机器人结果</div>
        <ul>
          <li v-for="(line, i) in message.lines" :key="i">{{ line }}</li>
        </ul>
      </template>
      <template v-else-if="message.kind === 'video'">
        <video
          v-if="message.file_url"
          class="bubble-video"
          :src="message.file_url"
          controls
          preload="metadata"
        />
        <div v-else class="video-ph">视频消息</div>
      </template>
      <template v-else-if="message.kind === 'image'">
        <a :href="message.file_url" target="_blank" rel="noopener">
          <img :src="message.file_url" class="bubble-image" alt="图片" />
        </a>
      </template>
      <template v-else-if="message.kind === 'file'">
        <a :href="message.file_url" target="_blank" rel="noopener" class="file-card">
          <el-icon><Folder /></el-icon>
          <span>{{ message.file_name || message.text }}</span>
        </a>
      </template>
      <template v-else-if="message.kind === 'red_packet'">
        <div class="red-packet-card">
          <div class="rp-icon">🧧</div>
          <div class="rp-title">{{ message.red_packet_title || '恭喜发财' }}</div>
          <div v-if="message.red_packet_amount" class="rp-amount">¥{{ message.red_packet_amount }}</div>
        </div>
      </template>
      <template v-else-if="message.kind === 'news'">
        <div class="news-cap">图文卡片</div>
        <a
          v-for="(a, i) in message.articles || []"
          :key="i"
          class="news-card"
          :href="a.url || undefined"
          :target="a.url ? '_blank' : undefined"
          rel="noopener"
        >
          <img v-if="a.picUrl" :src="a.picUrl" class="news-thumb" alt="" />
          <div>
            <div class="news-title">{{ a.title }}</div>
            <div class="news-desc">{{ a.description }}</div>
          </div>
        </a>
        <span v-if="!message.articles?.length" v-html="linkifiedText" />
      </template>
      <template v-else-if="message.kind === 'voice' || message.kind === 'tts'">
        <div class="news-cap">{{ message.kind === 'tts' ? '语音播报' : '语音' }}</div>
        <audio v-if="message.file_url" class="bubble-audio" :src="message.file_url" controls preload="none" />
        <span v-html="linkifiedText" />
      </template>
      <template v-else-if="message.kind === 'weibo'">
        <div class="news-cap">微博</div>
        <span v-html="linkifiedText" />
      </template>
      <template v-else-if="message.kind === 'sms'">
        <div class="sms-card">
          <div class="sms-head">
            <span class="sms-icon" aria-hidden="true">📱</span>
            <span class="sms-label">短信</span>
            <span class="sms-status" :class="smsStatusClass">{{ smsStatusText }}</span>
          </div>
          <div class="sms-body" v-html="linkifiedText" />
          <div class="sms-meta">
            <span v-if="smsTemplateName">模板：{{ smsTemplateName }}</span>
            <span v-if="smsTo">发送至 {{ smsTo }}</span>
          </div>
        </div>
      </template>
      <template v-else>
        <span v-html="linkifiedText" />
      </template>
      <!-- 气泡底部一行：左侧倒计时（只有客户消息带有效期时出现，到期变红），右侧时间 -->
      <div class="bubble-foot">
        <span
          v-if="replyCountdown"
          class="bubble-deadline"
          :class="{ overdue: replyCountdown.overdue }"
        >
          {{ replyCountdown.overdue ? '已超时' : replyCountdown.text }}
        </span>
        <span v-else />
        <span class="bubble-time">{{ message.time }}</span>
      </div>
      <div v-if="sendError" class="bubble-send-error">未送达访客：{{ sendError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Folder } from '@element-plus/icons-vue'
import type { ThreadMsg } from '@/types/thread-message'
import { replaceWechatFacesWithImg } from './wechat-faces'

const props = defineProps<{
  message: ThreadMsg
}>()

/**
 * 坐席回复倒计时。
 *
 * 后端只给**客户消息**带 `content_attributes.reply_deadline_ms`（时长取渠道配置的
 * 「坐席回复超时」）。带这个字段 = 这条必须尽快回，气泡上显示剩余时间，到期变红
 * 提示「已超时」；不带 = 不需要及时回复，什么也不显示。
 */
const deadlineMs = computed(() => {
  if (props.message.from !== 'customer') return 0
  const raw = props.message.content_attributes?.reply_deadline_ms
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
})

// 每秒重算一次；没有截止时间就不起定时器（绝大多数消息都没有）
const nowTick = ref(Date.now())
let tickTimer: number | undefined
onMounted(() => {
  if (!deadlineMs.value) return
  tickTimer = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
})
onUnmounted(() => {
  if (tickTimer) window.clearInterval(tickTimer)
})

const replyCountdown = computed<{ overdue: boolean; text: string } | null>(() => {
  if (!deadlineMs.value) return null
  const left = deadlineMs.value - nowTick.value
  if (left <= 0) return { overdue: true, text: '已超时' }
  const sec = Math.ceil(left / 1000)
  // 主动形态的超时是分钟级（默认 300s），被动只有几秒 —— 按量级换单位更好读
  if (sec >= 60) return { overdue: false, text: `${Math.ceil(sec / 60)} 分钟内回复` }
  return { overdue: false, text: `${sec} 秒内回复` }
})

const SMS_STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  sent: '已发送',
  delivered: '已送达',
  failed: '发送失败',
}

function smsAttr(key: string): string {
  const v = (props.message.content_attributes ?? {})[key]
  return v === null || v === undefined ? '' : String(v)
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function linkify(text: string) {
  // 微信/企微的表情在协议里就是文本（`[发呆]`）。顺序必须是：
  // 先转义 → 再把占位符换成官方表情图 → 最后链接化。
  // 图替换必须放在转义之后，因为它产出的是 <img> 标签，先转义会把标签吃掉。
  return replaceWechatFacesWithImg(escapeHtml(text)).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>',
  )
}

const linkifiedText = computed(() => linkify(props.message.text ?? ''))

const smsStatusKey = computed(() => {
  const s = smsAttr('status') || 'sent'
  return ['queued', 'sent', 'delivered', 'failed'].includes(s) ? s : 'sent'
})

const smsStatusText = computed(() => {
  const raw = smsAttr('status') || 'sent'
  return SMS_STATUS_TEXT[raw] ?? raw
})

const smsStatusClass = computed(() => `is-${smsStatusKey.value}`)
const smsTemplateName = computed(() => smsAttr('template_name'))
const smsTo = computed(() => smsAttr('to'))
const sendError = computed(() => smsAttr('send_error'))
</script>

<style scoped>
/* 微信/企微表情图：尺寸与基线对齐，贴近微信客户端观感。
   v-html 注入的节点不带 scoped 的 data-v 标记，必须用 :deep 才能命中。 */
:deep(.wx-face) {
  width: 20px;
  height: 20px;
  vertical-align: -4px;
  margin: 0 1px;
}

.bubble-row {
  display: flex;
  margin-bottom: 10px;
}
.bubble-row.in {
  justify-content: flex-start;
}
.bubble-row.out {
  justify-content: flex-end;
}

.bubble {
  max-width: 72%;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.5;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.bubble-row.out .bubble {
  background: #c6e2ff;
}
.bubble.bot {
  border: 1px dashed var(--oa-primary);
  background: #f0f9ff;
}
.bot-cap {
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--oa-primary);
}
.news-cap {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 6px;
}
.sms-card {
  min-width: 0;
  max-width: 100%;
}
.sms-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.sms-icon {
  font-size: 14px;
  line-height: 1;
}
.sms-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}
.sms-status {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(15, 23, 42, 0.06);
  color: #64748b;
}
.sms-status.is-sent {
  color: #1677cc;
}
.sms-status.is-delivered {
  color: #1a9c5b;
}
.sms-status.is-queued {
  color: #cc8400;
}
.sms-status.is-failed {
  color: #cc3333;
  background: rgba(253, 238, 238, 0.95);
}
.sms-body {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
.sms-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #e2e8f0;
  font-size: 11px;
  color: #94a3b8;
}
.news-card {
  display: flex;
  gap: 8px;
  padding: 8px;
  margin-top: 4px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  text-decoration: none;
  color: inherit;
}
.news-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.news-title {
  font-weight: 600;
  font-size: 13px;
}
.news-desc {
  font-size: 12px;
  color: #64748b;
}
.bubble-audio {
  display: block;
  width: 220px;
  margin: 4px 0 6px;
}
.bubble-send-error {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.4;
  color: #cc3333;
}
.bubble ul {
  margin: 0;
  padding-left: 18px;
}
.bubble-image {
  max-width: 220px;
  max-height: 180px;
  border-radius: 6px;
  display: block;
}
.bubble-video {
  max-width: 280px;
  max-height: 200px;
  border-radius: 6px;
  background: #000;
  display: block;
}
.file-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: inherit;
  text-decoration: none;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
}
.red-packet-card {
  min-width: 160px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #e74c3c, #c0392b);
  color: #fff;
  border-radius: 8px;
  text-align: center;
}
.rp-icon {
  font-size: 28px;
}
.rp-title {
  font-size: 14px;
  margin-top: 4px;
}
.rp-amount {
  font-size: 18px;
  font-weight: 600;
  margin-top: 6px;
}
.shake-tip,
.bubble.shake {
  color: #909399;
  font-style: italic;
}
/* 气泡底部一行：左边倒计时、右边时间，两端对齐 */
.bubble-foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
.bubble-time {
  font-size: 11px;
  color: var(--oa-muted);
}
/* 坐席回复倒计时：**始终红色**提醒坐席"这条要尽快回"；到期再加粗加重 */
.bubble-deadline {
  font-size: 11px;
  color: #f56c6c;
}
.bubble-deadline.overdue {
  font-weight: 600;
}
.video-ph {
  height: 120px;
  background: #303133;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}
</style>
