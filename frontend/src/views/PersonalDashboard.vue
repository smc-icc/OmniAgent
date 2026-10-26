<template>
  <div class="pd">
    <section class="pd-metrics">
      <div class="pd-col pd-col-left">
        <el-card shadow="never" class="pd-card">
          <div class="pd-agent">
            <el-avatar :size="64">{{ profile.name?.slice(0, 1) }}</el-avatar>
            <div>
              <div class="pd-name">{{ profile.name }}</div>
              <div v-if="profile.work_no" class="pd-sub">工号 {{ profile.work_no }}</div>
              <div v-if="profile.extension" class="pd-sub">分机 {{ profile.extension }}</div>
              <div class="pd-sub">{{ profile.department }}</div>
              <div class="pd-sub">{{ profile.title }}</div>
            </div>
          </div>
          <div class="pd-links">
            <el-link type="primary" @click="router.push({ name: 'customers' })">客户管理</el-link>
            <el-link type="primary" @click="router.push({ name: 'rest-requests' })">小休申请记录</el-link>
            <el-link type="primary" @click="router.push({ name: 'settings', query: { tab: 'profile' } })">
              个人信息
            </el-link>
            <el-link type="primary" @click="router.push({ name: 'settings', query: { tab: 'password' } })">
              修改密码
            </el-link>
          </div>
        </el-card>

        <el-card shadow="never" class="pd-card">
          <template #header>快速入口</template>
          <div class="pd-quick">
            <el-button
              v-for="q in visibleQuickLinks"
              :key="q.key"
              text
              type="primary"
              class="pd-quick-btn"
              @click="goQuick(q)"
            >
              {{ q.label }}
            </el-button>
          </div>
        </el-card>

        <el-card shadow="never" class="pd-card pd-memo-card">
          <template #header>
            <div class="pd-card-head">
              <span>备忘录</span>
              <el-button text type="primary" size="small" @click="openMemoDialog()">新增</el-button>
            </div>
          </template>
          <ul v-if="memos.length" class="pd-memo">
            <li v-for="m in memos" :key="m.id" @click="openMemoDialog(m)">
              <span class="pd-memo-title">{{ m.title }}</span>
              <span class="pd-memo-time">{{ m.time_label }}</span>
            </li>
          </ul>
          <el-empty v-else description="暂无备忘" :image-size="48" />
        </el-card>
      </div>

      <div class="pd-col pd-col-center">
        <el-tabs v-model="metricScope">
          <el-tab-pane label="个人指标" name="personal" />
          <el-tab-pane label="团队指标" name="team" />
        </el-tabs>

        <div v-loading="metricsLoading" class="pd-blocks">
          <el-card
            v-for="(b, i) in metricBlocks"
            :key="i"
            shadow="hover"
            class="metric-card"
          >
            <template #header>
              <span>{{ b.title }}</span>
              <span class="metric-count">{{ b.session_count ?? 0 }} 会话</span>
              <el-tag size="small" type="info" class="same-day">{{ periodTag(b) }}</el-tag>
            </template>
            <div class="metric-grid">
              <div>
                <div class="metric-label">平均响应时长</div>
                <div class="metric-val">{{ fmtMetric(b.avg_response_sec, 's') }}</div>
              </div>
              <div>
                <div class="metric-label">平均客户等待时长</div>
                <div class="metric-val">{{ fmtMetric(b.avg_wait_sec, 's') }}</div>
              </div>
              <div>
                <div class="metric-label">平均质检得分</div>
                <div class="metric-val">{{ fmtMetric(b.avg_quality, '分') }}</div>
              </div>
              <div>
                <div class="metric-label">平均满意度</div>
                <div class="metric-val">{{ fmtMetric(b.avg_satisfaction_pct, '%') }}</div>
              </div>
            </div>
          </el-card>
          <el-empty v-if="!metricsLoading && metricBlocks.length === 0" description="暂无指标数据" />
        </div>

        <el-card shadow="never" class="pd-chart-card">
          <template #header>渠道接通量</template>
          <div ref="chartRef" class="pd-chart" />
          <el-empty v-if="!channelVolume.dates.length" description="近 30 天暂无接通数据" :image-size="64" />
        </el-card>
      </div>

      <div class="pd-col pd-col-right">
        <el-card shadow="never" class="pd-card">
          <template #header>
            <div class="pd-card-head">
              <span>公告</span>
              <el-button v-permission="'announcement.create'" text type="primary" size="small" @click="openAnnounceDialog">发布</el-button>
            </div>
          </template>
          <ul v-if="announcements.length" class="pd-announce">
            <li
              v-for="a in announcements"
              :key="a.id"
              class="pd-announce-row"
              @click="router.push({ name: 'business-nav', query: { tile: '最新未读公告信息' } })"
            >
              <span class="dot" :class="`t-${a.type}`" />
              <div>
                <div>{{ a.title }}</div>
                <div class="pd-announce-time">{{ a.time_label }}</div>
              </div>
            </li>
          </ul>
          <el-empty v-else description="暂无未读公告" :image-size="48" />
        </el-card>

        <el-card shadow="never" class="pd-card">
          <template #header>
            <div class="pd-card-head">
              <span>备忘日历</span>
              <el-button text type="primary" size="small" @click="openCalDialog()">新增</el-button>
            </div>
          </template>
          <el-calendar v-model="calendarVal">
            <template #date-cell="{ data }">
              <div class="cal-cell">
                <span>{{ data.day.split('-').slice(2).join('-') }}</span>
                <span v-if="dotsFor(data.day).length" class="cal-dots">
                  <i v-for="(c, idx) in dotsFor(data.day)" :key="idx" :class="c" />
                </span>
              </div>
            </template>
          </el-calendar>
          <div v-if="calendarDetail" class="cal-detail">
            <div><strong>时间</strong> {{ calendarDetail.time || '—' }}</div>
            <div><strong>地点</strong> {{ calendarDetail.location || '—' }}</div>
            <div><strong>内容</strong> {{ calendarDetail.content || '—' }}</div>
            <div><strong>备注</strong> {{ calendarDetail.note || '—' }}</div>
            <div class="cal-detail-actions">
              <el-button text type="primary" size="small" @click="openCalDialog(calendarDetail)">编辑</el-button>
              <el-button text type="danger" size="small" :loading="calDeleting" @click="removeCal">
                删除
              </el-button>
            </div>
          </div>
          <el-empty v-else description="选中日期暂无日程" :image-size="40" />
        </el-card>
      </div>
    </section>

    <el-dialog v-model="memoDlg" :title="memoForm.id ? '编辑备忘' : '新增备忘'" width="420px">
      <el-form label-width="64px">
        <el-form-item label="标题">
          <el-input v-model="memoForm.title" maxlength="80" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="memoForm.content" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="memoForm.id" @click="markMemoDone">完成</el-button>
        <el-button type="primary" :loading="memoSaving" @click="saveMemo">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="calDlg" :title="calForm.id ? '编辑日程' : '新增日程'" width="420px">
      <el-form label-width="64px">
        <el-form-item label="日期">
          <el-date-picker v-model="calForm.date" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="时间">
          <el-input v-model="calForm.time" placeholder="09:00" />
        </el-form-item>
        <el-form-item label="地点">
          <el-input v-model="calForm.location" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="calForm.content" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="calForm.note" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" :loading="calSaving" @click="saveCal">保存</el-button>
      </template>
    </el-dialog>


  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, shallowRef, nextTick } from 'vue'
