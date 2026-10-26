<template>
  <div class="sug-panel">
    <div class="sug-toolbar">
      <el-input
        v-model="q"
        placeholder="单号 / 客户 / 关键字"
        clearable
        size="small"
        class="sug-search"
        :prefix-icon="Search"
      />
      <el-select v-model="fChannel" placeholder="渠道" clearable size="small" style="width: 120px">
        <el-option label="在线客服" value="在线客服" />
        <el-option label="IVR/问卷" value="IVR/问卷" />
        <el-option label="官网表单" value="官网表单" />
        <el-option label="坐席代录" value="坐席代录" />
      </el-select>
      <el-select v-model="fCat" placeholder="类别" clearable size="small" style="width: 120px">
        <el-option label="产品功能" value="产品功能" />
        <el-option label="服务质量" value="服务质量" />
        <el-option label="流程政策" value="流程政策" />
      </el-select>
      <el-select v-model="fStatus" placeholder="状态" clearable size="small" style="width: 120px">
        <el-option label="已登记" value="已登记" />
        <el-option label="评审中" value="评审中" />
        <el-option label="已答复" value="已答复" />
        <el-option label="已归档" value="已归档" />
      </el-select>
      <el-button type="primary" size="small" @click="ElMessage.success('已查询（演示）')">查询</el-button>
      <el-button type="success" size="small" @click="ElMessage.info('打开登记表单（演示）')">新建登记</el-button>
    </div>

    <el-table :data="filtered" border stripe size="small" class="sug-mt" max-height="420">
      <el-table-column prop="id" label="建议单号" width="130" />
      <el-table-column prop="channel" label="渠道" width="100" />
      <el-table-column prop="category" label="类别" width="100" />
      <el-table-column prop="summary" label="摘要" min-width="200" show-overflow-tooltip />
      <el-table-column prop="customer" label="客户" width="110" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="88">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="owner" label="责任部门" width="110" show-overflow-tooltip />
      <el-table-column prop="time" label="登记时间" width="160" />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          <el-button link type="primary" size="small" @click="mergeHint(row)">合并</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg" title="建议详情" width="600px" destroy-on-close>
      <template v-if="row">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="单号">{{ row.id }}</el-descriptions-item>
          <el-descriptions-item label="渠道 / 类别">{{ row.channel }} · {{ row.category }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{ row.customer }}</el-descriptions-item>
          <el-descriptions-item label="原文">
            {{ row.fullText }}
          </el-descriptions-item>
        </el-descriptions>
        <el-form label-position="top" size="small" class="sug-form">
          <el-form-item label="更新状态">
            <el-select v-model="edit.status" style="width: 100%">
              <el-option label="已登记" value="已登记" />
              <el-option label="评审中" value="评审中" />
              <el-option label="已答复" value="已答复" />
              <el-option label="已归档" value="已归档" />
            </el-select>
          </el-form-item>
          <el-form-item label="对内备注">
            <el-input v-model="edit.note" type="textarea" :rows="3" placeholder="处置说明" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" @click="saveRow">保存（演示）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

interface Row {
  id: string
  channel: string
  category: string
  summary: string
  fullText: string
  customer: string
  status: string
  owner: string
  time: string
}

const rows = ref<Row[]>([
  {
    id: 'SG20260330021',
    channel: '在线客服',
    category: '产品功能',
    summary: '希望 APP 增加一键报修进度推送',
    fullText:
      '每次都要打开小程序刷进度，能否像外卖一样有状态推送？另外希望支持上传故障短视频，方便师傅预判配件。',
    customer: '138****6002',
    status: '评审中',
    owner: '产品运营组',
    time: '2026-03-30 09:05:22',
  },
  {
    id: 'SG20260329008',
    channel: 'IVR/问卷',
    category: '服务质量',
    summary: '热线排队音乐过长且无法估算等待时间',
    fullText: '等待十分钟没有名次提示，体验很差，建议播报当前排队位置或回拨选项。',
    customer: '021****7788',
    status: '已登记',
    owner: '—',
    time: '2026-03-29 16:40:00',
  },
  {
    id: 'SG20260328033',
    channel: '官网表单',
    category: '流程政策',
    summary: '以旧换新审核材料过多',
    fullText: '线上只需要身份证照片即可，线下门店还要求纸质发票原件，建议统一口径。',
    customer: 'wang***@mail.com',
    status: '已答复',
    owner: '市场部',
    time: '2026-03-28 11:12:33',
  },
])

const q = ref('')
const fChannel = ref('')
const fCat = ref('')
const fStatus = ref('')

const filtered = computed(() => {
  let list = rows.value
  const s = q.value.trim()
  if (s) {
    list = list.filter(
      (r) => r.id.includes(s) || r.customer.includes(s) || r.summary.includes(s) || r.fullText.includes(s),
    )
  }
  if (fChannel.value) list = list.filter((r) => r.channel === fChannel.value)
  if (fCat.value) list = list.filter((r) => r.category === fCat.value)
  if (fStatus.value) list = list.filter((r) => r.status === fStatus.value)
  return list
})

function statusType(st: string) {
  if (st === '已归档') return 'info'
  if (st === '已答复') return 'success'
  if (st === '评审中') return 'warning'
  return ''
}

const dlg = ref(false)
const row = ref<Row | null>(null)
const edit = ref({ status: '', note: '' })

function openDetail(r: Row) {
  row.value = r
  edit.value = { status: r.status, note: '' }
  dlg.value = true
}

function mergeHint(r: Row) {
  ElMessage.info(`打开同客户/同主题合并向导 · ${r.id}（演示）`)
}

function saveRow() {
  if (row.value) row.value.status = edit.value.status
  ElMessage.success('已保存（演示）')
  dlg.value = false
}
</script>

<style scoped>
.sug-panel {
  min-height: 360px;
}
.sug-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sug-search {
  width: 200px;
}
.sug-mt {
  margin-top: 12px;
}
.sug-form {
  margin-top: 12px;
}
</style>
