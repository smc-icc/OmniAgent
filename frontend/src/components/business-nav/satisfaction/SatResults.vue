<template>
  <div class="sat-panel">
    <div class="sat-toolbar">
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始"
        end-placeholder="结束"
        size="small"
        value-format="YYYY-MM-DD"
      />
      <el-select v-model="dim" placeholder="维度" size="small" style="width: 120px">
        <el-option label="全中心" value="全中心" />
        <el-option label="技能组" value="技能组" />
        <el-option label="坐席" value="坐席" />
      </el-select>
      <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
    </div>

    <el-row :gutter="12" class="sat-mt">
      <el-col :xs="24" :md="8">
        <el-card shadow="never" class="sat-mini">
          <div class="sat-mini-label">有效回收量</div>
          <div class="sat-mini-val">{{ summary.count }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="8">
        <el-card shadow="never" class="sat-mini">
          <div class="sat-mini-label">均分（5 分制）</div>
          <div class="sat-mini-val">{{ summary.avg_rating ?? '—' }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="8">
        <el-card shadow="never" class="sat-mini">
          <div class="sat-mini-label">低分占比（≤2 星）</div>
          <div class="sat-mini-val" :class="{ warn: summary.low_pct > 5 }">{{ summary.low_pct }}%</div>
        </el-card>
      </el-col>
    </el-row>

    <el-table :data="detailRows" border stripe size="small" class="sat-mt" max-height="320">
      <el-table-column prop="period" label="周期" width="200" />
      <el-table-column prop="queue" label="队列/技能组" min-width="120" show-overflow-tooltip />
      <el-table-column prop="sent" label="会话量" width="88" />
      <el-table-column prop="recv" label="回收" width="88" />
      <el-table-column prop="rate" label="回收率" width="88" />
      <el-table-column prop="csat" label="CSAT" width="80">
        <template #default="{ row }">
          <el-tag :type="Number(row.csat) >= 90 ? 'success' : 'warning'" size="small">{{ row.csat }}%</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="avg" label="均分" width="72" />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api/client'

const dateRange = ref<[string, string] | ''>('')
const dim = ref('全中心')
const loading = ref(false)
const summary = ref({ count: 0, avg_rating: null as number | null, csat_pct: null as number | null, low_pct: 0 })
const detailRows = ref<Array<{ period: string; queue: string; sent: string; recv: string; rate: string; csat: string; avg: string }>>([])

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/api/omnichannel/csat/summary', {
      params: {
        dim: dim.value,
        from: dateRange.value ? dateRange.value[0] : undefined,
        to: dateRange.value ? dateRange.value[1] : undefined,
      },
    })
    summary.value = {
      count: data.count || 0,
      avg_rating: data.avg_rating ?? null,
      csat_pct: data.csat_pct ?? null,
      low_pct: data.low_pct || 0,
    }
    detailRows.value = data.rows || []
  } catch {
    ElMessage.error('满意度查询失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<style scoped>
.sat-panel {
  min-height: 360px;
}
.sat-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.sat-mt {
  margin-top: 12px;
}
.sat-mini-label {
  font-size: 12px;
  color: #909399;
}
.sat-mini-val {
  font-size: 22px;
  font-weight: 600;
  margin-top: 4px;
}
.sat-mini-val.warn {
  color: #e6a23c;
}
</style>