import { useProductModulesStore } from '@/stores/product-modules'
import { moduleForPage, moduleForTile } from '@/utils/product-modules'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import * as echarts from 'echarts'
import {
  fetchDashboardProfile,
  fetchQuickLinks,
  fetchMemos,
  createMemo,
  patchMemo,
  fetchMetrics,
  fetchChannelVolume,
  fetchAnnouncements,
  syncAnnouncementReads,
  fetchCalendarEvents,
  createCalendarEvent,
  patchCalendarEvent,
  deleteCalendarEvent,
  type DashboardProfile,
  type QuickLink,
  type MemoItem,
  type MetricBlock,
  type ChannelVolumePack,
  type Announcement,
  type CalEvent,
} from '@/api/dashboard'

const router = useRouter()
const metricScope = ref<'personal' | 'team'>('personal')
const metricsLoading = ref(false)
const chartRef = ref<HTMLElement | null>(null)
const chartInst = shallowRef<echarts.ECharts | null>(null)
const calendarVal = ref(new Date())

const profile = ref<DashboardProfile>({
  name: '坐席',
  work_no: '',
  extension: '',
  department: '',
  title: '',
})

const quickLinks = ref<QuickLink[]>([])
const productModules = useProductModulesStore()
const visibleQuickLinks = computed(() => quickLinks.value.filter(item => {
  const module = moduleForTile(item.label) || moduleForPage(item.to || '')
  return !module || productModules.enabled(module)
}))
const memos = ref<MemoItem[]>([])
const metricBlocks = ref<MetricBlock[]>([])
const channelVolume = ref<ChannelVolumePack>({ dates: [], series: [] })
const announcements = ref<Announcement[]>([])
const calendarEvents = ref<CalEvent[]>([])
const calendarDetail = ref<CalEvent | null>(null)

