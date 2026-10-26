<template>
  <el-card shadow="never" class="as-root">
    <template #header>
      <div>
        <span class="as-title">考勤排班管理</span>
        <span class="as-sub">左侧菜单结构与您提供的设计稿一致；右侧为功能占位，可后续按子菜单对接页面或路由。</span>
      </div>
    </template>
    <div class="as-body">
      <aside class="as-sider">
        <el-menu
          :default-active="activeKey"
          :default-openeds="defaultOpeneds"
          class="as-menu"
          :unique-opened="true"
          @select="onSelect"
        >
          <el-sub-menu index="base">
            <template #title>
              <el-icon class="as-mi"><Document /></el-icon>
              <span>基础信息</span>
            </template>
            <el-menu-item index="base-year">学年学期</el-menu-item>
            <el-menu-item index="base-student">学生管理</el-menu-item>
            <el-menu-item index="base-teacher">教师管理</el-menu-item>
            <el-menu-item index="base-role">角色权限</el-menu-item>
            <el-menu-item index="base-course">课程管理</el-menu-item>
            <el-menu-item index="base-room">教室管理</el-menu-item>
            <el-menu-item index="base-time">作息时间</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="timetable">
            <template #title>
              <el-icon class="as-mi"><Calendar /></el-icon>
              <span>智能课表</span>
            </template>
            <el-menu-item index="tt-mine">我的课表</el-menu-item>
            <el-menu-item index="tt-manage">课表管理</el-menu-item>
            <el-menu-item index="tt-view">课表查看</el-menu-item>
            <el-menu-item index="tt-schedule">日程管理</el-menu-item>
            <el-menu-item index="tt-temp">临时调代课</el-menu-item>
            <el-menu-item index="tt-hours">课时统计</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="elective">
            <template #title>
              <el-icon class="as-mi"><Tickets /></el-icon>
              <span>校内选课</span>
            </template>
            <el-menu-item index="el-task">选课任务</el-menu-item>
            <el-menu-item index="el-progress">选课进度</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="classing">
            <template #title>
              <el-icon class="as-mi"><User /></el-icon>
              <span>入学分班</span>
            </template>
            <el-menu-item index="class-student">学生分班</el-menu-item>
          </el-sub-menu>

          <el-menu-item index="sched-intelligent" class="as-leaf-intelligent">
            <el-icon class="as-mi"><Calendar /></el-icon>
            <span>智能排课</span>
          </el-menu-item>
        </el-menu>
      </aside>

      <main class="as-main">
        <div class="as-crumb">
          <span class="as-crumb-mod">考勤排班管理</span>
          <span class="as-crumb-div">/</span>
          <span>{{ activeTitle }}</span>
        </div>
        <div
          class="as-main-card"
          :class="{
            'as-main-card--flush':
              activeKey === 'base-year' ||
              activeKey === 'base-student' ||
              activeKey === 'base-teacher' ||
              activeKey === 'base-role' ||
              activeKey === 'base-course' ||
              activeKey === 'base-room' ||
              activeKey === 'base-time' ||
              activeKey === 'tt-mine' ||
              activeKey === 'tt-manage' ||
              activeKey === 'tt-view' ||
              activeKey === 'tt-schedule' ||
              activeKey === 'tt-temp' ||
              activeKey === 'tt-hours' ||
              activeKey === 'el-task' ||
              activeKey === 'el-progress' ||
              activeKey === 'class-student' ||
              activeKey === 'sched-intelligent',
          }"
        >
          <AcademicYearSemesterPanel v-if="activeKey === 'base-year'" />
          <StudentManagementPanel v-else-if="activeKey === 'base-student'" />
          <TeacherManagementPanel v-else-if="activeKey === 'base-teacher'" />
          <RolePermissionsPanel v-else-if="activeKey === 'base-role'" />
          <CourseManagementPanel v-else-if="activeKey === 'base-course'" />
          <ClassroomManagementPanel v-else-if="activeKey === 'base-room'" />
          <ScheduleTimePanel v-else-if="activeKey === 'base-time'" />
          <MyTimetablePanel v-else-if="activeKey === 'tt-mine'" />
          <ScheduleManagementPanel v-else-if="activeKey === 'tt-manage'" />
          <ScheduleViewPanel v-else-if="activeKey === 'tt-view'" />
          <ScheduleDiaryPanel v-else-if="activeKey === 'tt-schedule'" />
          <TempAdjustPanel v-else-if="activeKey === 'tt-temp'" />
          <ClassHoursPanel v-else-if="activeKey === 'tt-hours'" />
          <ElectiveTaskPanel v-else-if="activeKey === 'el-task'" />
          <ElectiveProgressPanel v-else-if="activeKey === 'el-progress'" />
          <ClassPlacementPanel v-else-if="activeKey === 'class-student'" />
          <IntelligentSchedulingPanel v-else-if="activeKey === 'sched-intelligent'" />
          <el-empty v-else :description="`「${activeTitle}」功能开发中`">
            <template #image>
              <el-icon :size="56" class="as-empty-icon"><Grid /></el-icon>
            </template>
          </el-empty>
        </div>
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Calendar, Document, Grid, Tickets, User } from '@element-plus/icons-vue'
import AcademicYearSemesterPanel from './attendance/AcademicYearSemesterPanel.vue'
import StudentManagementPanel from './attendance/StudentManagementPanel.vue'
import TeacherManagementPanel from './attendance/TeacherManagementPanel.vue'
import RolePermissionsPanel from './attendance/RolePermissionsPanel.vue'
import CourseManagementPanel from './attendance/CourseManagementPanel.vue'
import ClassroomManagementPanel from './attendance/ClassroomManagementPanel.vue'
import ScheduleTimePanel from './attendance/ScheduleTimePanel.vue'
import MyTimetablePanel from './attendance/MyTimetablePanel.vue'
import ScheduleManagementPanel from './attendance/ScheduleManagementPanel.vue'
import ScheduleViewPanel from './attendance/ScheduleViewPanel.vue'
import ScheduleDiaryPanel from './attendance/ScheduleDiaryPanel.vue'
import TempAdjustPanel from './attendance/TempAdjustPanel.vue'
import ClassHoursPanel from './attendance/ClassHoursPanel.vue'
import ElectiveTaskPanel from './attendance/ElectiveTaskPanel.vue'
import ElectiveProgressPanel from './attendance/ElectiveProgressPanel.vue'
import ClassPlacementPanel from './attendance/ClassPlacementPanel.vue'
import IntelligentSchedulingPanel from './attendance/IntelligentSchedulingPanel.vue'

