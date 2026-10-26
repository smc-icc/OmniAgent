<template>
  <div class="rb-panel">
    <el-alert title="红名单 · VIP 与保护" type="success" show-icon :closable="false" class="rb-mb">
      <template #default>
        <p class="rb-alert-p">
          优先路由、弹屏强提醒、敏感字段权限锁定、销户/退订等敏感操作拦截需班长授权。
        </p>
      </template>
    </el-alert>

    <div class="rb-toolbar">
      <el-input v-model="query" placeholder="搜索脱敏号码 / 客户编号" clearable style="width: 240px" />
      <el-select v-model="fltType" placeholder="类型" clearable style="width: 140px">
        <el-option label="高价值 VIP" value="VIP" />
        <el-option label="特殊关怀" value="关怀" />
        <el-option label="内部号码" value="内部" />
      </el-select>
      <el-button type="primary" @click="openAdd">新增红名单</el-button>
    </div>

    <el-table :data="filtered" border stripe size="small" class="rb-mt">
      <el-table-column prop="mask" label="号码/标识（脱敏）" width="140" />
      <el-table-column prop="type" label="类型" width="110" />
      <el-table-column prop="level" label="等级" width="100" />
      <el-table-column prop="route" label="路由策略" min-width="160" show-overflow-tooltip />
      <el-table-column prop="popup" label="弹屏标识" min-width="140" show-overflow-tooltip />
      <el-table-column label="敏感保护" width="200">
        <template #default="{ row }">
          <el-tag v-if="row.lockField" size="small" type="warning">字段锁定</el-tag>
          <el-tag v-if="row.sensitiveOp" size="small" type="danger" class="rb-tag-gap">敏感操作拦截</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default>
          <el-button link type="primary" size="small">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg" title="新增红名单" width="560px" destroy-on-close>
      <el-form :model="form" label-width="112px">
        <el-form-item label="号码/客户ID" required>
          <el-input v-model="form.id" placeholder="演示" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option label="高价值 VIP" value="VIP" />
            <el-option label="特殊关怀" value="关怀" />
            <el-option label="内部号码" value="内部" />
          </el-select>
        </el-form-item>
        <el-form-item label="路由">
          <el-input v-model="form.route" placeholder="如：跳过公共队列 → VIP_SKILL_01" />
        </el-form-item>
        <el-form-item label="弹屏文案">
          <el-input v-model="form.popup" type="textarea" :rows="2" placeholder="金色/强提醒文案" />
        </el-form-item>
        <el-form-item label="保护项">
          <el-checkbox v-model="form.lockField">关键字段二级授权</el-checkbox>
          <el-checkbox v-model="form.sensitiveOp">销户/退订拦截</el-checkbox>
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

interface RRow {
  mask: string
  type: string
  level: string
  route: string
  popup: string
  lockField: boolean
  sensitiveOp: boolean
}

const rows = ref<RRow[]>([
  {
    mask: '139****6688',
    type: 'VIP',
    level: '钻石',
    route: '优先 → 资深组 / 客户经理座席',
    popup: '【VIP】请务必规范流程，挂机前确认满意度',
    lockField: true,
    sensitiveOp: true,
  },
  {
    mask: '用户 GZ-90821',
    type: '关怀',
    level: '高龄关怀',
    route: '文字通道优先 / 延长服务时长阈值',
    popup: '【关怀】请耐心沟通，可申请慢速口径脚本',
    lockField: false,
    sensitiveOp: false,
  },
  {
    mask: '010****2288',
    type: '内部',
    level: '监管专线',
    route: '直通常务值班席',
    popup: '【内部/监管】录音强制留存',
    lockField: true,
    sensitiveOp: true,
  },
])

const query = ref('')
const fltType = ref('')

const filtered = computed(() => {
  let r = rows.value
  const q = query.value.trim()
  if (q) r = r.filter((x) => x.mask.includes(q))
  if (fltType.value) r = r.filter((x) => x.type === fltType.value)
  return r
})

const dlg = ref(false)
const form = ref({
  id: '',
  type: 'VIP',
  route: '',
  popup: '',
  lockField: true,
  sensitiveOp: true,
})

function openAdd() {
  form.value = {
    id: '',
    type: 'VIP',
    route: '',
    popup: '',
    lockField: true,
    sensitiveOp: true,
  }
  dlg.value = true
}

function save() {
  ElMessage.success('已保存并记审计日志（演示）')
  dlg.value = false
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
}
.rb-mt {
  margin-top: 12px;
}
.rb-tag-gap {
  margin-left: 6px;
}
</style>
