<template>
  <div class="sug-panel">
    <el-alert
      title="分类与自动路由"
      type="success"
      show-icon
      :closable="false"
      class="sug-mb"
      description="按关键字、渠道、客户标签将建议指派默认责任部门，并支持人工覆盖；以下为演示规则。"
    />
    <el-table :data="rules" border stripe size="small" max-height="320">
      <el-table-column prop="name" label="规则名" min-width="140" show-overflow-tooltip />
      <el-table-column prop="match" label="匹配条件" min-width="220" show-overflow-tooltip />
      <el-table-column prop="category" label="归类" width="100" />
      <el-table-column prop="dept" label="责任部门" width="120" show-overflow-tooltip />
      <el-table-column prop="prio" label="优先级" width="80" />
      <el-table-column label="启用" width="72">
        <template #default="{ row }">
          <el-switch v-model="row.on" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="88" fixed="right">
        <template #default>
          <el-button link type="primary" size="small" @click="ElMessage.info('编辑规则（演示）')">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-card shadow="never" class="sug-mt">
      <template #header><span class="sug-h">标准分类（节选）</span></template>
      <el-table :data="categories" border size="small" stripe>
        <el-table-column prop="code" label="编码" width="100" />
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column prop="owner" label="默认责任部门" width="140" />
        <el-table-column prop="sla" label="首响 SLA" width="100" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const rules = ref([
  {
    name: '报修 / 进度关键词',
    match: '全文含「报修」「进度」「配件」',
    category: '产品功能',
    dept: '产品运营组',
    prio: 'P2',
    on: true,
  },
  {
    name: '排队 / 等待类',
    match: '全文含「排队」「等待过久」且 渠道=IVR',
    category: '服务质量',
    dept: '呼叫中心运营',
    prio: 'P1',
    on: true,
  },
  {
    name: '政策 / 发票类',
    match: '全文含「发票」「政策」「材料」',
    category: '流程政策',
    dept: '市场部',
    prio: 'P3',
    on: true,
  },
])

const categories = ref([
  { code: 'P-FUNC', name: '产品功能', owner: '产品运营组', sla: '2 工作日' },
  { code: 'S-QS', name: '服务质量', owner: '质检 / 运营', sla: '1 工作日' },
  { code: 'F-POL', name: '流程政策', owner: '市场部', sla: '3 工作日' },
])
</script>

<style scoped>
.sug-panel {
  min-height: 360px;
}
.sug-mb {
  margin-bottom: 12px;
}
.sug-mt {
  margin-top: 14px;
}
.sug-h {
  font-weight: 600;
  font-size: 14px;
}
</style>
