<template>
  <div class="cu-wrap">
    <header class="cu-head">
      <el-button text class="cu-back" @click="back">
        <el-icon :size="18"><ArrowLeft /></el-icon>
      </el-button>
      <span class="cu-title">客户资料</span>
    </header>

    <el-skeleton v-if="loading" :rows="6" animated class="cu-card" />
    <el-empty v-else-if="!profile.id" description="未找到客户资料" />

    <template v-else>
      <section class="cu-card">
        <div class="cu-name">{{ profile.name || '未命名客户' }}</div>
        <div v-if="profile.tags?.length" class="cu-tags">
          <el-tag v-for="tag in profile.tags" :key="tag" size="small" effect="plain">{{ tag }}</el-tag>
        </div>
        <dl class="cu-fields">
          <template v-for="field in fields" :key="field.label">
            <dt>{{ field.label }}</dt>
            <dd>
              <span>{{ field.value || '—' }}</span>
              <el-button
                v-if="field.callable && field.value"
                size="small"
                text
                type="primary"
                @click="call(field.value)"
              >
                呼叫
              </el-button>
            </dd>
          </template>
        </dl>
      </section>

      <section v-if="profile.call_records?.length" class="cu-card">
        <h3 class="cu-sub">最近通话</h3>
        <ul class="cu-records">
          <li v-for="(rec, idx) in profile.call_records.slice(0, 10)" :key="idx">
            <span class="cu-rec-time">{{ rec.time || rec.created_at || '' }}</span>
            <span class="cu-rec-dir">{{ rec.direction || '' }}</span>
            <span class="cu-rec-dur">{{ rec.duration || '' }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { api } from '@/api/client'

defineOptions({ name: 'MobileCustomer' })

interface CallRecordRow {
  time?: string
  created_at?: string
  direction?: string
  duration?: string
}

interface CustomerProfile {
  id?: number | string
  name?: string
  phone?: string
  email?: string
  gender?: string
  customer_type?: string
  level?: string
  company?: string
  address?: string
  tags?: string[]
  call_records?: CallRecordRow[]
}

const route = useRoute()
const router = useRouter()

const profile = ref<CustomerProfile>({})
const loading = ref(false)

const fields = computed(() => [
  { label: '手机', value: profile.value.phone ?? '', callable: true },
  { label: '邮箱', value: profile.value.email ?? '', callable: false },
  { label: '性别', value: profile.value.gender ?? '', callable: false },
  { label: '客户类型', value: profile.value.customer_type ?? '', callable: false },
  { label: '等级', value: profile.value.level ?? '', callable: false },
  { label: '公司', value: profile.value.company ?? '', callable: false },
  { label: '地址', value: profile.value.address ?? '', callable: false },
])

async function load() {
  const id = String(route.params.id ?? '')
  if (!id) return
  loading.value = true
  try {
    const { data } = await api.get<CustomerProfile>(`/api/omnichannel/customers/${id}`)
    profile.value = data ?? {}
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载客户资料失败')
  } finally {
    loading.value = false
  }
}

function back() {
  if (window.history.length > 1) router.back()
  else void router.push('/m/sessions')
}

function call(number: string) {
  void router.push({ path: '/m/dialer', query: { callee: number } })
}

watch(() => route.params.id, () => void load())
onMounted(() => void load())
</script>

<style scoped>
.cu-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cu-head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.cu-back {
  width: 40px;
  height: 40px;
}
.cu-title {
  font-size: 15px;
  font-weight: 600;
}

.cu-card {
  background: var(--oa-card);
  border-radius: 8px;
  padding: 12px;
}

.cu-name {
  font-size: 17px;
  font-weight: 700;
}

.cu-tags {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cu-fields {
  margin: 10px 0 0;
  display: grid;
  grid-template-columns: 72px 1fr;
  row-gap: 8px;
  column-gap: 8px;
  font-size: 13px;
}
.cu-fields dt {
  color: var(--oa-muted);
}
.cu-fields dd {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  word-break: break-all;
}

.cu-sub {
  margin: 0 0 8px;
  font-size: 14px;
}

.cu-records {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12px;
}
.cu-records li {
  display: flex;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f0f2f5;
}
.cu-records li:last-child {
  border-bottom: none;
}
.cu-rec-time {
  flex: 1;
  color: #606266;
}
.cu-rec-dir,
.cu-rec-dur {
  color: var(--oa-muted);
}
</style>
