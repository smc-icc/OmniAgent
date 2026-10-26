<template>
  <div class="rb-panel">
    <el-row :gutter="12">
      <el-col :xs="24" :lg="8">
        <el-card shadow="never" class="rb-card-h">
          <template #header><span class="rb-h">与 CTI / 路由联动</span></template>
          <ul class="rb-ul">
            <li>黑名单：IVR 前置拒绝 → 不进公共队列。</li>
            <li>红名单：专属 / 高优先级技能组，支持「零等待」路由。</li>
            <li>灰名单：正常排队 + 随路数据推送「观察」标签。</li>
            <li>普通：默认策略与溢出规则。</li>
          </ul>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="8">
        <el-card shadow="never" class="rb-card-h">
          <template #header><span class="rb-h">与问卷调查联动</span></template>
          <ul class="rb-ul">
            <li>红名单客户问卷打低分：自动最高级别预警（客户总监链路）。</li>
            <li>黑名单客户不参与满意度统计池，或单独分层报表。</li>
            <li>灰名单低分：优先关联未关单工单与 NLP 归因。</li>
          </ul>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="8">
        <el-card shadow="never" class="rb-card-h">
          <template #header><span class="rb-h">与绩效 / KPI 联动</span></template>
          <ul class="rb-ul">
            <li>投诉统计区分「普通 / 黑名单 / 灰名单」来源，避免误伤坐席。</li>
            <li>成功安抚「顽固黑名单客户」可配置加权积分（演示文案）。</li>
            <li>红名单服务轨迹单独纳入服务质量看板。</li>
          </ul>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="rb-mt">
      <template #header><span class="rb-h">策略路由表（演示）</span></template>
      <el-table :data="routes" border size="small" stripe>
        <el-table-column prop="listType" label="名单类型" width="100" />
        <el-table-column prop="queue" label="目标队列 / IVR 结果" min-width="200" />
        <el-table-column prop="priority" label="优先级" width="88" />
        <el-table-column prop="note" label="备注" min-width="220" show-overflow-tooltip />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const routes = ref([
  { listType: '黑名单', queue: 'PLAY_BUSY / 挂断', priority: '-', note: '不占用坐席工位' },
  { listType: '红名单', queue: 'VIP_PRIORITY / SKILL_VIP_01', priority: 'P0', note: '可配置溢出至值班经理' },
  { listType: '灰名单', queue: 'PUBLIC + 弹屏 TAG_GRAY', priority: 'P5', note: '与 NORMAL 共池' },
  { listType: '普通', queue: 'PUBLIC_ROUTING', priority: 'P8', note: '默认' },
])
</script>

<style scoped>
.rb-card-h :deep(.el-card__body) {
  min-height: 168px;
}
.rb-h {
  font-weight: 600;
  font-size: 14px;
}
.rb-ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.75;
  color: #606266;
}
.rb-mt {
  margin-top: 12px;
}
</style>
