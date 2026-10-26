<template>
  <el-card shadow="never" class="un-card" v-loading="loading">
    <template #header>
      <div class="un-head">
        <div>
          <span class="un-title">最新未读公告信息</span>
          <span class="un-sub">仅展示发给您且在有效期内的公告</span>
        </div>
        <div class="un-stat">
          <el-tag type="danger" effect="plain" size="small">未读 {{ unreadCount }}</el-tag>
          <el-tag type="info" effect="plain" size="small">已读 {{ readCount }}</el-tag>
        </div>
      </div>
    </template>

    <div class="un-toolbar">
      <el-radio-group v-model="readFilter" size="default">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="unread">仅未读</el-radio-button>
        <el-radio-button value="read">仅已读</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="query"
        class="un-search"
        placeholder="搜索标题或摘要"
        clearable
        :prefix-icon="Search"
      />
    </div>

    <el-table
      :data="notices"
      stripe
      border
      size="small"
      class="un-table"
      :row-class-name="rowClassName"
      empty-text="暂无公告"
      @row-click="onRowClick"
    >
      <el-table-column label="状态" width="88" align="center">
        <template #default="{ row }">
          <span class="un-status-cell">
            <span :class="['un-dot', isRead(row.id) ? 'is-read' : 'is-unread']" />
            <el-tag :type="isRead(row.id) ? 'info' : 'danger'" size="small" effect="plain">
              {{ isRead(row.id) ? '已读' : '未读' }}
            </el-tag>
          </span>
        </template>
      </el-table-column>
      <el-table-column type="index" label="#" width="52" :index="indexMethod" />
      <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <span :class="{ 'un-title-unread': !isRead(row.id) }">{{ row.title }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="summary" label="摘要" min-width="240" show-overflow-tooltip />
      <el-table-column prop="publisher" label="类型" width="96" />
      <el-table-column prop="publishedAt" label="发布时间" width="158" />
      <el-table-column label="操作" width="200" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click.stop="openDetail(row)">查看</el-button>
          <el-button
            v-if="!isRead(row.id)"
            link
            type="primary"
            size="small"
            @click.stop="markRead(row.id)"
          >
            标记已读
          </el-button>
          <el-button v-else link size="small" @click.stop="markUnread(row.id)">标为未读</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="total, prev, pager, next" style="margin-top:16px;justify-content:flex-end" @current-change="loadNotices" />

    <el-dialog v-model="detailOpen" :title="detailRow?.title || '公告详情'" width="640px" destroy-on-close>
      <template v-if="detailRow">
        <p class="un-detail-meta">
          类型：{{ detailRow.publisher }} &nbsp;|&nbsp; {{ detailRow.publishedAt }}
        </p>
        <div class="un-detail-body" v-html="detailRow.contentHtml"></div>
      </template>
      <template #footer>
        <el-button @click="detailOpen = false">关闭</el-button>
        <el-button
          v-if="detailRow && !isRead(detailRow.id)"
          type="primary"
          @click="markReadAndClose"
        >
          标记已读并关闭
        </el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  fetchAnnouncementPage,
  markAnnouncementRead,
  markAnnouncementUnread,
  syncAnnouncementReads,
  type Announcement,
} from '@/api/dashboard'

const READ_STORAGE_KEY = 'oa_notice_read_ids_v1'

const TYPE_LABEL: Record<Announcement['type'], string> = {
  system: '系统公告',
  exam: '考试通知',
  training: '培训通知',
  emergency: '紧急公告',
}

interface InboxNotice {
  id: string
  title: string
  summary: string
  publisher: string
  publishedAt: string
  contentHtml: string
  read: boolean
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatPublishedAt(iso?: string, timeLabel?: string): string {
  if (iso) {
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
  }
  return timeLabel || '—'
}

function mapAnnouncement(a: Announcement): InboxNotice {
  const body = (a.body ?? '').trim()
  const plain = stripHtml(body)
  const summary = plain || a.time_label || a.title
  const contentHtml = `<p>${escapeHtml(body || a.title).replace(/\n/g, '<br/>')}</p>`
  return {
    id: a.id,
    title: a.title,
    summary: summary.length > 120 ? `${summary.slice(0, 120)}…` : summary,
    publisher: TYPE_LABEL[a.type] ?? a.type,
    publishedAt: formatPublishedAt(a.published_at, a.time_label),
    contentHtml,
    read: a.read === true,
  }
}

const notices = ref<InboxNotice[]>([])
const loading = ref(false)
const query = ref('')
const page = ref(1), total = ref(0), unreadCount = ref(0), readCount = ref(0)
let loadVersion = 0, searchTimer: ReturnType<typeof setTimeout> | undefined
/** 默认仅未读，与入口名称一致；可切换到「全部」对照已读/未读 */
const readFilter = ref<'all' | 'unread' | 'read'>('unread')
const detailOpen = ref(false)
const detailRow = ref<InboxNotice | null>(null)

function localReadIds(): string[] {
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  } catch {
    return []
  }
}

