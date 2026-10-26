<template>
  <div class="sat-panel">
    <el-row :gutter="12">
      <el-col :xs="24" :lg="14">
        <el-card shadow="never">
          <template #header>
            <div class="sat-head">
              <span class="sat-h">报表与导出</span>
            </div>
          </template>
          <p class="sat-p">按日/周/月导出满意度明细、低分清单与坐席排名；可对接数仓订阅任务。</p>
          <el-form label-width="120px" size="small" class="sat-form">
            <el-form-item label="报表类型">
              <el-select v-model="form.kind" placeholder="选择" style="width: 100%; max-width: 320px">
                <el-option label="满意度明细（含开放文本）" value="明细" />
                <el-option label="坐席/队列汇总" value="汇总" />
                <el-option label="低分与预警清单" value="低分" />
                <el-option label="NPS 专题" value="NPS" />
              </el-select>
            </el-form-item>
            <el-form-item label="统计周期">
              <el-date-picker
                v-model="form.range"
                type="month"
                placeholder="选择月份"
                value-format="YYYY-MM"
                style="width: 200px"
              />
            </el-form-item>
            <el-form-item label="包含脱敏">
              <el-switch v-model="form.mask" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="ElMessage.success('已加入导出队列（演示）')">生成下载</el-button>
              <el-button @click="ElMessage.info('配置订阅（演示）')">邮件订阅</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never">
          <template #header><span class="sat-h">最近任务</span></template>
          <el-table :data="jobs" border size="small" stripe>
            <el-table-column prop="name" label="任务" min-width="120" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="88">
              <template #default="{ row }">
                <el-tag :type="row.status === '完成' ? 'success' : 'primary'" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="time" label="时间" width="110" />
            <el-table-column label="" width="72" fixed="right">
              <template #default>
                <el-button link type="primary" size="small" @click="ElMessage.info('下载（演示）')">下载</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const form = ref({
  kind: '明细',
  range: '2026-03',
  mask: true,
})

const jobs = ref([
  { name: '满意度明细_202603.csv', status: '完成', time: '03-30 07:00' },
  { name: '低分清单_202603.xlsx', status: '排队', time: '—' },
])
</script>

<style scoped>
.sat-panel {
  min-height: 360px;
}
.sat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sat-h {
  font-weight: 600;
  font-size: 14px;
}
.sat-p {
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
  margin: 0 0 12px;
}
.sat-form {
  max-width: 480px;
}
</style>
