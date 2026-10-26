<template>
  <el-dialog :model-value="true" :title="operator ? '修改操作员' : '添加操作员'" width="760px" :close-on-click-modal="false" :before-close="close" class="access-dialog">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="126px" label-position="right" @submit.prevent="save">
      <h4>基本信息</h4>
      <div class="form-grid">
        <el-form-item label="操作员工号" prop="work_no"><el-input v-model="form.work_no" :disabled="!!operator" maxlength="50" /></el-form-item>
        <el-form-item label="操作员名称" prop="name"><el-input v-model="form.name" maxlength="100" /></el-form-item>
        <el-form-item label="操作员密码" prop="password"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" :placeholder="operator ? '留空保留原密码' : '请输入至少 6 位密码'" maxlength="50" /></el-form-item>
        <el-form-item label="邮箱" prop="email"><el-input v-model="form.email" placeholder="留空自动生成登录邮箱" maxlength="50" /></el-form-item>
        <el-form-item label="软件分机"><span>{{ form.extension || '未绑定' }} · 请在分机绑定管理中分配或解绑</span></el-form-item>
        <el-form-item label="外呼主叫号码"><el-input v-model="form.called_tel" maxlength="50" /></el-form-item>
        <el-form-item label="手机号码"><div><el-input v-model="form.mobile" maxlength="50" /><p style="margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 12px">关联短信登录：同一手机号可用于不同 VDN，在本 VDN 内需唯一。</p></div></el-form-item>
        <el-form-item label="默认坐席组"><el-select v-model="form.default_group" filterable><el-option label="未设置" :value="0" /><el-option v-for="g in data.groups" :key="g.id" :value="g.id" :label="g.name" /></el-select></el-form-item>
        <el-form-item label="激活状态"><el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" /></el-form-item>
      </div>
      <h4>通话控制参数</h4>
      <div class="form-grid">
        <el-form-item label="客户挂机后"><el-select v-model="form.client_release_mode"><el-option label="坐席持续播放催挂音" :value="0" /><el-option label="催挂音超时后自动挂断" :value="1" /><el-option label="仍有保持客户时转保持" :value="2" /></el-select></el-form-item>
        <el-form-item label="坐席挂机后"><el-select v-model="form.agent_release_mode"><el-option label="结束客户通话" :value="0" /><el-option label="客户进入满意度调查" :value="1" /></el-select></el-form-item>
        <el-form-item label="来电自动应答"><el-switch v-model="form.auto_answer" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item label="不播报工号"><el-switch v-model="form.not_play_work_no" :active-value="1" :inactive-value="0" /></el-form-item>
        <el-form-item label="摘挂机方式"><el-select v-model="form.hook_mode"><el-option label="话机摘挂机" :value="1" /><el-option label="软件摘挂机" :value="2" /></el-select></el-form-item>
      </div>
      <h4>电话坐席参数</h4>
      <div class="form-grid">
        <el-form-item label="启用电话坐席"><el-switch v-model="form.use_tel_agent" /></el-form-item>
        <el-form-item label="电话坐席分机"><el-select v-model="form.tel_extension" filterable clearable placeholder="请选择分机号" :disabled="!form.use_tel_agent"><el-option v-for="e in data.extensions" :key="e.num" :value="e.num" :label="e.num" /></el-select></el-form-item>
        <el-form-item label="是否自动代拨"><el-switch v-model="form.auto_dial" :disabled="!form.use_tel_agent" /></el-form-item>
        <el-form-item label="自动代拨号码"><el-input v-model="form.auto_dial_no" :disabled="!form.use_tel_agent || !form.auto_dial" maxlength="50" /></el-form-item>
      </div>
    </el-form>
    <template #footer><el-button :disabled="saving" @click="emit('close')">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { accessApi, accessError, type Bootstrap, type Operator } from '@/api/access'
const props = defineProps<{ operator?: Operator; data: Bootstrap }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const u = props.operator
const form = reactive({ work_no: u?.work_no ?? '', name: u?.name ?? '', password: '', email: u?.email ?? '', extension: u?.extension ?? '', called_tel: u?.called_tel ?? '', mobile: u?.mobile ?? '', enabled: u ? !!u.enabled : true, default_group: u?.default_group ?? 0, client_release_mode: u?.client_release_mode ?? 1, agent_release_mode: u?.agent_release_mode ?? 0, auto_answer: u?.auto_answer ?? 0, not_play_work_no: u?.not_play_work_no ?? 0, hook_mode: u?.hook_mode ?? 2, use_tel_agent: !!u?.use_tel_agent, tel_extension: u?.tel_extension ?? '', auto_dial: !!u?.auto_dial, auto_dial_no: u?.auto_dial_no ?? '' })
const formRef = ref<FormInstance>(), saving = ref(false)
const rules: FormRules = {
  work_no: [{ required: true, message: '请输入工号', trigger: 'blur' }, { pattern: /^[A-Za-z0-9_-]+$/, message: '工号仅支持字母、数字、下划线和短横线' }],
  name: [{ required: true, whitespace: true, message: '请输入姓名', trigger: 'blur' }],
  password: [{ validator: (_r, value, cb) => { if ((!u && !value) || (value && value.length < 6)) cb(new Error('密码至少 6 位')); else cb() }, trigger: 'blur' }],
  email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }],
}
function close(done: () => void) { if (!saving.value) { done(); emit('close') } }
async function save() {
  if (saving.value || !await formRef.value?.validate().catch(() => false)) return
  saving.value = true
  try {
    const { password, ...rest } = form
    const result = await accessApi.saveUser(u?.id, { ...rest, ...(password ? { password } : {}) })
    if (result.sync_pending) ElMessage.warning(result.message || '已保存，请重新同步全媒体账号')
    else ElMessage.success('操作员已保存并同步全媒体账号')
    emit('saved')
  } catch (e) { ElMessage.error(accessError(e)) } finally { saving.value = false }
}
</script>
<style scoped>
h4 { background: var(--el-fill-color-light); padding: 9px 12px; margin: 0 0 16px; font-size: 14px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; } .el-select { width: 100%; }
@media(max-width: 650px) { .form-grid { grid-template-columns: 1fr; } }
</style>