/** 与截图一致的菜单 key → 展示标题 */
const TITLE_MAP: Record<string, string> = {
  'base-year': '学年学期',
  'base-student': '学生管理',
  'base-teacher': '教师管理',
  'base-role': '角色权限',
  'base-course': '课程管理',
  'base-room': '教室管理',
  'base-time': '作息时间',
  'tt-mine': '我的课表',
  'tt-manage': '课表管理',
  'tt-view': '课表查看',
  'tt-schedule': '日程管理',
  'tt-temp': '临时调代课',
  'tt-hours': '课时统计',
  'el-task': '选课任务',
  'el-progress': '选课进度',
  'class-student': '学生分班',
  'sched-intelligent': '智能排课',
}

const activeKey = ref('sched-intelligent')
/** 默认展开「入学分班」，与设计稿中展开状态一致；可改为 [] 则全部收起 */
const defaultOpeneds = ref<string[]>(['classing'])

function onSelect(index: string) {
  activeKey.value = index
}

const activeTitle = computed(() => TITLE_MAP[activeKey.value] ?? '请选择菜单')
</script>

<style scoped>
.as-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.as-root :deep(.el-card__body) {
  padding: 0;
}
.as-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.as-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 920px;
  font-weight: normal;
}

.as-body {
  display: flex;
  align-items: stretch;
  min-height: 560px;
}

.as-sider {
  width: 232px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e8e8e8;
}

.as-menu {
  border-right: none;
  background: #fff;
  padding: 8px 0 16px;
}

.as-menu :deep(.el-sub-menu__title),
.as-menu :deep(.el-menu-item) {
  height: 44px;
  line-height: 44px;
  margin: 0 8px;
  border-radius: 4px;
  color: #303133;
}

.as-menu :deep(.el-sub-menu__title:hover),
.as-menu :deep(.el-menu-item:hover) {
  background-color: #f5f7fa;
}

.as-menu :deep(.el-menu-item.is-active) {
  color: var(--el-color-primary);
  background-color: var(--el-color-primary-light-9);
  font-weight: 500;
}

.as-menu :deep(.el-menu-item.is-active .as-mi) {
  color: var(--el-color-primary);
}

.as-menu :deep(.el-sub-menu .el-menu-item) {
  padding-left: 48px !important;
  min-width: auto;
}

.as-menu :deep(.el-sub-menu__icon-arrow) {
  color: #909399;
}

.as-mi {
  margin-right: 8px;
  font-size: 18px;
  color: #606266;
  vertical-align: middle;
}

/* 顶级单独项「智能排课」：与一级子菜单标题左对齐 */
.as-menu :deep(.as-leaf-intelligent) {
  padding-left: 16px !important;
}

.as-menu :deep(.as-leaf-intelligent.is-active) {
  color: var(--el-color-primary);
}

.as-main {
  flex: 1;
  min-width: 0;
  padding: 16px 20px 24px;
  background: #fafafa;
}

.as-crumb {
  font-size: 13px;
  color: #606266;
  margin-bottom: 12px;
}
.as-crumb-mod {
  color: #909399;
}
.as-crumb-div {
  margin: 0 6px;
  color: #dcdfe6;
}

.as-main-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  min-height: 420px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.as-main-card--flush {
  display: block;
  align-items: stretch;
  justify-content: flex-start;
  padding: 0;
}

.as-empty-icon {
  color: #c0c4cc;
}
</style>
