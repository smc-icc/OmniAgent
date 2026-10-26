<template>
  <div class="sq-panel">
    <el-card shadow="never" class="sq-mb">
      <template #header><span class="sq-card-title">激励配置</span></template>
      <p class="sq-p">完成问卷后可自动发放权益，提升回收率；行业经验可从约 3%–5% 提升至 15%–20%（视人群与奖品吸引力而定）。</p>
      <el-form :model="reward" label-width="140px" class="sq-form-max">
        <el-form-item label="权益类型">
          <el-checkbox-group v-model="reward.types">
            <el-checkbox value="coupon">优惠券</el-checkbox>
            <el-checkbox value="points">积分</el-checkbox>
            <el-checkbox value="lottery">抽奖机会</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="单笔积分">
          <el-input-number v-model="reward.points" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="券批次 ID">
          <el-input v-model="reward.batchId" placeholder="对接营销系统批次号" style="max-width: 360px" />
        </el-form-item>
        <el-form-item label="风控">
          <el-switch v-model="reward.needSms" active-text="需短信验证码领取" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="ElMessage.success('激励策略已保存（演示）')">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <span class="sq-card-title">二次跟进任务</span>
        <span class="sq-sub">对留言建议、留电要求回电的客户自动生成外呼回访</span>
      </template>
      <el-table :data="tasks" border stripe size="small">
        <el-table-column prop="id" label="任务号" width="140" />
        <el-table-column prop="customer" label="客户" width="120" />
        <el-table-column prop="reason" label="触发原因" min-width="200" show-overflow-tooltip />
        <el-table-column prop="deadline" label="计划外呼" width="160" />
        <el-table-column prop="owner" label="责任人" width="100" />
        <el-table-column label="操作" width="120">
          <template #default>
            <el-button link type="primary" size="small">去外呼</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const reward = ref({
  types: ['points', 'coupon'] as string[],
  points: 50,
  batchId: 'CPN-2026-Q1-SURVEY',
  needSms: true,
})

const tasks = ref([
  {
    id: 'CB-88321',
    customer: '138****9021',
    reason: '开放题留电：要求主管回电说明安装延期',
    deadline: '今日 18:00 前',
    owner: '班组-王',
  },
  {
    id: 'CB-88309',
    customer: '用户匿名（APP）',
    reason: '勾选「愿意接受回访」且 NLP 标为「设备故障」',
    deadline: '明日 12:00',
    owner: '售后-L2',
  },
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
.sq-p {
  font-size: 13px;
  color: #606266;
  margin: 0 0 14px;
  line-height: 1.65;
}
.sq-form-max {
  max-width: 640px;
}
</style>
