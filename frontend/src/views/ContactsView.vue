<template>
  <div class="ct-root">
    <div class="ct-header">
      <h3 class="ct-title">📇 通讯录</h3>
    </div>

    <el-input v-model="query" placeholder="搜索姓名、号码、部门..." clearable class="ct-search" />

    <el-tabs v-model="activeDept" class="ct-tabs">
      <el-tab-pane v-for="g in groups" :key="g.name" :label="`${g.name} (${g.items.length})`" :name="g.name" />
      <el-tab-pane label="全部" name="all" />
    </el-tabs>

    <el-table :data="filteredContacts" stripe border size="small" v-loading="loading" max-height="500">
      <el-table-column label="姓名" width="100">
        <template #default="{ row }">
          <div style="display:flex;align-items:center;gap:6px;">
            <el-avatar :size="28">{{ row.name?.charAt(0) }}</el-avatar>
            <span>{{ row.name }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="department" label="部门" width="120" />
      <el-table-column prop="position" label="职位" width="120" />
      <el-table-column prop="phone" label="电话" width="130" />
      <el-table-column prop="extension" label="分机" width="80" />
      <el-table-column prop="email" label="邮箱" min-width="160" show-overflow-tooltip />
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'online' ? 'success' : row.status === 'busy' ? 'warning' : 'info'" size="small" effect="dark">
            {{ row.status === 'online' ? '在线' : row.status === 'busy' ? '忙碌' : '离线' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link type="primary" @click="callContact(row)">📞 呼叫</el-button>
          <el-button size="small" link @click="viewProfile(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchContacts, type ContactEntry, type ContactGroup } from '@/api/contacts'

const groups = ref<ContactGroup[]>([])
const loading = ref(false)
const query = ref('')
const activeDept = ref('all')

const filteredContacts = computed(() => {
  let list = groups.value.flatMap(g => g.items)
  if (activeDept.value !== 'all') {
    list = groups.value.find(g => g.name === activeDept.value)?.items ?? []
  }
  if (query.value) {
    const q = query.value.toLowerCase()
    list = list.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.department?.toLowerCase().includes(q) || c.position?.toLowerCase().includes(q))
  }
  return list
})

async function load() {
  loading.value = true
  try {
    const res = await fetchContacts()
    groups.value = res.groups ?? []
  } catch {
    groups.value = [
      { name: '管理组', items: [
        { id: 'u1', name: '张经理', phone: '1001', extension: '8001', department: '管理组', position: '客服经理', email: 'zhang@smc.local', status: 'online' },
        { id: 'u2', name: '李主管', phone: '1002', extension: '8002', department: '管理组', position: '值班主管', email: 'li@smc.local', status: 'busy' },
      ]},
      { name: '默认技能组', items: [
        { id: 'u3', name: '坐席001', phone: '1003', extension: '8003', department: '默认技能组', position: '客服代表', email: 'agent01@smc.local', status: 'online' },
        { id: 'u4', name: '坐席002', phone: '1004', extension: '8004', department: '默认技能组', position: '客服代表', email: 'agent02@smc.local', status: 'offline' },
        { id: 'u5', name: '坐席003', phone: '1005', extension: '8005', department: '默认技能组', position: '客服代表', email: 'agent03@smc.local', status: 'online' },
      ]},
      { name: 'VIP技能组', items: [
        { id: 'u6', name: 'VIP坐席01', phone: '1006', extension: '8006', department: 'VIP技能组', position: 'VIP客服', email: 'vip01@smc.local', status: 'busy' },
        { id: 'u7', name: 'VIP坐席02', phone: '1007', extension: '8007', department: 'VIP技能组', position: 'VIP客服', email: 'vip02@smc.local', status: 'online' },
      ]},
      { name: '技术支撑', items: [
        { id: 'u8', name: '王工', phone: '1008', extension: '8008', department: '技术支撑', position: '技术支持', email: 'wang@smc.local', status: 'online' },
      ]},
    ]
  } finally {
    loading.value = false
  }
}

function callContact(row: ContactEntry) { ElMessage.success(`正在呼叫 ${row.name} (${row.phone})...`) }
function viewProfile(row: ContactEntry) { ElMessage.info(`查看 ${row.name} 的详细信息`) }

onMounted(load)
</script>

<style scoped>
.ct-root { padding: 16px; background: var(--oa-card, #fff); border-radius: 8px; min-height: 360px; }
.ct-header { margin-bottom: 12px; }
.ct-title { margin: 0; font-size: 18px; }
.ct-search { max-width: 320px; margin-bottom: 12px; }
.ct-tabs { margin-bottom: 8px; }
</style>