const memoDlg = ref(false)
const memoSaving = ref(false)
const memoForm = ref({ id: '', title: '', content: '' })

const calDlg = ref(false)
const calSaving = ref(false)
const calDeleting = ref(false)
const calForm = ref({ id: '', date: '', time: '09:00', location: '', content: '', note: '' })


function fmtMetric(v: number | null | undefined, suffix: string) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return `${v}${suffix}`
}

function periodTag(b: MetricBlock) {
  if (b.period === 'today' || b.title.includes('今日')) return '今日'
  if (b.period === 'week' || b.title.includes('本周')) return '本周'
  if (b.period === 'month' || b.title.includes('本月')) return '本月'
  return '统计'
}

function goQuick(q: QuickLink) {
  router.push({ path: q.to, query: q.query })
}

function dotsFor(day: string): string[] {
  const ev = calendarEvents.value.find((e) => e.date === day)
  return ev?.kinds.map((k) => `dot-${k}`) ?? []
}

function syncCalendarDetail() {
  const d = calendarVal.value
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  calendarDetail.value = calendarEvents.value.find((e) => e.date === key) ?? null
}

watch(calendarVal, () => {
  syncCalendarDetail()
  void loadCalendar()
})

watch(metricScope, () => {
  void loadMetrics()
})

async function loadProfile() {
  try {
    profile.value = await fetchDashboardProfile()
  } catch {
    /* keep */
  }
}

async function loadQuick() {
  try {
    quickLinks.value = await fetchQuickLinks()
  } catch {
    quickLinks.value = []
  }
}

async function loadMemos() {
  try {
    memos.value = await fetchMemos()
  } catch {
    memos.value = []
  }
}

async function loadMetrics() {
  metricsLoading.value = true
  try {
    metricBlocks.value = await fetchMetrics(metricScope.value)
  } catch {
    metricBlocks.value = []
  } finally {
    metricsLoading.value = false
  }
}

async function loadVolume() {
  try {
    channelVolume.value = await fetchChannelVolume()
  } catch {
    channelVolume.value = { dates: [], series: [] }
  }
}

const LOCAL_READ_KEY = 'oa_notice_read_ids_v1'

async function migrateLocalAnnouncementReads() {
  try {
    const raw = localStorage.getItem(LOCAL_READ_KEY)
    if (!raw) return
    const arr = JSON.parse(raw) as unknown
    const ids = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    if (ids.length) await syncAnnouncementReads(ids)
    localStorage.removeItem(LOCAL_READ_KEY)
  } catch {
    /* 旧本地已读同步失败时仍按服务端结果展示 */
  }
}

async function loadAnnouncements() {
  try {
    await migrateLocalAnnouncementReads()
    announcements.value = await fetchAnnouncements({ unreadOnly: true })
  } catch {
    announcements.value = []
  }
}

