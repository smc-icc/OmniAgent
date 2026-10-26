<template>
  <div class="ob-page" v-loading="loading">
    <div class="ob-head">
      <h3>商机看板</h3>
      <div class="ob-actions">
        <el-button @click="router.push({ name: 'customers' })">客户列表</el-button>
        <el-button type="primary" @click="openCreate">新建商机</el-button>
      </div>
    </div>

    <div class="ob-board">
      <div v-for="stage in stages" :key="stage" class="ob-col">
        <div class="ob-col-head">
          <span>{{ stageLabel(stage) }}</span>
          <el-tag size="small" type="info">{{ byStage(stage).length }}</el-tag>
        </div>
        <div class="ob-col-body">
          <div
            v-for="item in byStage(stage)"
            :key="item.id"
            class="ob-card"
            draggable="true"
            @dragstart="onDragStart(item.id)"
            @dragover.prevent
            @drop="onDrop(stage)"
          >
            <div class="ob-title">{{ item.title }}</div>
            <div class="ob-meta">
              <span v-if="item.contact_name">{{ item.contact_name }}</span>
              <span v-if="item.company_name"> · {{ item.company_name }}</span>
            </div>
            <div class="ob-amount">{{ formatAmount(item.amount, item.currency) }}</div>
            <div v-if="item.expected_close" class="ob-close">关闭 {{ formatClose(item.expected_close) }}</div>
            <div class="ob-ops">
              <el-button
                v-if="item.contact_id"
                link
                type="primary"
                size="small"
                @click="router.push({ name: 'customer-profile', params: { id: String(item.contact_id) } })"
              >
                画像
              </el-button>
              <el-button link type="danger" size="small" @click="remove(item.id)">删除</el-button>
            </div>
          </div>
          <el-empty v-if="!byStage(stage).length" description="暂无" :image-size="40" />
        </div>
      </div>
    </div>

    <el-dialog v-model="dlg" title="新建商机" width="440px">
      <el-form label-width="72px" size="small">
        <el-form-item label="标题">
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="阶段">
          <el-select v-model="form.stage" style="width: 100%">
            <el-option v-for="s in stages" :key="s" :label="stageLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number v-model="form.amount" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="关闭日">
          <el-date-picker
            v-model="form.expected_close"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="预计关闭日期"
            style="width: 100%"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" :loading="saving" @click="submit">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchOpportunities,
  createOpportunity,
  patchOpportunity,
  deleteOpportunity,
} from '@/api/customers'

const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const dlg = ref(false)
const dragId = ref<number | null>(null)

const stages = ['new', 'qualifying', 'proposal', 'won', 'lost'] as const

type OppItem = {
  id: number
  title: string
  stage: string
  amount: number | null
  currency: string
  contact_id: number | null
  company_id: number | null
  contact_name?: string
  company_name?: string
  expected_close?: string | null
}

const items = ref<OppItem[]>([])
const form = reactive({
  title: '',
  stage: 'new',
  amount: 0 as number | null,
  expected_close: null as string | null,
})

function stageLabel(s: string) {
  const map: Record<string, string> = {
    new: '新建',
    qualifying: '确认需求',
    proposal: '方案/报价',
    won: '赢单',
    lost: '丢单',
  }
  return map[s] || s
}

function byStage(stage: string) {
  return items.value.filter((i) => i.stage === stage)
}

function formatAmount(amount: number | null, currency: string) {
  if (amount == null) return '—'
  return `${currency} ${amount}`
}

function formatClose(iso: string) {
  return iso.slice(0, 10)
}

async function reload() {
  loading.value = true
  try {
    items.value = await fetchOpportunities()
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.title = ''
  form.stage = 'new'
  form.amount = 0
  form.expected_close = null
  dlg.value = true
}

async function submit() {
  if (!form.title.trim()) {
    ElMessage.warning('请填写标题')
    return
  }
  saving.value = true
  try {
    await createOpportunity({
      title: form.title,
      stage: form.stage,
      amount: form.amount,
      expected_close: form.expected_close || null,
    })
    dlg.value = false
    await reload()
    ElMessage.success('已创建')
  } catch {
    ElMessage.error('创建失败')
  } finally {
    saving.value = false
  }
}

function onDragStart(id: number) {
  dragId.value = id
}

async function onDrop(stage: string) {
  const id = dragId.value
  dragId.value = null
  if (id == null) return
  const row = items.value.find((i) => i.id === id)
  if (!row || row.stage === stage) return
  try {
    await patchOpportunity(id, { stage })
    row.stage = stage
  } catch {
    ElMessage.error('更新阶段失败')
  }
}

async function remove(id: number) {
  try {
    await ElMessageBox.confirm('确认删除该商机？', '删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteOpportunity(id)
    await reload()
  } catch {
    ElMessage.error('删除失败')
  }
}

onMounted(reload)
</script>

<style scoped>
.ob-page {
  width: 100%;
}
.ob-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.ob-head h3 {
  margin: 0;
  font-size: 18px;
}
.ob-actions {
  display: flex;
  gap: 8px;
}
.ob-board {
  display: grid;
  grid-template-columns: repeat(5, minmax(180px, 1fr));
  gap: 10px;
  overflow-x: auto;
}
.ob-col {
  background: #f5f7fa;
  border-radius: 8px;
  min-height: 420px;
  display: flex;
  flex-direction: column;
}
.ob-col-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid #e4e7ed;
}
.ob-col-body {
  padding: 8px;
  flex: 1;
}
.ob-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: grab;
}
.ob-title {
  font-weight: 600;
  font-size: 13px;
}
.ob-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}
.ob-amount {
  margin-top: 6px;
  font-size: 12px;
  color: var(--oa-primary, #0066b3);
}
.ob-close {
  margin-top: 4px;
  font-size: 11px;
  color: #909399;
}
.ob-ops {
  margin-top: 6px;
  display: flex;
  gap: 4px;
}
</style>
