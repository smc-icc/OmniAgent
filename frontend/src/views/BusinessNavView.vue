<template>
  <div class="bn-page">
    <div class="bn-tab-head">
      <div
        v-for="(tab, tabIdx) in headTabs"
        :key="tab.id"
        class="bn-tab-item"
        :class="{ 'is-active': activeHeadTab === tab.id }"
        @click="activeHeadTab = tab.id"
      >
        <span class="bn-tab-title">{{ tab.label }}</span>
        <el-dropdown
          trigger="click"
          @command="(cmd: string | number | object) => onTabHeadMenu(tab.id, tabIdx, String(cmd))"
          @click.stop
        >
          <span class="bn-tab-menu-trigger" @click.stop>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="current" :disabled="tab.fixed">关闭当前</el-dropdown-item>
              <el-dropdown-item command="all" :disabled="!hasAnyClosableTab">关闭所有</el-dropdown-item>
              <el-dropdown-item command="left" :disabled="!hasClosableLeft(tabIdx)">关闭左边所有</el-dropdown-item>
              <el-dropdown-item command="right" :disabled="!hasClosableRight(tabIdx)">关闭右边所有</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <template v-if="activeHeadTab === ENTRANCE_TAB_ID">
      <el-card shadow="never" class="bn-card">
        <template #header>
          <span class="bn-head">功能入口</span>
          <span class="bn-sub">点击下方模块进入对应业务（可对接路由或外链）</span>
        </template>
        <el-input
          v-model="tileQuery"
          placeholder="搜索功能模块"
          clearable
          class="bn-search"
        />
        <div class="bn-tiles">
          <div
            v-for="label in filteredTiles"
            :key="label"
            class="bn-tile"
            @click="openOrFocusTileTab(label)"
          >
            <div class="bn-tile-icon">
              <el-icon :size="28"><Grid /></el-icon>
            </div>
            <span>{{ label }}</span>
          </div>
        </div>
        <el-empty v-if="filteredTiles.length === 0" description="无匹配功能" />
      </el-card>
    </template>

    <CalendarScheduleTab v-else-if="isCalendarTab" />

    <WorkMemoTab v-else-if="isWorkMemoTab" />

    <NoticeManageTab v-else-if="isNoticeManageTab" />

    <UnreadNoticeTab v-else-if="isUnreadNoticeTab" />

    <TrainingExamTab v-else-if="isTrainingExamTab" />

    <PersonalPerformanceTab v-else-if="isPersonalPerformanceTab" />

    <SurveyQuestionnaireTab v-else-if="isSurveyQuestionnaireTab" />

    <RedBlackListTab v-else-if="isRedBlackListTab" />

    <SmsManagementTab v-else-if="isSmsManagementTab" />

    <SatisfactionManagementTab v-else-if="isSatisfactionManagementTab" />

    <SuggestionManagementTab v-else-if="isSuggestionManagementTab" />

    <PerformanceManagementTab v-else-if="isPerformanceManagementTab" />

    <AttendanceSchedulingTab v-else-if="isAttendanceSchedulingTab" />

    <AgentShiftScheduleTab v-else-if="isAgentShiftTab" />

    <CallCenterSpecialtyTab v-else-if="isSpecialtyManagementTab" />

    <MealOrderingTab v-else-if="isMealOrderingTab" />

    <MonitoringDispatchTab v-else-if="isMonitoringDispatchTab" />

    <CallCenterBITab v-else-if="isReportManagementTab" />

    <PlatformConfigTab v-else-if="isPlatformConfigTab" />

    <el-card v-else-if="isWeeklyPendingTab" shadow="never" class="bn-card bn-weekly">
      <div class="wk-top-tabs">
        <span class="wk-tab is-active">回访内容</span>
        <span class="wk-tab">用户标签</span>
        <span class="wk-tab">费用明细</span>
        <span class="wk-tab">历史跟踪</span>
        <span class="wk-tab">历史投诉</span>
        <span class="wk-tab">历史回访</span>
      </div>

      <div class="wk-notice">公告：这里是公告信息这里是公告信息这里是公告信息这里是公告信息这里是公告信息</div>

      <div class="wk-form-grid">
        <div class="wk-item"><label>服务系统</label><el-input value="张学友" size="small" /></div>
        <div class="wk-item"><label>联系人电话1</label><el-input value="13800138000" size="small" /></div>
        <div class="wk-item"><label>联系人电话2</label><el-input value="13800138000" size="small" /></div>
        <div class="wk-item"><label>联系人电话3</label><el-input value="13800138000" size="small" /></div>
        <div class="wk-item"><label>回访员</label><el-input value="张学友" size="small" /></div>
        <div class="wk-item"><label>回访结果</label><el-select value="有效回访" size="small"><el-option label="有效回访" value="有效回访" /></el-select></div>
        <div class="wk-item wk-item-wide"><label>回访提醒描述</label><el-input value="这里是描述内容..." size="small" /></div>
      </div>

      <div class="wk-split-head">
        <span class="is-active">待派单明细</span>
        <span>待派工延期明细</span>
      </div>

      <div class="wk-grid">
        <el-table :data="weeklyRows" stripe border size="small" class="wk-left-table">
          <el-table-column prop="index" label="序号" width="56" />
          <el-table-column prop="phone" label="联系电话/地址" min-width="180" show-overflow-tooltip />
          <el-table-column prop="product" label="产品品类/型号" min-width="130" show-overflow-tooltip />
          <el-table-column prop="serviceType" label="服务方式/类型" width="120" />
          <el-table-column prop="visitType" label="回访类型" width="80" />
          <el-table-column prop="visitTime" label="购买时间/报修日期" min-width="120" />
        </el-table>

        <el-table :data="weeklyChecks" border size="small" class="wk-right-table">
          <el-table-column prop="category" label="回访类型" width="110" />
          <el-table-column prop="question" label="回访质检问卷" min-width="240" />
          <el-table-column label="附加提示" min-width="110">
            <template #default>
              这里是提示内容
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-card v-else shadow="never" class="bn-card bn-card-module">
      <template #header>
        <span class="bn-head">{{ activeModuleLabel }}</span>
        <span class="bn-sub">业务模块占位，可在此对接独立路由或内嵌页面</span>
      </template>
      <el-empty :description="`${activeModuleLabel} · 功能开发中`" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { useProductModulesStore } from '@/stores/product-modules'
