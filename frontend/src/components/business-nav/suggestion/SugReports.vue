<template>
  <div class="sug-panel">
    <el-row :gutter="12">
      <el-col :xs="24" :lg="14">
        <el-card shadow="never">
          <template #header><span class="sug-h">导出与审计</span></template>
          <p class="sug-p">
            导出建议全字段明细、部门处置轨迹与答复内容；支持按类别/状态/时间筛选。审计字段包含操作人、时间戳与 IP（对接后）。
          </p>
          <el-form label-width="100px" size="small" class="sug-form">
            <el-form-item label="报表类型">
              <el-select v-model="form.kind" style="width: 100%; max-width: 320px">
                <el-option label="建议明细（含原文）" value="明细" />
                <el-option label="部门处置统计" value="部门" />
                <el-option label="采纳与闭环清单" value="闭环" />
              </el-select>
            </el-form-item>
            <el-form-item label="时间范围">
              <el-date-picker
                v-model="form.range"
                type="daterange"
                range-separator="至"
                start-placeholder="开始"
                end-placeholder="结束"
                value-format="YYYY-MM-DD"
                style="width: 100%; max-width: 360px"
              />
            </el-form-item>
            <el-form-item label="含敏感原文">
              <el-switch v-model="form.raw" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="ElMessage.success('已加入导出队列（演示）')">生成</el-button>
              <el-button @click="ElMessage.info('仅管理员：审计日志 CSV（演示）')">审计日志</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never">
          <template #header><span class="sug-h">近期导出</span></template>
          <el-table :data="jobs" border size="small" stripe>
            <el-table-column prop="name" label="文件" min-width="120" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="row.status === '完成' ? 'success' : 'primary'" size="small">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
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
  range: '' as [string, string] | '' | null,
  raw: false,
})

const jobs = ref([
  { name: '建议明细_202602.csv', status: '完成' },
  { name: '部门统计_202603Q1.xlsx', status: '排队' },
])
</script>

<style scoped>
.sug-panel {
  min-height: 360px;
}
.sug-h {
  font-weight: 600;
  font-size: 14px;
}
.sug-p {
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
  margin: 0 0 12px;
}
.sug-form {
  max-width: 480px;
}
</style>
