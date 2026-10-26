<template>
  <el-card shadow="never" class="sms-root">
    <template #header>
      <div>
        <span class="sms-title">短信管理</span>
        <span class="sms-sub"
          >呼叫中心侧短信能力：模板报备、变量群发、状态回执、签名账户、合规退订与频控；可与 CTI 挂机、问卷、工单联动（演示数据）。</span
        >
      </div>
    </template>
    <div class="sms-layout">
      <aside class="sms-aside">
        <el-menu :default-active="active" class="sms-menu" @select="(k: string) => (active = k as Key)">
          <el-menu-item index="overview">总览</el-menu-item>
          <el-menu-item index="template">模板管理</el-menu-item>
          <el-menu-item index="task">发送任务</el-menu-item>
          <el-menu-item index="records">发送记录</el-menu-item>
          <el-menu-item index="account">签名与账户</el-menu-item>
          <el-menu-item index="compliance">合规与频控</el-menu-item>
        </el-menu>
      </aside>
      <main class="sms-main">
        <component :is="Panel" />
      </main>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import SmsOverview from './sms/SmsOverview.vue'
import SmsTemplate from './sms/SmsTemplate.vue'
import SmsSendTask from './sms/SmsSendTask.vue'
import SmsRecords from './sms/SmsRecords.vue'
import SmsAccount from './sms/SmsAccount.vue'
import SmsCompliance from './sms/SmsCompliance.vue'

const map = {
  overview: markRaw(SmsOverview),
  template: markRaw(SmsTemplate),
  task: markRaw(SmsSendTask),
  records: markRaw(SmsRecords),
  account: markRaw(SmsAccount),
  compliance: markRaw(SmsCompliance),
} as const

type Key = keyof typeof map

const active = ref<Key>('overview')
const Panel = computed(() => map[active.value])
</script>

<style scoped>
.sms-root :deep(.el-card__header) {
  padding: 14px 18px;
}
.sms-root :deep(.el-card__body) {
  padding: 12px 16px 18px;
}
.sms-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--oa-text, #303133);
}
.sms-sub {
  display: block;
  font-size: 12px;
  color: var(--oa-muted, #909399);
  margin-top: 6px;
  line-height: 1.55;
  max-width: 920px;
  font-weight: normal;
}
.sms-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  min-height: 520px;
}
.sms-aside {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}
.sms-menu {
  border-right: none;
}
.sms-main {
  flex: 1;
  min-width: 0;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px 14px 16px;
  background: #fff;
}
</style>