import { moduleForTile } from '@/utils/product-modules'
const productModules=useProductModulesStore()

import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAccessStore } from '@/stores/access'
import { ArrowDown, Grid } from '@element-plus/icons-vue'
import { WORK_TILE_LABELS } from '@/constants/workTiles'
import CalendarScheduleTab from '@/components/business-nav/CalendarScheduleTab.vue'
import WorkMemoTab from '@/components/business-nav/WorkMemoTab.vue'
import NoticeManageTab from '@/components/business-nav/NoticeManageTab.vue'
import UnreadNoticeTab from '@/components/business-nav/UnreadNoticeTab.vue'
import TrainingExamTab from '@/components/business-nav/TrainingExamTab.vue'
import PersonalPerformanceTab from '@/components/business-nav/PersonalPerformanceTab.vue'
import SurveyQuestionnaireTab from '@/components/business-nav/SurveyQuestionnaireTab.vue'
import RedBlackListTab from '@/components/business-nav/RedBlackListTab.vue'
import SmsManagementTab from '@/components/business-nav/SmsManagementTab.vue'
import SatisfactionManagementTab from '@/components/business-nav/SatisfactionManagementTab.vue'
import SuggestionManagementTab from '@/components/business-nav/SuggestionManagementTab.vue'
import PerformanceManagementTab from '@/components/business-nav/PerformanceManagementTab.vue'
import AttendanceSchedulingTab from '@/components/business-nav/AttendanceSchedulingTab.vue'
import AgentShiftScheduleTab from '@/components/business-nav/AgentShiftScheduleTab.vue'
import CallCenterSpecialtyTab from '@/components/business-nav/CallCenterSpecialtyTab.vue'
import MealOrderingTab from '@/components/business-nav/MealOrderingTab.vue'
import MonitoringDispatchTab from '@/components/business-nav/MonitoringDispatchTab.vue'
import CallCenterBITab from '@/components/business-nav/CallCenterBITab.vue'
import PlatformConfigTab from '@/components/business-nav/PlatformConfigTab.vue'