async function loadCalendar() {
  const d = calendarVal.value
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  try {
    calendarEvents.value = await fetchCalendarEvents(month)
  } catch {
    calendarEvents.value = []
  }
  syncCalendarDetail()
}

function openMemoDialog(m?: MemoItem) {
  memoForm.value = {
    id: m?.id ?? '',
    title: m?.title ?? '',
    content: m?.content ?? '',
  }
  memoDlg.value = true
}

async function saveMemo() {
  if (!memoForm.value.title.trim()) {
    ElMessage.warning('请填写标题')
    return
  }
  memoSaving.value = true
  try {
    if (memoForm.value.id) {
      await patchMemo(memoForm.value.id, {
        title: memoForm.value.title,
        content: memoForm.value.content,
      })
    } else {
      await createMemo({
        title: memoForm.value.title,
        content: memoForm.value.content,
      })
    }
    memoDlg.value = false
    await loadMemos()
  } catch {
    ElMessage.error('保存失败')
  } finally {
    memoSaving.value = false
  }
}

async function markMemoDone() {
  if (!memoForm.value.id) return
  memoSaving.value = true
  try {
    await patchMemo(memoForm.value.id, { done: true })
    memoDlg.value = false
    await loadMemos()
  } catch {
    ElMessage.error('操作失败')
  } finally {
    memoSaving.value = false
  }
}

function openCalDialog(ev?: CalEvent | null) {
  const d = calendarVal.value
  if (ev?.id) {
    calForm.value = {
      id: ev.id,
      date: ev.date,
      time: ev.time || '09:00',
      location: ev.location || '',
      content: ev.content || '',
      note: ev.note || '',
    }
  } else {
    calForm.value = {
      id: '',
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      time: '09:00',
      location: '',
      content: '',
      note: '',
    }
  }
  calDlg.value = true
}

async function saveCal() {
  if (!calForm.value.date || !calForm.value.content.trim()) {
    ElMessage.warning('请填写日期与内容')
    return
  }
  calSaving.value = true
  try {
    const payload = {
      date: calForm.value.date,
      time: calForm.value.time,
      location: calForm.value.location,
      content: calForm.value.content,
      note: calForm.value.note,
      kinds: ['meeting'] as string[],
    }
    if (calForm.value.id) {
      await patchCalendarEvent(calForm.value.id, payload)
    } else {
      await createCalendarEvent(payload)
    }
    calDlg.value = false
    await loadCalendar()
  } catch {
    ElMessage.error('保存失败')
  } finally {
    calSaving.value = false
  }
}

async function removeCal() {
  const id = calendarDetail.value?.id
  if (!id) return
  calDeleting.value = true
  try {
    await deleteCalendarEvent(id)
    ElMessage.success('已删除')
    await loadCalendar()
  } catch {
    ElMessage.error('删除失败')
  } finally {
    calDeleting.value = false
  }
}

function openAnnounceDialog() {
  router.push({ name: 'business-nav', query: { tile: '公告信息管理', tab: 'publish' } })
}

function renderChart() {
  const el = chartRef.value
  if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
  const dates = channelVolume.value.dates
  if (!dates.length) {
    chartInst.value?.clear()
    return
  }

  if (!chartInst.value) {
    chartInst.value = echarts.init(el)
  }
  const palette = ['#7ec8f0', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272']
  const series = (channelVolume.value.series.length
    ? channelVolume.value.series
    : [{ channel_name: '接通量', data: dates.map(() => 0) }]
  ).map((s, i) => ({
    name: s.channel_name,
    type: 'bar' as const,
    stack: 'vol',
    data: s.data,
    itemStyle: { color: palette[i % palette.length] },
    barMaxWidth: 18,
  }))
  const maxVal = Math.max(
    1,
    ...series.map((s) => Math.max(0, ...s.data.map((_n, idx) =>
      series.reduce((sum, x) => sum + (x.data[idx] ?? 0), 0),
    ))),
  )
  chartInst.value.setOption(
    {
      color: palette,
      grid: { left: 44, right: 16, top: 28, bottom: 72 },
      legend: { bottom: 4, type: 'scroll' },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: {
          fontSize: 11,
          hideOverlap: true,
          formatter: (v: string) => (v.length >= 10 ? v.slice(5) : v),
        },
      },
      yAxis: { type: 'value', minInterval: 1, max: Math.ceil(maxVal * 1.2) },
      series,
    },
    true,
  )
  chartInst.value.resize()
}

