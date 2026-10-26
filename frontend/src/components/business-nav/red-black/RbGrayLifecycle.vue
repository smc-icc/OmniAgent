<template>
  <div class="rb-panel">
    <el-card shadow="never" class="rb-mb">
      <template #header><span class="rb-h">灰名单（观察区）</span></template>
      <p class="rb-p">不拦截进线；坐席接起时提示「近期来电频率高 / 疑似投诉倾向」，重点排查未闭环问题。</p>
      <el-table :data="grayRows" border size="small" stripe>
        <el-table-column prop="mask" label="号码" width="120" />
        <el-table-column prop="signal" label="观察原因" min-width="200" show-overflow-tooltip />
        <el-table-column prop="calls7d" label="7日进线" width="88" align="center" />
        <el-table-column prop="since" label="纳入时间" width="110" />
        <el-table-column label="操作" width="100">
          <template #default>
            <el-button link type="primary" size="small">升黑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="rb-mb">
      <template #header><span class="rb-h">临时黑名单到期</span></template>
      <el-table :data="ttlRows" border size="small">
        <el-table-column prop="mask" label="号码" width="120" />
        <el-table-column prop="expireAt" label="到期时间" width="168" />
        <el-table-column prop="left" label="剩余" width="88" />
        <el-table-column label="操作" width="140">
          <template #default>
            <el-button link type="primary" size="small">延期</el-button>
            <el-button link type="danger" size="small">转永久</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header><span class="rb-h">申诉与洗白 · 审批流</span></template>
      <el-steps :active="1" align-center class="rb-steps">
        <el-step title="坐席/客户发起" description="填写原因与凭证" />
        <el-step title="班组长审核" description="业务真实性" />
        <el-step title="合规复核" description="监管与风控" />
        <el-step title="状态变更" description="移出/降级灰名单" />
      </el-steps>
      <el-table :data="appeals" class="rb-mt" border size="small" stripe>
        <el-table-column prop="id" label="单号" width="120" />
        <el-table-column prop="mask" label="号码" width="120" />
        <el-table-column prop="applicant" label="发起人" width="100" />
        <el-table-column prop="stage" label="当前环节" width="120" />
        <el-table-column prop="remark" label="摘要" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="140">
          <template #default>
            <el-button link type="primary" size="small">审批（演示）</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const grayRows = ref([
  { mask: '136****4400', signal: '近 7 天 6 次进线，无违规但情绪词略升', calls7d: 6, since: '2026-03-28' },
  { mask: '155****9912', signal: '投诉倾向工单未关单，随访中', calls7d: 4, since: '2026-03-25' },
])

const ttlRows = ref([
  { mask: '170****5560', expireAt: '2026-04-01 09:00:00', left: '38h' },
  { mask: '132****7733', expireAt: '2026-03-31 18:00:00', left: '12h' },
])

const appeals = ref([
  {
    id: 'AP-20260330-01',
    mask: '137****2201',
    applicant: '坐席-赵',
    stage: '班组长审核',
    remark: '债务已结清，客户请求移出黑名单',
  },
])
</script>

<style scoped>
.rb-mb {
  margin-bottom: 12px;
}
.rb-h {
  font-weight: 600;
  font-size: 14px;
}
.rb-p {
  font-size: 13px;
  color: #606266;
  margin: 0 0 12px;
  line-height: 1.6;
}
.rb-mt {
  margin-top: 16px;
}
.rb-steps {
  margin-top: 8px;
}
</style>
