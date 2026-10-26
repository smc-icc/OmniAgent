<template>
  <el-card shadow="never" class="te-root-card">
    <template #header>
      <div>
        <span class="te-head-title">本周培训及考试</span>
        <span class="te-head-sub">左侧切换 · 题库管理 / 试题管理 / 考试管理（演示数据可对接后端）</span>
      </div>
    </template>
    <div class="te-layout">
      <aside class="te-aside">
        <el-menu
          :default-active="activeMenu"
          class="te-menu"
          @select="(k: string) => (activeMenu = k)"
        >
          <el-menu-item index="banks">
            <span>题库管理</span>
          </el-menu-item>
          <el-menu-item index="questions">
            <span>试题管理</span>
          </el-menu-item>
          <el-menu-item index="exams">
            <span>考试管理</span>
          </el-menu-item>
        </el-menu>
      </aside>
      <main class="te-main">
        <QuestionBankPanel v-if="activeMenu === 'banks'" />
        <QuestionPanel v-else-if="activeMenu === 'questions'" />
        <ExamPanel v-else />
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { provide, ref } from 'vue'
import QuestionBankPanel from './training-exam/QuestionBankPanel.vue'
import QuestionPanel from './training-exam/QuestionPanel.vue'
import ExamPanel from './training-exam/ExamPanel.vue'
import { createTrainingExamState, TRAINING_EXAM_KEY } from './training-exam/trainingExamContext'

const state = createTrainingExamState()
provide(TRAINING_EXAM_KEY, state)

const activeMenu = ref('banks')
</script>

<style scoped>
.te-root-card :deep(.el-card__header) {
  padding: 14px 18px;
}
.te-root-card :deep(.el-card__body) {
  padding: 12px 16px 20px;
}
.te-head-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.te-head-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  font-weight: normal;
}
.te-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 520px;
}
.te-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.te-menu {
  border-right: none;
}
.te-main {
  flex: 1;
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 8px 12px 16px;
  background: #fff;
}
</style>