function isRead(id: string) {
  return notices.value.find((n) => n.id === id)?.read === true
}

function setLocalRead(id: string, read: boolean) {
  notices.value = notices.value.map((n) => (n.id === id ? { ...n, read } : n))
  if (detailRow.value?.id === id) {
    detailRow.value = { ...detailRow.value, read }
  }
}

async function loadNotices() {
  const version = ++loadVersion
  loading.value = true
  try {
    const result = await fetchAnnouncementPage({ unreadOnly: readFilter.value === 'unread', readOnly: readFilter.value === 'read', page: page.value, limit: 20, query: query.value })
    if (version !== loadVersion) return
    notices.value = result.items.map(mapAnnouncement)
    total.value = result.total; unreadCount.value = result.unread_count; readCount.value = result.read_count
    if (!result.items.length && page.value > 1) { page.value--; await loadNotices() }
  } catch {
    if (version !== loadVersion) return
    notices.value = []
    ElMessage.error('公告加载失败')
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

async function migrateLocalReads() {
  const ids = localReadIds()
  if (!ids.length) return
  try {
    await syncAnnouncementReads(ids)
    localStorage.removeItem(READ_STORAGE_KEY)
  } catch {
    /* 服务端未就绪时仍以本次接口结果为准 */
  }
}

onMounted(async () => {
  await migrateLocalReads()
  await loadNotices()
})

watch(readFilter, () => { page.value = 1; void loadNotices() })
watch(query, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.value = 1; void loadNotices() }, 250) })
onBeforeUnmount(() => { clearTimeout(searchTimer); loadVersion++ })

function indexMethod(i: number) {
  return (page.value - 1) * 20 + i + 1
}

function rowClassName({ row }: { row: InboxNotice }) {
  return isRead(row.id) ? 'un-row-read' : 'un-row-unread'
}

function onRowClick(row: InboxNotice) {
  openDetail(row)
}

function openDetail(row: InboxNotice) {
  detailRow.value = row
  detailOpen.value = true
}

async function markRead(id: string) {
  setLocalRead(id, true)
  try {
    await markAnnouncementRead(id)
    await loadNotices()
    ElMessage.success('已标记为已读')
  } catch {
    setLocalRead(id, false)
    ElMessage.error('标记已读失败')
  }
}

async function markUnread(id: string) {
  setLocalRead(id, false)
  try {
    await markAnnouncementUnread(id)
    await loadNotices()
    ElMessage.success('已标为未读')
  } catch {
    setLocalRead(id, true)
    ElMessage.error('标为未读失败')
  }
}

async function markReadAndClose() {
  if (detailRow.value) await markRead(detailRow.value.id)
  detailOpen.value = false
}
</script>

<style scoped>
.un-card :deep(.el-card__header) {
  padding: 14px 18px;
}

.un-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.un-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}

.un-sub {
  display: block;
  font-size: 12px;
  font-weight: normal;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
}

.un-stat {
  display: flex;
  gap: 8px;
  align-items: center;
}

.un-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.un-search {
  width: 280px;
  max-width: 100%;
}

.un-table {
  width: 100%;
}

.un-table :deep(.un-row-unread) {
  background-color: #fdf6f6 !important;
}

.un-table :deep(.un-row-unread:hover > td) {
  background-color: #fce8e8 !important;
}

.un-table :deep(.un-row-read) {
  background-color: #fafafa;
}

.un-status-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.un-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.un-dot.is-unread {
  background: #f56c6c;
  box-shadow: 0 0 0 2px rgba(245, 108, 108, 0.25);
}

.un-dot.is-read {
  background: #c0c4cc;
}

.un-title-unread {
  font-weight: 600;
  color: #303133;
}

.un-detail-meta {
  font-size: 13px;
  color: #909399;
  margin: 0 0 16px;
}

.un-detail-body {
  font-size: 14px;
  line-height: 1.75;
  color: #303133;
}

.un-detail-body :deep(img) {
  max-width: 100%;
  height: auto;
}
</style>
