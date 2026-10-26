<template>
  <el-dialog v-model="visible" title="发送红包" width="400px" @closed="onClosed">
    <el-form label-width="80px">
      <el-form-item label="祝福语" required>
        <el-input v-model="title" placeholder="恭喜发财，大吉大利" maxlength="50" show-word-limit />
      </el-form-item>
      <el-form-item label="金额">
        <el-input v-model="amount" placeholder="仅展示用，可选" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!title.trim()" @click="confirm">发送</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  confirm: [payload: { title: string; amount?: string }]
}>()

const visible = ref(props.modelValue)
const title = ref('恭喜发财，大吉大利')
const amount = ref('')

watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
  },
)
watch(visible, (v) => emit('update:modelValue', v))

function confirm() {
  if (!title.value.trim()) return
  emit('confirm', { title: title.value.trim(), amount: amount.value.trim() || undefined })
  visible.value = false
}

function onClosed() {
  title.value = '恭喜发财，大吉大利'
  amount.value = ''
}
</script>