const ENTRANCE_TAB_ID = 'entrance'
const route = useRoute()

interface HeadTab {
  id: string
  label: string
  fixed?: boolean
}

function tileTabId(label: string) {
  return `tile:${label}`
}

const headTabs = ref<HeadTab[]>([{ id: ENTRANCE_TAB_ID, label: '功能入口', fixed: true }])
const activeHeadTab = ref(ENTRANCE_TAB_ID)

const hasAnyClosableTab = computed(() => headTabs.value.some((t) => !t.fixed))

function hasClosableLeft(idx: number) {
  return headTabs.value.some((t, i) => i < idx && !t.fixed)
}

function hasClosableRight(idx: number) {
  return headTabs.value.some((t, i) => i > idx && !t.fixed)
}

function ensureActiveTabVisible() {
  if (headTabs.value.some((t) => t.id === activeHeadTab.value)) return
  activeHeadTab.value = headTabs.value[0]?.id ?? ENTRANCE_TAB_ID
}

function onTabHeadMenu(tabId: string, idx: number, cmd: string) {
  if (cmd === 'current') {
    closeHeadTab(tabId)
    return
  }
  if (cmd === 'all') {
    headTabs.value = headTabs.value.filter((t) => t.fixed)
    activeHeadTab.value = ENTRANCE_TAB_ID
    return
  }
  if (cmd === 'left') {
    headTabs.value = headTabs.value.filter((t, i) => i >= idx || t.fixed)
    ensureActiveTabVisible()
    return
  }
  if (cmd === 'right') {
    headTabs.value = headTabs.value.filter((t, i) => i <= idx || t.fixed)
    ensureActiveTabVisible()
  }
}

const tileQuery = ref('')
const access = useAccessStore()
const tilePermissions: Record<string, string> = {
  '公告信息管理': 'announcement.read', '个人绩效情况': 'report.read', '短信管理': 'sms.read',
  '满意度管理': 'report.read', '绩效管理': 'report.read', '坐席排班': 'schedule.read',
  '考勤排班管理': 'schedule.read', '业务监控与调度': 'monitor.read', '报表管理': 'report.read', '平台基础配置管理': 'settings.read',
  '红黑名单管理': 'customer.read',
}
const canOpenTile = (label: string) => (!moduleForTile(label) || productModules.enabled(moduleForTile(label)!)) && (!tilePermissions[label] || access.can(tilePermissions[label]))

const filteredTiles = computed(() => {
  const q = tileQuery.value.trim()
  return WORK_TILE_LABELS.filter(t => canOpenTile(t) && (!q || t.includes(q)))
})

