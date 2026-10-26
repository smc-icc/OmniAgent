<template>
  <div class="rb-panel">
    <el-card shadow="never" class="rb-mb">
      <template #header><span class="rb-h">隐私与脱敏</span></template>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="列表展示">默认仅显示 138****0000；全号需「名单审计员」角色 + 二次确认</el-descriptions-item>
        <el-descriptions-item label="导出">水印导出 / 单次授权有效期；金融政务场景建议对接堡垒机审计</el-descriptions-item>
        <el-descriptions-item label="行业共享">仅同步脱敏指纹 + 风险等级，不回传明文明文（演示说明）</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="rb-head-row">
          <span class="rb-h">操作审计日志</span>
          <el-input v-model="auditQuery" placeholder="搜索操作人 / 动作" clearable style="width: 220px" size="small" />
        </div>
      </template>
      <el-table :data="filteredAudit" border stripe size="small" max-height="360">
        <el-table-column prop="time" label="时间" width="160" />
        <el-table-column prop="operator" label="操作人" width="100" />
        <el-table-column prop="action" label="动作" width="140" />
        <el-table-column prop="target" label="对象（脱敏）" width="130" />
        <el-table-column prop="reason" label="原因 / 备注" min-width="200" show-overflow-tooltip />
        <el-table-column prop="ip" label="来源 IP" width="120" />
      </el-table>
      <p class="rb-foot">监管场景要求：入黑、移黑、红名单等级变更等关键动作必须可追溯；本表为演示数据。</p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const auditQuery = ref('')

const auditRows = ref([
  {
    time: '2026-03-30 10:22:01',
    operator: '班长-周',
    action: '加入黑名单',
    target: '138****9012',
    reason: '工单 #4521 附件：辱骂录音',
    ip: '10.12.8.44',
  },
  {
    time: '2026-03-29 16:05:33',
    operator: '合规-孙',
    action: '移出黑名单',
    target: '137****2201',
    reason: '申诉 AP-20260329 结案',
    ip: '10.12.1.2',
  },
  {
    time: '2026-03-29 09:18:00',
    operator: '系统任务',
    action: '临时黑名单到期释放',
    target: '170****8899',
    reason: 'TTL=72h 自动解禁',
    ip: 'batch-01',
  },
  {
    time: '2026-03-28 14:40:12',
    operator: '管理员-陈',
    action: '红名单等级上调',
    target: '139****6688',
    reason: '大客户协议 renewal',
    ip: '10.12.8.9',
  },
])

const filteredAudit = computed(() => {
  const q = auditQuery.value.trim()
  if (!q) return auditRows.value
  return auditRows.value.filter(
    (r) => r.operator.includes(q) || r.action.includes(q) || r.target.includes(q),
  )
})
</script>

<style scoped>
.rb-mb {
  margin-bottom: 12px;
}
.rb-h {
  font-weight: 600;
  font-size: 14px;
}
.rb-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.rb-foot {
  margin: 12px 0 0;
  font-size: 12px;
  color: #909399;
}
</style>
