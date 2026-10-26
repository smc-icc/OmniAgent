<template>
  <div class="sms-panel">
    <div class="sms-toolbar">
      <el-input v-model="query" placeholder="手机号后四位 / msgId" clearable style="width: 200px" />
      <el-select v-model="fltState" placeholder="状态" clearable style="width: 110px">
        <el-option label="成功" value="成功" />
        <el-option label="失败" value="失败" />
        <el-option label="未知" value="未知" />
      </el-select>
      <el-date-picker
        v-model="range"
        type="datetimerange"
        range-separator="至"
        start-placeholder="开始"
        end-placeholder="结束"
        value-format="YYYY-MM-DD HH:mm:ss"
        style="width: 320px"
      />
      <el-button type="primary" @click="ElMessage.success('已应用筛选（演示）')">查询</el-button>
      <el-button @click="ElMessage.info('导出对接对象存储 / 数仓')">导出</el-button>
    </div>
    <el-table :data="filtered" border stripe size="small" class="sms-mt" max-height="420">
      <el-table-column prop="time" label="发送时间" width="160" />
      <el-table-column prop="mask" label="号码" width="116" />
      <el-table-column prop="tpl" label="模板" width="110" />
      <el-table-column prop="gateway" label="网关" width="88" />
      <el-table-column prop="state" label="状态" width="88">
        <template #default="{ row }">
          <el-tag :type="row.state === '成功' ? 'success' : row.state === '失败' ? 'danger' : 'info'" size="small">{{ row.state }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="biz" label="业务来源" width="120" />
      <el-table-column prop="failReason" label="失败原因/回执码" min-width="160" show-overflow-tooltip />
    </el-table>
    <div class="sms-pagination">
      <span class="sms-total">共 {{ filtered.length }} 条（本页演示）</span>
      <el-pagination layout="prev, pager, next" :total="filtered.length" :page-size="10" size="small" background />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

const rows = ref([
  { time: '2026-03-30 10:21:08', mask: '138****9012', tpl: 'TPL-N-001', gateway: 'GW-A', state: '成功', biz: '挂机短信', failReason: '—' },
  { time: '2026-03-30 10:20:55', mask: '139****1120', tpl: 'TPL-C-003', gateway: 'GW-B', state: '成功', biz: 'OTP', failReason: '—' },
  { time: '2026-03-30 10:18:33', mask: '170****4400', tpl: 'TPL-M-002', gateway: 'GW-A', state: '失败', biz: '营销', failReason: 'BLACKLIST:001' },
  { time: '2026-03-30 10:17:01', mask: '186****6655', tpl: 'TPL-N-001', gateway: 'GW-A', state: '未知', biz: '挂机短信', failReason: '回执延迟' },
])

const query = ref('')
const fltState = ref('')
const range = ref<[string, string] | null>(null)

const filtered = computed(() => {
  let r = rows.value
  if (fltState.value) r = r.filter((x) => x.state === fltState.value)
  const q = query.value.trim()
  if (q) r = r.filter((x) => x.mask.includes(q))
  return r
})
</script>

<style scoped>
.sms-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.sms-mt {
  margin-top: 12px;
}
.sms-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.sms-total {
  margin-right: auto;
  font-size: 13px;
  color: #606266;
}
</style>
