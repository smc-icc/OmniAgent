<template>
  <div class="cu-page">
    <div class="cu-head">
      <h3>客户管理</h3>
      <div class="cu-head-right">
        <el-button @click="$router.push({ name: 'opportunities' })">商机看板</el-button>
        <el-input
          v-model="query"
          clearable
          placeholder="搜索姓名 / 手机 / 邮箱"
          class="cu-search"
          @keyup.enter="load"
        >
          <template #append>
            <el-button @click="load">搜索</el-button>
          </template>
        </el-input>
      </div>
    </div>

    <el-table v-loading="loading" :data="items" stripe border size="small" @row-click="onRow">
      <el-table-column prop="id" label="ID" width="72" />
      <el-table-column prop="name" label="姓名" min-width="120" />
      <el-table-column prop="phone" label="手机" min-width="120" />
      <el-table-column prop="email" label="邮箱" min-width="160" show-overflow-tooltip />
      <el-table-column label="标签" min-width="140">
        <template #default="{ row }">
          <el-tag
            v-for="l in row.labels || []"
            :key="l.id"
            size="small"
            class="cu-tag"
            :style="{ borderColor: l.color, color: l.color }"
          >
            {{ l.title }}
          </el-tag>
          <span v-if="!(row.labels && row.labels.length)">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="location" label="地区" min-width="120" show-overflow-tooltip />
      <el-table-column label="最近备注" min-width="160">
        <template #default="{ row }">
          {{ formatTs(row.last_note_at) }}
        </template>
      </el-table-column>
      <el-table-column label="最近活动" min-width="160">
        <template #default="{ row }">
          {{ formatTs(row.last_activity_at) }}
        </template>
      </el-table-column>
    </el-table>

    <div class="cu-pager">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="load"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchCustomers, type CustomerListItem } from '@/api/customers'

const router = useRouter()
const loading = ref(false)
const query = ref('')
const page = ref(1)
const pageSize = 20
const total = ref(0)
const items = ref<CustomerListItem[]>([])

function formatTs(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleString('zh-CN')
}

async function load() {
  loading.value = true
  try {
    const data = await fetchCustomers({ q: query.value || undefined, page: page.value, page_size: pageSize })
    items.value = data.items
    total.value = data.total
  } catch {
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onRow(row: CustomerListItem) {
  router.push({ name: 'customer-profile', params: { id: String(row.id) } })
}

onMounted(load)
</script>

<style scoped>
.cu-page {
  width: 100%;
}
.cu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.cu-head h3 {
  margin: 0;
  font-size: 18px;
}
.cu-head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cu-search {
  max-width: 360px;
}
.cu-pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
:deep(.el-table__row) {
  cursor: pointer;
}
.cu-tag {
  margin-right: 4px;
  background: transparent;
}
</style>