const activeModuleLabel = computed(() => {
  const t = headTabs.value.find((x) => x.id === activeHeadTab.value)
  return t?.label ?? ''
})
const isCalendarTab = computed(() => activeModuleLabel.value === '日历日程')
const isWorkMemoTab = computed(() => activeModuleLabel.value === '工作备忘录')
const isNoticeManageTab = computed(() => activeModuleLabel.value === '公告信息管理')
const isUnreadNoticeTab = computed(() => activeModuleLabel.value === '最新未读公告信息')
const isTrainingExamTab = computed(() => activeModuleLabel.value === '本周培训及考试')
const isPersonalPerformanceTab = computed(() => activeModuleLabel.value === '个人绩效情况')
const isSurveyQuestionnaireTab = computed(() => activeModuleLabel.value === '调查问卷')
const isRedBlackListTab = computed(() => activeModuleLabel.value === '红黑名单管理')
const isSmsManagementTab = computed(() => activeModuleLabel.value === '短信管理')
const isSatisfactionManagementTab = computed(() => activeModuleLabel.value === '满意度管理')
const isSuggestionManagementTab = computed(() => activeModuleLabel.value === '建议管理')
const isPerformanceManagementTab = computed(() => activeModuleLabel.value === '绩效管理')
const isAttendanceSchedulingTab = computed(() => activeModuleLabel.value === '考勤排班管理')
const isAgentShiftTab = computed(
  () => activeModuleLabel.value === '坐席排班' || activeModuleLabel.value === '个人班表',
)
const isSpecialtyManagementTab = computed(() => activeModuleLabel.value === '专项管理')
const isMealOrderingTab = computed(() => activeModuleLabel.value === '订餐管理')
const isMonitoringDispatchTab = computed(() => activeModuleLabel.value === '业务监控与调度')
const isReportManagementTab = computed(() => activeModuleLabel.value === '报表管理')
const isPlatformConfigTab = computed(() => activeModuleLabel.value === '平台基础配置管理')
const isWeeklyPendingTab = computed(() => activeModuleLabel.value === '本周待处理工单')

const weeklyRows = ref([
  {
    index: 1,
    phone: '张学友 / 13800138000 / 广东省佛山市顺德区北滘镇',
    product: '美的冰箱 / MD-WTG5405',
    serviceType: '维修派单',
    visitType: '有效',
    visitTime: '2018-03-03 / 2018-03-19',
  },
  {
    index: 2,
    phone: '张学友 / 13800138000 / 广东省佛山市顺德区北滘镇',
    product: '美的空调 / AZ18036299129',
    serviceType: '安装派单',
    visitType: '有效',
    visitTime: '2018-03-03 / 2018-03-20',
  },
  {
    index: 3,
    phone: '张学友 / 13800138000 / 广东省佛山市顺德区北滘镇',
    product: '美的洗衣机 / WX180315971889',
    serviceType: '维修派单',
    visitType: '标准化',
    visitTime: '2018-03-03 / 2018-03-19',
  },
])

const weeklyChecks = ref([
  { category: '安装服务', question: '请问您家的XX产品是否已经安装好了？' },
  { category: '维修服务', question: '请问师傅是否按约上门？是否穿工服并佩戴工牌？' },
  { category: '回访提醒', question: '请问近门店新服务您体验评价如何。' },
  { category: '服务满意度', question: '本次服务过程您是否满意？' },
])

function openOrFocusTileTab(label: string) {
  if (!canOpenTile(label)) return
  const id = tileTabId(label)
  const existing = headTabs.value.find((t) => t.id === id)
  if (existing) {
    activeHeadTab.value = id
    return
  }
  headTabs.value.push({ id, label, fixed: false })
  activeHeadTab.value = id
}

function applyTileQuery() {
  let tile = String(route.query.tile || '').trim()
  if (!tile) return
  if (tile === '个人班表') tile = '坐席排班'
  if (WORK_TILE_LABELS.includes(tile)) {
    openOrFocusTileTab(tile)
  }
}

onMounted(applyTileQuery)
watch(() => route.query.tile, applyTileQuery)

function closeHeadTab(id: string) {
  const tab = headTabs.value.find((t) => t.id === id)
  if (!tab || tab.fixed) return
  const idx = headTabs.value.findIndex((t) => t.id === id)
  if (idx < 0) return
  const isActive = activeHeadTab.value === id
  headTabs.value.splice(idx, 1)
  if (isActive) {
    activeHeadTab.value = headTabs.value[Math.max(0, idx - 1)]?.id ?? ENTRANCE_TAB_ID
  }
}
</script>

