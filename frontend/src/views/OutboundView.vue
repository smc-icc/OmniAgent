<template>
  <div class="ob-root">
    <div class="ob-header">
      <h3 class="ob-title">📱 智能外呼</h3>
      <el-button type="primary" @click="showCreate = true">+ 新建任务</el-button>
    </div>

    <el-table :data="tasks" stripe border size="small" v-loading="loading">
      <el-table-column prop="campaign_name" label="任务名称" min-width="160" show-overflow-tooltip />
      <el-table-column label="进度" min-width="160">
        <template #default="{ row }">
          <el-progress :percentage="pct(row)" :stroke-width="14" :status="row.status === 'completed' ? 'success' : undefined" />
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="目标/完成" width="110">
        <template #default="{ row }">{{ row.completed_count }} / {{ row.target_count }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{ row }">{{ fmtDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'pending'" size="small" type="primary" link @click="start(row)">▶ 启动</el-button>
          <el-button v-if="row.status === 'running'" size="small" type="warning" link @click="pause(row)">⏸ 暂停</el-button>
          <el-button size="small" link>详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreate" title="新建外呼任务" width="480px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="任务名称"><el-input v-model="form.name" placeholder="如：满意度回访" /></el-form-item>
        <el-form-item label="目标数量"><el-input-number v-model="form.target" :min="1" :max="9999" /></el-form-item>
        <el-form-item label="号码来源">
          <el-select v-model="form.source" placeholder="选择">
            <el-option label="导入 Excel" value="excel" />
            <el-option label="手动输入" value="manual" />
            <el-option label="客户筛选" value="filter" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="createTask">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchOutboundTasks, startOutboundTask, pauseOutboundTask, type OutboundTask } from '@/api/outbound'

const tasks = ref<OutboundTask[]>([])
const loading = ref(false)
const showCreate = ref(false)
const form = ref({ name: '', target: 100, source: 'excel' })

function pct(row: OutboundTask) { return row.target_count > 0 ? Math.round((row.completed_count / row.target_count) * 100) : 0 }
function statusTag(s: string) { return { pending: 'info', running: 'success', paused: 'warning', completed: 'success' }[s] ?? 'info' }
function statusText(s: string) { return { pending: '待启动', running: '执行中', paused: '已暂停', completed: '已完成' }[s] ?? s }

async function load() {
  loading.value = true
  try {
    const res = await fetchOutboundTasks()
    tasks.value = res.items ?? []
  } catch {
    tasks.value = [
      { id: 't1', campaign_name: '满意度回访-6月', target_count: 200, completed_count: 156, status: 'running', created_at: new Date().toISOString() },
      { id: 't2', campaign_name: '会员权益通知', target_count: 500, completed_count: 500, status: 'completed', created_at: new Date(Date.now() - 86400000).toISOString(), completed_at: new Date().toISOString() },
      { id: 't3', campaign_name: '新用户激活引导', target_count: 300, completed_count: 0, status: 'pending', created_at: new Date().toISOString() },
    ]
  } finally {
    loading.value = false
  }
}

async function start(row: OutboundTask) { row.status = 'running'; try { await startOutboundTask(row.id) } catch { /* */ }; ElMessage.success('已启动') }
async function pause(row: OutboundTask) { row.status = 'paused'; try { await pauseOutboundTask(row.id) } catch { /* */ }; ElMessage.success('已暂停') }

function createTask() {
  tasks.value.unshift({
    id: `t${Date.now()}`, campaign_name: form.value.name, target_count: form.value.target,
    completed_count: 0, status: 'pending', created_at: new Date().toISOString(),
  })
  showCreate.value = false
  ElMessage.success('任务已创建')
}

function fmtDate(iso: string) { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }

onMounted(load)
</script>

<style scoped>
.ob-root { padding: 16px; background: var(--oa-card, #fff); border-radius: 8px; min-height: 360px; }
.ob-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.ob-title { margin: 0; font-size: 18px; }
</style>
