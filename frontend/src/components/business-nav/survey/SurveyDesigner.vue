<template>
  <div class="sq-panel">
    <el-alert
      title="可视化问卷设计器"
      type="info"
      show-icon
      :closable="false"
      description="支持单选、多选、开放文本（含语音转写占位）、1–5 星评分、NPS（0–10）；保存后可进入「发布与抽样」多渠道下发。"
      class="sq-mb"
    />

    <el-card shadow="never" class="sq-mb">
      <div class="sq-toolbar">
        <el-input v-model="surveyName" placeholder="问卷名称" style="width: 280px" />
        <el-button type="primary" @click="ElMessage.success('已保存草稿（演示）')">保存问卷</el-button>
        <el-button @click="dialogQ = true">添加题目</el-button>
      </div>
      <el-table :data="questions" border stripe size="small">
        <el-table-column prop="sort" label="#" width="48" />
        <el-table-column prop="type" label="题型" width="120" />
        <el-table-column prop="stem" label="题干" min-width="200" show-overflow-tooltip />
        <el-table-column prop="required" label="必填" width="72" align="center">
          <template #default="{ row }">
            <el-tag :type="row.required ? 'danger' : 'info'" size="small">{{ row.required ? '是' : '否' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ $index }">
            <el-button link type="primary" size="small" @click="editMock($index)">编辑</el-button>
            <el-button link type="danger" size="small" @click="questions.splice($index, 1)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <span class="sq-card-title">逻辑跳转</span>
        <span class="sq-sub">若选择某答案则跳转指定题，减少冗余提问</span>
      </template>
      <el-table :data="logicRules" border size="small">
        <el-table-column prop="when" label="条件" min-width="220" />
        <el-table-column prop="then" label="动作" min-width="200" />
        <el-table-column prop="note" label="说明" min-width="160" show-overflow-tooltip />
      </el-table>
    </el-card>

    <el-dialog v-model="dialogQ" title="添加题目" width="520px" destroy-on-close @closed="resetQ">
      <el-form :model="qForm" label-width="88px">
        <el-form-item label="题型">
          <el-select v-model="qForm.type" style="width: 100%">
            <el-option label="单选题" value="单选题" />
            <el-option label="多选题" value="多选题" />
            <el-option label="开放文本（可语音转写）" value="开放题" />
            <el-option label="评分题（1–5 星）" value="评分题" />
            <el-option label="NPS（0–10）" value="NPS" />
          </el-select>
        </el-form-item>
        <el-form-item label="题干">
          <el-input v-model="qForm.stem" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item v-if="qForm.type === '单选题' || qForm.type === '多选题'" label="选项">
          <el-input v-model="qForm.optionsText" type="textarea" :rows="4" placeholder="每行一个选项" />
        </el-form-item>
        <el-form-item label="必填">
          <el-switch v-model="qForm.required" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogQ = false">取消</el-button>
        <el-button type="primary" @click="addQuestion">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const surveyName = ref('通话后满意度调研（IVR+短信）')

const questions = ref([
  { sort: 1, type: '评分题', stem: '请对本次服务整体打分（1-5 星）', required: true },
  { sort: 2, type: '单选题', stem: '您对本次服务是否满意？', required: true },
  { sort: 3, type: '单选题', stem: '若不满意，主要原因是？', required: false },
  { sort: 4, type: '开放题', stem: '其他意见或建议（支持语音留言转写）', required: false },
  { sort: 5, type: 'NPS', stem: '您向亲友推荐我们服务热线可能性（0-10）？', required: true },
])

const logicRules = ref([
  {
    when: '第2题 选择「不满意」',
    then: '跳转至第3题（原因追问）',
    note: '避免对满意客户追问负面细项',
  },
  {
    when: '第2题 选择「满意」或「非常满意」',
    then: '跳过第3题，进入第4题',
    note: '缩短路径，提高完成率',
  },
])

const dialogQ = ref(false)
const qForm = ref({
  type: '单选题',
  stem: '',
  optionsText: '',
  required: true,
})

function resetQ() {
  qForm.value = { type: '单选题', stem: '', optionsText: '', required: true }
}

function addQuestion() {
  if (!qForm.value.stem.trim()) {
    ElMessage.warning('请填写题干')
    return
  }
  questions.value.push({
    sort: questions.value.length + 1,
    type: qForm.value.type,
    stem: qForm.value.stem,
    required: qForm.value.required,
  })
  dialogQ.value = false
}

function editMock(i: number) {
  ElMessage.info(`编辑第 ${i + 1} 题（演示）`)
}
</script>

<style scoped>
.sq-panel .sq-mb {
  margin-bottom: 12px;
}
.sq-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.sq-card-title {
  font-weight: 600;
  margin-right: 8px;
}
.sq-sub {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}
</style>
