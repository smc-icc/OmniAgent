<template>
  <div class="rb-panel">
    <el-alert title="黑名单 · 防御机制" type="error" show-icon :closable="false" class="rb-mb">
      <template #default>
        <p class="rb-alert-p">来源：手动录入、高频拦截、黑产库、行业共享库。策略：IVR 拒绝、坐席红框警示、静默限流 / 转专家队列。</p>
      </template>
    </el-alert>

    <div class="rb-toolbar">
      <el-input v-model="query" placeholder="搜索脱敏号码 / 工单号" clearable style="width: 240px" />
      <el-select v-model="fltSource" placeholder="来源" clearable style="width: 140px">
        <el-option label="手动录入" value="手动录入" />
        <el-option label="高频拦截" value="高频拦截" />
        <el-option label="黑产库" value="黑产库" />
        <el-option label="行业共享" value="行业共享" />
      </el-select>
      <el-select v-model="fltStrategy" placeholder="处置策略" clearable style="width: 140px">
        <el-option label="IVR层拦截" value="IVR层拦截" />
        <el-option label="坐席层警示" value="坐席层警示" />
        <el-option label="静默/限流" value="静默/限流" />
      </el-select>
      <el-button type="primary" @click="openAdd">新增黑名单</el-button>
    </div>

    <el-table :data="filtered" border stripe size="small" class="rb-mt">
      <el-table-column prop="mask" label="号码（脱敏）" width="130" />
      <el-table-column prop="source" label="来源" width="110" />
      <el-table-column prop="strategy" label="拦截/处置策略" min-width="140" />
      <el-table-column prop="reason" label="原因摘要" min-width="160" show-overflow-tooltip />
      <el-table-column prop="expire" label="到期" width="120" />
      <el-table-column prop="status" label="状态" width="88">
        <template #default="{ row }">
          <el-tag :type="row.status === '生效' ? 'danger' : 'info'" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="detail(row)">详情</el-button>
          <el-button link type="warning" size="small" @click="appealHint">申诉洗白</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg" title="新增黑名单" width="520px" destroy-on-close>
      <el-form :model="form" label-width="100px">
        <el-form-item label="号码" required>
          <el-input v-model="form.fullPhone" placeholder="仅授权岗可录全号；演示" />
        </el-form-item>
        <el-form-item label="来源">
          <el-select v-model="form.source" style="width: 100%">
            <el-option label="手动录入" value="手动录入" />
            <el-option label="高频拦截" value="高频拦截" />
            <el-option label="黑产库" value="黑产库" />
            <el-option label="行业共享" value="行业共享" />
          </el-select>
        </el-form-item>
        <el-form-item label="策略">
          <el-select v-model="form.strategy" style="width: 100%">
            <el-option label="IVR层拦截" value="IVR层拦截" />
            <el-option label="坐席层警示" value="坐席层警示" />
            <el-option label="静默/限流" value="静默/限流" />
          </el-select>
        </el-form-item>
        <el-form-item label="有效期">
          <el-radio-group v-model="form.ttl">
            <el-radio value="72h">临时 72 小时</el-radio>
            <el-radio value="perm">永久</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="form.reason" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" @click="save">保存（演示）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

interface BlRow {
  mask: string
  source: string
  strategy: string
  reason: string
  expire: string
  status: string
}

const rows = ref<BlRow[]>([
  {
    mask: '138****9012',
    source: '手动录入',
    strategy: 'IVR层拦截',
    reason: '多次辱骂坐席，工单 #4521 附件',
    expire: '永久',
    status: '生效',
  },
  {
    mask: '170****5560',
    source: '高频拦截',
    strategy: 'IVR层拦截',
    reason: '1 小时内呼入 58 次疑似攻击',
    expire: '2026-04-01',
    status: '生效',
  },
  {
    mask: '131****3311',
    source: '黑产库',
    strategy: '坐席层警示',
    reason: '反欺诈平台高危；待二次确认',
    expire: '2026-03-15',
    status: '生效',
  },
  {
    mask: '159****1022',
    source: '行业共享',
    strategy: '静默/限流',
    reason: '共享脱敏库；每日最多接入 1 次',
    expire: '永久',
    status: '生效',
  },
])

const query = ref('')
const fltSource = ref('')
const fltStrategy = ref('')

const filtered = computed(() => {
  let r = rows.value
  const q = query.value.trim()
  if (q) r = r.filter((x) => x.mask.includes(q) || x.reason.includes(q))
  if (fltSource.value) r = r.filter((x) => x.source === fltSource.value)
  if (fltStrategy.value) r = r.filter((x) => x.strategy === fltStrategy.value)
  return r
})

const dlg = ref(false)
const form = ref({
  fullPhone: '',
  source: '手动录入',
  strategy: 'IVR层拦截',
  ttl: '72h',
  reason: '',
})

function openAdd() {
  form.value = {
    fullPhone: '',
    source: '手动录入',
    strategy: 'IVR层拦截',
    ttl: '72h',
    reason: '',
  }
  dlg.value = true
}

function save() {
  ElMessage.success('已写入并记审计日志（演示）')
  rows.value.unshift({
    mask: '***新录入***',
    source: form.value.source,
    strategy: form.value.strategy,
    reason: form.value.reason || '—',
    expire: form.value.ttl === 'perm' ? '永久' : '72h 后',
    status: '生效',
  })
  dlg.value = false
}

function detail(row: BlRow) {
  ElMessage.info(`${row.mask} · ${row.strategy}`)
}

function appealHint() {
  ElMessage.info('洗白走审批：坐席申请 → 班长 → 合规（见「灰名单与生命周期」）')
}
</script>

<style scoped>
.rb-mb {
  margin-bottom: 12px;
}
.rb-alert-p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}
.rb-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.rb-mt {
  margin-top: 12px;
}
</style>
