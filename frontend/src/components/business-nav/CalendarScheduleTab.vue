<template>
  <el-card shadow="never" class="bn-card bn-calendar">
    <div class="cal-shell">
      <div class="cal-top-tabs">
        <div class="cal-top-tabs-left">
          <span :class="{ 'is-active': sideTab === 'calendar' }" @click="sideTab = 'calendar'">Calendar</span>
          <span :class="{ 'is-active': sideTab === 'rooms' }" @click="sideTab = 'rooms'">Rooms</span>
          <span :class="{ 'is-active': sideTab === 'scheduler' }" @click="sideTab = 'scheduler'">Scheduler</span>
        </div>
        <div v-if="sideTab === 'scheduler'" class="cal-top-tabs-right">
          <el-dropdown trigger="click" @command="onSchedulerCreate">
            <el-button type="primary" size="small">
              Create
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="meeting">会议预约</el-dropdown-item>
                <el-dropdown-item command="block">预留时段</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button size="small" text :icon="Setting" title="设置" />
          <el-button size="small" text :icon="QuestionFilled" title="帮助" />
        </div>
      </div>

      <div class="cal-body" :class="{ 'cal-body--full': sideTab === 'rooms' || sideTab === 'scheduler' }">
        <aside v-if="sideTab === 'calendar'" class="cal-side">
          <div class="cal-mini">
            <el-calendar v-model="calendarDate">
              <template #date-cell="{ data }">
                <div
                  class="mini-day"
                  :class="{
                    'is-linked-week': isLinkedWeekDay(data.day),
                    'is-selected': data.isSelected,
                    'is-other-month': data.type !== 'current-month',
                  }"
                >
                  {{ getDayNumber(data.day) }}
                </div>
              </template>
            </el-calendar>
          </div>
          <el-input size="small" placeholder="Search contacts or calendars" class="cal-search" />
          <div class="cal-list-title">+ Add Calendar</div>
          <ul class="cal-list">
            <li><span class="dot dot-blue" />丁德华 (Ding Dehua)</li>
            <li><span class="dot dot-green" />My tasks</li>
          </ul>
        </aside>

      <section class="cal-main">
        <template v-if="sideTab === 'calendar'">
          <div class="cal-toolbar">
            <div class="left">
              <el-button size="small" @click="goToday">Today</el-button>
              <el-button size="small" @click="shiftPeriod(-1)">‹</el-button>
              <el-button size="small" @click="shiftPeriod(1)">›</el-button>
              <span class="range">{{ rangeText }}</span>
            </div>
            <div class="right">
              <el-button-group>
                <el-button size="small" :type="viewMode === 'day' ? 'primary' : 'default'" @click="viewMode = 'day'">Day</el-button>
                <el-button size="small" :type="viewMode === 'week' ? 'primary' : 'default'" @click="viewMode = 'week'">Week</el-button>
                <el-button size="small" :type="viewMode === 'month' ? 'primary' : 'default'" @click="viewMode = 'month'">Month</el-button>
              </el-button-group>
            </div>
          </div>

          <div v-if="viewMode === 'week'" class="cal-week-head">
            <div class="time-col" />
            <div v-for="d in weekDays" :key="d.key" class="day-col">
              <div class="dow">{{ d.dow }}</div>
              <div class="dom">{{ d.dom }}</div>
            </div>
          </div>

          <div v-if="viewMode === 'week'" class="cal-grid">
            <div v-for="hour in timeSlots" :key="hour" class="cal-row">
              <div class="time-col">{{ formatHour(hour) }}</div>
              <div
                v-for="d in weekDays"
                :key="`${d.key}-${hour}`"
                class="cell"
              >
                <div
                  v-for="ev in eventsByCell(d.idx, hour)"
                  :key="ev.id"
                  class="event-chip"
                  :class="ev.color"
                >
                  {{ ev.title }}
                </div>
              </div>
            </div>
          </div>

          <template v-else-if="viewMode === 'day'">
            <div class="cal-day-head">
              <div class="time-col" />
              <div class="day-col">
                <div class="day-title">{{ dayTitle }}</div>
                <div class="day-owner">丁德华 (Ding Dehua)</div>
              </div>
            </div>

            <div class="cal-grid cal-grid-day">
              <div v-for="hour in timeSlots" :key="`d-${hour}`" class="cal-row cal-row-day">
                <div class="time-col">{{ formatHour(hour) }}</div>
                <div class="cell">
                  <div
                    v-for="ev in eventsByDayHour(hour)"
                    :key="ev.id"
                    class="event-chip"
                    :class="ev.color"
                  >
                    {{ ev.title }}
                  </div>
                  <div v-if="isTodaySelected && currentHour === hour" class="now-line" />
                </div>
              </div>
            </div>
          </template>

          <div v-else class="cal-month-wrap">
            <el-calendar v-model="calendarDate" />
          </div>
        </template>

        <template v-else-if="sideTab === 'rooms'">
          <div class="rooms-toolbar">
            <div class="rooms-toolbar-left">
              <el-button size="small" @click="goToday">Today</el-button>
              <el-button size="small" @click="shiftRoomsDay(-1)">‹</el-button>
              <el-button size="small" @click="shiftRoomsDay(1)">›</el-button>
              <el-date-picker
                v-model="calendarDate"
                type="date"
                size="small"
                class="rooms-date"
                format="ddd, MMM D, YYYY"
                :clearable="false"
              />
            </div>
            <div class="rooms-toolbar-filters">
              <el-select v-model="roomsLocation" size="small" placeholder="位置" style="width: 200px">
                <el-option label="生生广场4栋 · All" value="sq4-all" />
                <el-option label="总部大厦 · All" value="hq-all" />
              </el-select>
              <el-select v-model="roomsDevice" size="small" placeholder="设备" clearable style="width: 140px">
                <el-option label="TV / 白板" value="tv" />
                <el-option label="视频会议" value="vc" />
              </el-select>
              <el-input-number v-model="roomsCapacity" size="small" :min="1" :max="50" placeholder="人数" controls-position="right" style="width: 110px" />
              <el-button size="small" :icon="Refresh" circle @click="roomsTick += 1" />
            </div>
          </div>

          <div class="rooms-scroll">
            <div class="rooms-grid">
              <div class="rooms-col-rooms">
                <div class="rooms-corner">Rooms</div>
                <div v-for="room in roomRows" :key="room.id" class="rooms-room-cell">
                  <div class="rooms-room-name">{{ room.name }}</div>
                  <div class="rooms-room-meta">
                    <el-icon class="rooms-cap-icon"><User /></el-icon>
                    <span class="rooms-cap">{{ room.capacity }}</span>
                    <span class="rooms-devices">{{ room.devices }}</span>
                  </div>
                </div>
              </div>
              <div class="rooms-col-timeline">
                <div class="rooms-time-header">
                  <div
                    v-for="h in roomsHourSlots"
                    :key="h"
                    class="rooms-hour-col"
                  >
                    {{ formatRoomsHour(h) }}
                  </div>
                </div>
                <div class="rooms-body">
                  <div v-for="room in roomRows" :key="`row-${room.id}`" class="rooms-timeline-row">
                    <div
                      v-for="h in roomsHourSlots"
                      :key="`${room.id}-${h}`"
                      class="rooms-hour-cell"
                    />
                  </div>
                </div>
                <div
                  v-if="roomsShowNowLine"
                  class="rooms-now-vline-overlay"
                  :style="{ left: roomsNowLineLeft }"
                >
                  <span class="rooms-now-label">{{ roomsNowTimeLabel }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="sch-wrap">
            <div class="sch-profile">
              <el-avatar :size="40" class="sch-avatar">{{ schedulerUser.initial }}</el-avatar>
              <span class="sch-name">{{ schedulerUser.name }}</span>
            </div>
            <div class="sch-cards">
              <div v-for="card in schedulerCards" :key="card.id" class="sch-card">
                <div class="sch-card-head">
                    <el-dropdown trigger="click" @command="(cmd: string | number | object) => onSchCardMore(card.id, cmd)">
                    <el-button text class="sch-card-more" :icon="MoreFilled" circle />
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="edit">编辑</el-dropdown-item>
                        <el-dropdown-item command="delete">删除</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
                <div class="sch-card-body">
                  <div class="sch-card-title">{{ card.title }}</div>
                  <div class="sch-card-desc">{{ card.desc }}</div>
                </div>
                <div class="sch-card-foot">
                  <el-button text class="sch-foot-icon" :icon="Monitor" title="预览" />
                  <el-button class="sch-copy-link" size="small" plain @click="copySchedulerLink(card)">
                    <el-icon><Link /></el-icon>
                    Copy Link
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ArrowDown,
  Link,
  Monitor,
  MoreFilled,
  QuestionFilled,
  Refresh,
  Setting,
  User,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

interface CalendarEvent {
  id: string
  dayIdx: number
  hour: number
  title: string
  color: 'blue' | 'orange' | 'green'
}

const calendarDate = ref(new Date())
const sideTab = ref<'calendar' | 'rooms' | 'scheduler'>('calendar')
const viewMode = ref<'day' | 'week' | 'month'>('week')
const roomsTick = ref(0)
const roomsHourSlots = Array.from({ length: 17 }, (_, i) => i + 7)
const roomsLocation = ref('sq4-all')
const roomsDevice = ref<string | undefined>(undefined)
const roomsCapacity = ref<number | undefined>(undefined)

interface RoomRow {
  id: string
  name: string
  capacity: number
  devices: string
}

const roomRows = ref<RoomRow[]>([
  { id: 'r1', name: '17楼-华工', capacity: 6, devices: 'TV-Whiteboard' },
  { id: 'r2', name: '17楼-腾学', capacity: 4, devices: 'TV-Video conferencing equip...' },
  { id: 'r3', name: '18楼-会议室A', capacity: 7, devices: 'TV · 投影' },
  { id: 'r4', name: '18楼-会议室B', capacity: 8, devices: 'Whiteboard' },
])

const schedulerUser = { name: '丁康怀', initial: '丁' }

interface SchedulerCard {
  id: string
  title: string
  desc: string
  slug: string
}

const schedulerCards = ref<SchedulerCard[]>([
  { id: 'sch1', title: '15-Minute Meeting', desc: '15 min, One-on-One', slug: '15m' },
  { id: 'sch2', title: '30-Minute Meeting', desc: '30 min, One-on-One', slug: '30m' },
])

function onSchedulerCreate(cmd: string) {
  ElMessage.info(cmd === 'meeting' ? '创建会议预约（可对接接口）' : '预留时段（可对接接口）')
}

function onSchCardMore(id: string, cmd: string | number | object) {
  const s = String(cmd)
  ElMessage.info(`卡片 ${id}: ${s === 'edit' ? '编辑' : '删除'}（占位）`)
}

function copySchedulerLink(card: SchedulerCard) {
  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/schedule/${card.slug}`
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(url).then(() => ElMessage.success('链接已复制'))
  } else {
    ElMessage.info(`预约链接：${url}`)
  }
}
const timeSlots = Array.from({ length: 18 }, (_, i) => i + 6)
const calendarEvents = ref<CalendarEvent[]>([
  { id: 'e1', dayIdx: 1, hour: 9, title: '服务团队例会', color: 'blue' },
  { id: 'e2', dayIdx: 2, hour: 14, title: '工单复盘', color: 'orange' },
  { id: 'e3', dayIdx: 4, hour: 11, title: '坐席培训', color: 'green' },
  { id: 'e4', dayIdx: 5, hour: 16, title: '客户回访', color: 'blue' },
])

function startOfWeek(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return x
}

const weekStart = computed(() => startOfWeek(calendarDate.value))
const weekDays = computed(() => {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return Array.from({ length: 7 }, (_, idx) => {
    const d = new Date(weekStart.value)
    d.setDate(d.getDate() + idx)
    return {
      idx,
      key: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
      dow: names[idx],
      dom: `${d.getMonth() + 1}/${d.getDate()}`,
    }
  })
})

const weekRangeText = computed(() => {
  const s = weekDays.value[0]
  const e = weekDays.value[6]
  return `${s.dom} - ${e.dom}, ${new Date(weekStart.value).getFullYear()}`
})
const dayTitle = computed(() =>
  calendarDate.value.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }),
)
const rangeText = computed(() => {
  if (viewMode.value === 'week') return weekRangeText.value
  if (viewMode.value === 'day') return dayTitle.value
  return calendarDate.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})
const selectedDayIdx = computed(() => calendarDate.value.getDay())
const isTodaySelected = computed(() => {
  const t = new Date()
  return (
    t.getFullYear() === calendarDate.value.getFullYear()
    && t.getMonth() === calendarDate.value.getMonth()
    && t.getDate() === calendarDate.value.getDate()
  )
})
const currentHour = computed(() => new Date().getHours())

const ROOM_SLOT_MINUTES = roomsHourSlots.length * 60

function shiftRoomsDay(step: number) {
  const d = new Date(calendarDate.value)
  d.setDate(d.getDate() + step)
  calendarDate.value = d
}

function formatRoomsHour(hour: number) {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}

const roomsShowNowLine = computed(() => {
  const t = new Date()
  const c = calendarDate.value
  return (
    t.getFullYear() === c.getFullYear()
    && t.getMonth() === c.getMonth()
    && t.getDate() === c.getDate()
  )
})

const roomsNowTimeLabel = computed(() => {
  roomsTick.value
  const t = new Date()
  return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
})

const roomsNowLineLeft = computed(() => {
  roomsTick.value
  if (!roomsShowNowLine.value) return '0%'
  const t = new Date()
  const mins = t.getHours() * 60 + t.getMinutes()
  const from7 = mins - 7 * 60
  const clamped = Math.max(0, Math.min(ROOM_SLOT_MINUTES, from7))
  const pct = (clamped / ROOM_SLOT_MINUTES) * 100
  return `${pct}%`
})

let roomsTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  roomsTimer = setInterval(() => {
    roomsTick.value += 1
  }, 30_000)
})
onUnmounted(() => {
  if (roomsTimer) clearInterval(roomsTimer)
})

function formatHour(hour: number) {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const h = hour % 12 || 12
  return `${h}:00 ${suffix}`
}

function eventsByCell(dayIdx: number, hour: number) {
  return calendarEvents.value.filter((x) => x.dayIdx === dayIdx && x.hour === hour)
}

function eventsByDayHour(hour: number) {
  return calendarEvents.value.filter((x) => x.dayIdx === selectedDayIdx.value && x.hour === hour)
}

function shiftPeriod(step: number) {
  const d = new Date(calendarDate.value)
  if (viewMode.value === 'week') d.setDate(d.getDate() + step * 7)
  else if (viewMode.value === 'day') d.setDate(d.getDate() + step)
  else d.setMonth(d.getMonth() + step)
  calendarDate.value = d
}

function goToday() {
  calendarDate.value = new Date()
}

function toDate(day: string) {
  // Element Plus day string: YYYY-MM-DD
  const [y, m, d] = day.split('-').map((x) => Number(x))
  return new Date(y, m - 1, d)
}

function isLinkedWeekDay(day: string) {
  if (viewMode.value !== 'week') return false
  const d = toDate(day)
  const start = weekStart.value.getTime()
  const end = start + 6 * 24 * 60 * 60 * 1000
  const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return cur >= start && cur <= end
}

function getDayNumber(day: string) {
  return toDate(day).getDate()
}
</script>

<style scoped>
.bn-calendar {
  padding: 4px;
}
.cal-shell {
  display: flex;
  flex-direction: column;
  min-height: 620px;
  border: 1px solid #ebeef5;
}
.cal-top-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid #ebeef5;
  background: #fafafa;
  flex-shrink: 0;
}
.cal-top-tabs-left {
  display: flex;
  gap: 18px;
  font-size: 12px;
}
.cal-top-tabs-left span {
  color: #606266;
  cursor: pointer;
  padding-bottom: 4px;
}
.cal-top-tabs-left .is-active {
  color: #409eff;
  font-weight: 600;
  border-bottom: 2px solid #409eff;
}
.cal-top-tabs-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.cal-body {
  display: grid;
  grid-template-columns: 260px 1fr;
  flex: 1;
  min-height: 0;
}
.cal-body--full {
  grid-template-columns: 1fr;
}
.cal-side {
  border-right: 1px solid #ebeef5;
  padding: 8px;
  background: #fafafa;
  min-width: 0;
}
.cal-mini {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.cal-mini :deep(.el-calendar__header) {
  padding: 8px 10px;
}
.cal-mini :deep(.el-calendar-table .el-calendar-day) {
  height: 24px;
  padding: 0;
}
.mini-day {
  height: 24px;
  line-height: 24px;
  text-align: center;
  font-size: 12px;
  border-radius: 12px;
}
.mini-day.is-linked-week {
  background: #eceff4;
  color: #606266;
}
.mini-day.is-selected {
  background: #d9ecff;
  color: #1d6fd8;
  border: 1px solid #409eff;
  box-sizing: border-box;
}
.mini-day.is-other-month {
  color: #b1b3b8;
}
.cal-search {
  margin-top: 10px;
}
.cal-list-title {
  margin-top: 12px;
  font-size: 12px;
  color: #606266;
}
.cal-list {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
  font-size: 12px;
  color: #606266;
}
.cal-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}
.dot-blue {
  background: #409eff;
}
.dot-green {
  background: #67c23a;
}
.cal-main {
  background: #fff;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1;
}
.cal-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
}
.cal-toolbar .left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cal-toolbar .range {
  margin-left: 6px;
  font-size: 13px;
  color: #303133;
  font-weight: 600;
}
.cal-week-head {
  display: grid;
  grid-template-columns: 72px repeat(7, minmax(120px, 1fr));
  border-bottom: 1px solid #ebeef5;
}
.cal-week-head .day-col {
  padding: 8px 10px;
  border-left: 1px solid #f0f2f5;
}
.cal-week-head .dow {
  color: #909399;
  font-size: 12px;
}
.cal-week-head .dom {
  color: #303133;
  font-size: 13px;
  margin-top: 2px;
}
.cal-day-head {
  display: grid;
  grid-template-columns: 72px minmax(420px, 1fr);
  border-bottom: 1px solid #ebeef5;
}
.cal-day-head .day-col {
  padding: 8px 10px;
  border-left: 1px solid #f0f2f5;
}
.cal-day-head .day-title {
  color: #409eff;
  font-size: 13px;
  font-weight: 600;
}
.cal-day-head .day-owner {
  margin-top: 4px;
  font-size: 12px;
  color: #303133;
}
.cal-grid {
  flex: 1;
  overflow: auto;
}
.cal-row {
  display: grid;
  grid-template-columns: 72px repeat(7, minmax(120px, 1fr));
  min-height: 40px;
  border-bottom: 1px solid #f5f7fa;
}
.cal-row .time-col {
  padding: 6px 8px;
  color: #909399;
  font-size: 11px;
  text-align: right;
}
.cal-row .cell {
  border-left: 1px solid #f5f7fa;
  padding: 3px 4px;
  position: relative;
}
.cal-grid-day .cal-row-day {
  grid-template-columns: 72px minmax(420px, 1fr);
}
.now-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1px solid #f56c6c;
}
.now-line::before {
  content: '';
  position: absolute;
  left: -3px;
  top: -3px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #f56c6c;
}
.event-chip {
  font-size: 11px;
  border-radius: 3px;
  padding: 2px 5px;
  margin: 1px 0;
  line-height: 1.3;
  width: fit-content;
}
.event-chip.blue {
  background: #e8f3ff;
  color: #1d6fd8;
}
.event-chip.orange {
  background: #fff3e6;
  color: #b75a00;
}
.event-chip.green {
  background: #ebf8ed;
  color: #2f8a3d;
}
.cal-month-wrap {
  flex: 1;
  overflow: auto;
}
.cal-month-wrap :deep(.el-calendar__header) {
  padding: 10px 12px;
}

.rooms-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
}
.rooms-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rooms-toolbar-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rooms-date {
  width: 200px;
}
.rooms-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.rooms-grid {
  display: flex;
  min-width: min-content;
}
.rooms-col-rooms {
  width: 220px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #ebeef5;
  position: sticky;
  left: 0;
  z-index: 4;
}
.rooms-corner {
  height: 40px;
  line-height: 40px;
  padding: 0 12px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid #ebeef5;
}
.rooms-room-cell {
  min-height: 72px;
  padding: 10px 12px;
  border-bottom: 1px solid #f5f7fa;
  box-sizing: border-box;
}
.rooms-room-name {
  font-weight: 600;
  font-size: 13px;
  color: #303133;
}
.rooms-room-meta {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.rooms-cap-icon {
  font-size: 14px;
}
.rooms-devices {
  margin-left: 4px;
}
.rooms-col-timeline {
  flex: 1;
  min-width: 1360px;
  position: relative;
  background: #fff;
}
.rooms-time-header {
  display: flex;
  height: 40px;
  align-items: center;
  border-bottom: 1px solid #ebeef5;
}
.rooms-hour-col {
  width: 80px;
  flex-shrink: 0;
  text-align: center;
  font-size: 12px;
  color: #606266;
  border-left: 1px solid #f5f7fa;
  box-sizing: border-box;
}
.rooms-timeline-row {
  display: flex;
  min-height: 72px;
  border-bottom: 1px solid #f5f7fa;
}
.rooms-hour-cell {
  width: 80px;
  flex-shrink: 0;
  border-left: 1px solid #f5f7fa;
  background: #fcfcfc;
  box-sizing: border-box;
}
.rooms-now-vline-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px solid #f56c6c;
  z-index: 3;
  pointer-events: none;
}
.rooms-now-label {
  position: absolute;
  top: 4px;
  left: 0;
  transform: translateX(-50%);
  font-size: 11px;
  color: #f56c6c;
  white-space: nowrap;
  background: #fff;
  padding: 0 2px;
}
.sch-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 24px;
  background: #f2f4f7;
}
.sch-profile {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.sch-avatar {
  background: #409eff;
  color: #fff;
  font-weight: 600;
}
.sch-name {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.sch-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.sch-card {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  border: 1px solid #ebeef5;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}
.sch-card-head {
  position: absolute;
  top: 8px;
  right: 6px;
  z-index: 1;
}
.sch-card-more {
  padding: 4px;
}
.sch-card-body {
  padding: 18px 16px 12px;
  flex: 1;
}
.sch-card-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  padding-right: 32px;
}
.sch-card-desc {
  margin-top: 8px;
  font-size: 13px;
  color: #909399;
  line-height: 1.4;
}
.sch-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-top: 1px solid #ebeef5;
  background: #fafafa;
}
.sch-foot-icon {
  color: #909399;
}
.sch-copy-link {
  border-color: #409eff;
  color: #409eff;
}
.sch-copy-link:hover {
  color: #66b1ff;
  border-color: #66b1ff;
  background: #ecf5ff;
}

@media (max-width: 1280px) {
  .cal-body:not(.cal-body--full) {
    grid-template-columns: 1fr;
  }
  .cal-side {
    border-right: 0;
    border-bottom: 1px solid #ebeef5;
  }
  .cal-week-head,
  .cal-row {
    grid-template-columns: 64px repeat(7, minmax(100px, 1fr));
  }
  .cal-day-head,
  .cal-grid-day .cal-row-day {
    grid-template-columns: 64px minmax(240px, 1fr);
  }
}
</style>