<style scoped>
.bn-page {
  width: 100%;
  max-width: none;
}

/* 仅 Tab 条向左右各伸出 12px，抵消 MainLayout .oa-main 的 padding，贴齐主区内侧（紧邻左侧轨） */
.bn-tab-head {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: -12px;
  margin-right: -12px;
  padding: 6px 12px 6px 0;
  margin-bottom: 10px;
  box-sizing: border-box;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background: #fafafa;
  overflow-x: auto;
}

.bn-tab-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid #ebeef5;
  border-radius: 3px;
  font-size: 12px;
  color: #606266;
  background: #f5f7fa;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
}

.bn-tab-item.is-active {
  color: var(--oa-primary, #0066b3);
  border-color: #c6e2ff;
  background: #ecf5ff;
}

.bn-tab-title {
  line-height: 1;
}

.bn-tab-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 2px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 12px;
  color: #909399;
}

.bn-tab-menu-trigger:hover {
  color: var(--oa-primary, #0066b3);
  background: rgba(64, 158, 255, 0.12);
}

.bn-card :deep(.el-card__header) {
  padding: 14px 18px;
}

.bn-head {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}

.bn-sub {
  display: block;
  font-size: 12px;
  font-weight: normal;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
}

.bn-search {
  max-width: 360px;
  margin-bottom: 16px;
}

.bn-tiles {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 1100px) {
  .bn-tiles {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 640px) {
  .bn-tiles {
    grid-template-columns: repeat(2, 1fr);
  }
}

.bn-tile {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 14px 8px;
  text-align: center;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
  font-size: 13px;
  color: #606266;
  background: #fafbfc;
}
.bn-tile:hover {
  border-color: var(--oa-primary, #0066b3);
  box-shadow: 0 2px 12px rgba(0, 102, 179, 0.12);
  background: #fff;
}
.bn-tile-icon {
  color: var(--oa-primary, #0066b3);
  margin-bottom: 8px;
}

.bn-card-module {
  margin-top: 0;
}

.bn-weekly {
  padding: 2px;
}
.wk-top-tabs {
  display: flex;
  gap: 18px;
  border-bottom: 1px solid #ebeef5;
  padding: 2px 4px 8px;
  font-size: 12px;
}
.wk-tab {
  color: #606266;
}
.wk-tab.is-active {
  color: var(--oa-primary, #0066b3);
  font-weight: 600;
}
.wk-notice {
  font-size: 12px;
  color: #909399;
  padding: 8px 4px;
  border-bottom: 1px solid #f0f2f5;
}
.wk-form-grid {
  padding: 10px 4px 4px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 10px;
}
.wk-item {
  display: grid;
  grid-template-columns: 92px 1fr;
  align-items: center;
  gap: 8px;
}
.wk-item label {
  font-size: 12px;
  color: #606266;
}
.wk-item-wide {
  grid-column: 3 / span 2;
}
.wk-split-head {
  margin-top: 8px;
  display: flex;
  gap: 16px;
  border-top: 1px solid #ebeef5;
  border-bottom: 1px solid #ebeef5;
  padding: 8px 4px;
  font-size: 12px;
}
.wk-split-head span {
  color: #606266;
}
.wk-split-head .is-active {
  color: var(--oa-primary, #0066b3);
  font-weight: 600;
}
.wk-grid {
  margin-top: 8px;
  display: grid;
  grid-template-columns: minmax(520px, 1.2fr) minmax(360px, 1fr);
  gap: 10px;
}
.wk-left-table,
.wk-right-table {
  width: 100%;
}

@media (max-width: 1280px) {
  .wk-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .wk-item-wide {
    grid-column: 1 / -1;
  }
  .wk-grid {
    grid-template-columns: 1fr;
  }
}
</style>
