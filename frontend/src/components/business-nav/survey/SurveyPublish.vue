<template>
  <div class="sq-panel">
    <el-card shadow="never" class="sq-mb">
      <template #header><span class="sq-card-title">多渠道发布</span></template>
      <p class="sq-p">选择与 CTI / 营销中台对接的投放通道；挂机后可组合触发（演示）。</p>
      <el-checkbox-group v-model="channels" class="sq-channels">
        <el-checkbox v-for="c in channelOpts" :key="c.value" :value="c.value" border class="sq-ch-item">
          <div>
            <div class="sq-ch-title">{{ c.label }}</div>
            <div class="sq-ch-desc">{{ c.desc }}</div>
          </div>
        </el-checkbox>
      </el-checkbox-group>
    </el-card>

    <el-card shadow="never">
      <template #header><span class="sq-card-title">抽样策略</span></template>
      <el-form :model="sample" label-width="140px" class="sq-form">
        <el-form-item label="按比例抽样">
          <el-slider v-model="sample.ratePct" :min="1" :max="100" show-input />
          <span class="sq-tip">例如仅对约 {{ sample.ratePct }}% 的挂机客户投放，可平滑负载</span>
        </el-form-item>
        <el-form-item label="按条件限定">
          <el-select v-model="sample.condition" multiple collapse-tags style="width: 100%; max-width: 520px">
            <el-option label="仅投诉工单完结后" value="complaint" />
            <el-option label="仅指定技能组" value="skill" />
            <el-option label="仅指定坐席（如坐席A）" value="agent" />
            <el-option label="仅高价值客户标签" value="vip" />
          </el-select>
        </el-form-item>
        <el-form-item label="流量与峰值控制">
          <el-switch v-model="sample.throttle" active-text="启用" />
          <span class="sq-tip sq-tip-inline">高峰时段自动降低推送 QPS，避免 IVR/短信网关与采集服务过载</span>
        </el-form-item>
        <el-form-item v-if="sample.throttle" label="峰值 QPS 上限">
          <el-input-number v-model="sample.qps" :min="10" :max="5000" />
          <span class="sq-tip sq-tip-inline">消息 / 外呼回调合并后的每秒上限（演示）</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="ElMessage.success('抽样策略已保存（演示）')">保存策略</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const channelOpts = [
  { value: 'ivr', label: 'IVR 语音问卷', desc: '通话结束后自动播报按键题，适合语音通道' },
  { value: 'sms', label: '短信 / 彩信', desc: '挂机后推送短链，适合详细文字反馈' },
  { value: 'mail', label: '邮件', desc: '非实时、高价值客户批量邀请' },
  { value: 'wechat', label: '微信模板 / 订阅消息', desc: '公众号或企微触达' },
  { value: 'app', label: 'APP 弹窗', desc: '自有 App 内嵌入式问卷' },
]

const channels = ref(['ivr', 'sms'])

const sample = ref({
  ratePct: 12,
  condition: [] as string[],
  throttle: true,
  qps: 320,
})
</script>

<style scoped>
.sq-mb {
  margin-bottom: 12px;
}
.sq-card-title {
  font-weight: 600;
}
.sq-p {
  font-size: 13px;
  color: #606266;
  margin: 0 0 12px;
}
.sq-channels {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sq-ch-item {
  width: 100%;
  height: auto !important;
  margin: 0 !important;
  padding: 12px 14px !important;
  align-items: flex-start !important;
}
.sq-ch-title {
  font-weight: 600;
  font-size: 13px;
}
.sq-ch-desc {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.sq-form {
  max-width: 720px;
}
.sq-tip {
  display: block;
  font-size: 12px;
  color: #909399;
  margin-top: 6px;
}
.sq-tip-inline {
  display: inline;
  margin-left: 12px;
  margin-top: 0;
}
</style>
