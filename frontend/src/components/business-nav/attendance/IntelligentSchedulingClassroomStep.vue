<template>
  <div v-loading="loading" class="iscr">
    <el-alert type="info" :closable="false" class="iscr-alert" :title="summary" />
    <div class="iscr-toolbar">
      <span class="iscr-hint">根据当前课表结果统计各教室周占用节次数，超载时请到「课表调整」释放冲突。</span>
      <el-button size="small" @click="reload">刷新</el-button>
    </div>
    <el-table :data="rooms" border size="small" stripe max-height="420">
      <el-table-column prop="name" label="教室名称" min-width="120" />
      <el-table-column prop="room_type" label="类型" width="100" />
      <el-table-column prop="capacity" label="容量(座)" width="88" align="center" />
      <el-table-column prop="used_slots_week" label="本周已占节次" width="120" align="center" />
      <el-table-column prop="capacity_slots_week" label="周可排节次上限" width="130" align="center" />
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ok' ? 'success' : 'warning'" size="small">
            {{ row.status === 'ok' ? '正常' : '关注' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="overload" label="超载节次" width="88" align="center">
        <template #default="{ row }">
          <span :class="{ 'iscr-warn': row.overload > 0 }">{{ row.overload }}</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { onMounted, ref, watch } from 'vue'
import {
  type ClassroomArrangementRoom,
  fetchIntelligentSchedulingWizardClassroomArrangement,
} from '@/api/intelligentScheduling'

const props = defineProps<{ taskId: string }>()

const loading = ref(false)
const summary = ref('')
const rooms = ref<ClassroomArrangementRoom[]>([])

async function reload() {
  if (!props.taskId) return
  loading.value = true
  try {
    const d = await fetchIntelligentSchedulingWizardClassroomArrangement(props.taskId)
    summary.value = d.summary
    rooms.value = d.rooms
  } catch {
    ElMessage.error('加载教室安排失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.taskId,
  () => {
    void reload()
  },
)

onMounted(() => {
  void reload()
})
</script>

<style scoped>
.iscr {
  min-height: 360px;
}
.iscr-alert {
  margin-bottom: 12px;
}
.iscr-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.iscr-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.iscr-warn {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>