function scheduleChartRender() {
  nextTick(() => {
    requestAnimationFrame(() => {
      renderChart()
    })
  })
}

watch(channelVolume, scheduleChartRender, { deep: true })

onMounted(async () => {
  await Promise.all([
    loadProfile(),
    loadQuick(),
    loadMemos(),
    loadMetrics(),
    loadVolume(),
    loadAnnouncements(),
    loadCalendar(),
  ])
  scheduleChartRender()
  window.addEventListener('resize', onResize)
})

function onResize() {
  chartInst.value?.resize()
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chartInst.value?.dispose()
  chartInst.value = null
})
</script>

<style scoped>
.pd {
  width: 100%;
  max-width: none;
}

.pd-metrics {
  display: grid;
  grid-template-columns: 240px 1fr 300px;
  gap: 12px;
  align-items: start;
}

@media (max-width: 1400px) {
  .pd-metrics {
    grid-template-columns: 220px 1fr 280px;
  }
}

.pd-col :deep(.el-card__header) {
  padding: 10px 14px;
  font-weight: 600;
}

.pd-card {
  margin-bottom: 12px;
}

.pd-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.pd-agent {
  display: flex;
  gap: 12px;
  align-items: center;
}
.pd-name {
  font-weight: 700;
  font-size: 16px;
}
.pd-sub {
  font-size: 12px;
  color: var(--oa-muted);
}
.pd-links {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.pd-quick {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 8px;
}
.pd-quick-btn {
  justify-content: flex-start;
  padding: 4px 0;
}

.pd-memo {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
}
.pd-memo li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed #ebeef5;
  cursor: pointer;
}
.pd-memo-time {
  color: var(--oa-muted);
  flex-shrink: 0;
}

.pd-blocks {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
  min-height: 80px;
}

.metric-card :deep(.el-card__header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.metric-count {
  margin-left: auto;
  font-size: 13px;
  font-weight: 600;
  color: var(--oa-primary);
}
.same-day {
  margin-left: 0;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 16px;
}
.metric-label {
  font-size: 12px;
  color: var(--oa-muted);
}
.metric-val {
  font-size: 20px;
  font-weight: 700;
  color: var(--oa-primary);
}

.pd-chart-card :deep(.el-card__body) {
  padding-top: 0;
  position: relative;
}
.pd-chart {
  height: 320px;
  width: 100%;
}

.pd-announce {
  list-style: none;
  padding: 0;
  margin: 0;
}
.pd-announce-row {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #ebeef5;
  font-size: 13px;
  cursor: pointer;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
}
.t-system {
  background: #409eff;
}
.t-exam {
  background: #e6a23c;
}
.t-training {
  background: #67c23a;
}
.t-emergency {
  background: #f56c6c;
}
.pd-announce-time {
  font-size: 12px;
  color: var(--oa-muted);
  margin-top: 4px;
}

.cal-cell {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 12px;
}
.cal-dots {
  display: flex;
  gap: 2px;
  margin-top: 2px;
}
.cal-dots i {
  width: 4px;
  height: 4px;
  border-radius: 1px;
  display: inline-block;
}
.dot-training {
  background: #67c23a;
}
.dot-exam {
  background: #e6a23c;
}
.dot-shift {
  background: #409eff;
}
.dot-meeting {
  background: #909399;
}

.cal-detail {
  margin-top: 12px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.7;
}
.cal-detail-actions {
  margin-top: 8px;
  display: flex;
  gap: 4px;
}

.pd-memo-card {
  max-height: 280px;
}
.pd-memo-card :deep(.el-card__body) {
  max-height: 180px;
  overflow: auto;
}

.pd-col-center :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
</style>
