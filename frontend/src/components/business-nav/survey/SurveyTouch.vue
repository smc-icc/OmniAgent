<template>
  <div class="sq-panel">
    <el-alert
      title="自动触发与精准关联"
      type="warning"
      show-icon
      :closable="false"
      description="与 CTI / 工单系统打通后，在挂断、工单完结等触点自动带参下发问卷；随卷标签是坐席绩效归因的前提，缺失则无法用于个人考核。"
      class="sq-mb"
    />

    <el-card shadow="never" class="sq-mb">
      <template #header><span class="sq-card-title">触发时机</span></template>
      <el-timeline>
        <el-timeline-item
          v-for="t in triggers"
          :key="t.key"
          :timestamp="t.time"
          placement="top"
          :type="t.type"
        >
          <el-card shadow="never" class="sq-tl-card">
            <div class="sq-tl-title">{{ t.title }}</div>
            <p class="sq-tl-desc">{{ t.desc }}</p>
          </el-card>
        </el-timeline-item>
      </el-timeline>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <span class="sq-card-title">随卷自动标签（关联绩效）</span>
        <span class="sq-sub">问卷提交时由系统写入，禁止手工篡改（对接后）</span>
      </template>
      <el-table :data="tagFields" border size="small" stripe>
        <el-table-column prop="field" label="字段" width="160" />
        <el-table-column prop="source" label="数据来源" width="180" />
        <el-table-column prop="use" label="用途" min-width="220" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const triggers = ref([
  {
    key: 'hangup',
    title: '通话结束（ACW 后）',
    time: '实时',
    type: 'primary',
    desc: 'CTI 推送挂断事件 → 问卷编排引擎按抽样策略决定是否下发 IVR / 短信',
  },
  {
    key: 'ticket',
    title: '工单状态 = 已关闭',
    time: '准实时',
    type: 'success',
    desc: '适合售后闭环调研；可限定业务类型为投诉、安装、维修等',
  },
  {
    key: 'manual',
    title: '服务完成事件（API）',
    time: '异步',
    type: 'info',
    desc: '非电话渠道或其它系统回传服务完成标记后触发邀评',
  },
])

const tagFields = ref([
  { field: '坐席工号', source: 'CTI Agent ID', use: '个人绩效归因、差评 TOP 排名' },
  { field: '技能组 / 队列', source: 'CTI Skill', use: '班组对比、排班与路由优化' },
  { field: '通话时长', source: 'CDR', use: '关联满意度 vs 时长分析' },
  { field: '客户来源', source: 'DNIS / 渠道标识', use: '分渠道满意度监控' },
  { field: '业务类型', source: '工单 / 弹屏 CRM', use: '售前 / 售后 / 投诉分层报表' },
  { field: '录音 ID', source: '录音平台', use: '低分自动拉取录音供质检复核与申诉' },
])
</script>

<style scoped>
.sq-mb {
  margin-bottom: 12px;
}
.sq-card-title {
  font-weight: 600;
  margin-right: 8px;
}
.sq-sub {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}
.sq-tl-card :deep(.el-card__body) {
  padding: 10px 12px;
}
.sq-tl-title {
  font-weight: 600;
  font-size: 14px;
}
.sq-tl-desc {
  margin: 6px 0 0;
  font-size: 12px;
  color: #606266;
  line-height: 1.55;
}
</style>
