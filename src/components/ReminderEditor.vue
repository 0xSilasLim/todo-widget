<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { HOUR, localDateParts, parseLocalDeadline } from '../services/deadlines'
import { nextReminderTime } from '../services/reminders'

const props = defineProps<{ modelValue: number | null; idPrefix: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; validity: [valid: boolean] }>()
// An unchanged, previously saved reminder may be in the past when editing a task.
const originalValue = props.modelValue
const date = ref('')
const time = ref('')
const error = ref('')
const dateInput = ref<HTMLInputElement>()
const timeInput = ref<HTMLInputElement>()

watch(() => props.modelValue, (value) => {
  const parts = localDateParts(value ?? nextReminderTime())
  date.value = value == null ? '' : parts.date
  time.value = parts.time
  error.value = ''
}, { immediate: true })

function validate() {
  const original = originalValue == null ? null : localDateParts(originalValue)
  const unchanged = original != null && date.value === original.date && time.value === original.time
  const value = unchanged ? originalValue : date.value ? parseLocalDeadline(date.value, time.value) : null
  if (dateInput.value?.validity.badInput || timeInput.value?.validity.badInput || (date.value && value == null)) {
    error.value = '请选择有效的提醒日期和时间。'
  } else if (value != null && value <= Date.now() && value !== originalValue) {
    error.value = '提醒时间需要晚于当前时间。'
  } else error.value = ''
  emit('validity', !error.value)
  if (!error.value) emit('update:modelValue', value)
  return !error.value
}

async function shortcut(delay: number) {
  const parts = localDateParts(nextReminderTime(delay))
  date.value = parts.date
  time.value = parts.time
  await nextTick()
  validate()
}

async function clear() { date.value = ''; await nextTick(); validate() }
defineExpose({ focus: () => dateInput.value?.focus(), validate })
</script>

<template>
  <fieldset class="deadline-editor reminder-editor" :disabled="disabled">
    <legend>提醒时间（可选）</legend>
    <div class="deadline-fields">
      <label :for="`${idPrefix}-date`">日期<input :id="`${idPrefix}-date`" ref="dateInput" v-model="date" type="date"
        min="1970-01-01" max="9999-12-31" :aria-invalid="!!error" :aria-describedby="`${idPrefix}-hint`" @input="validate" /></label>
      <label :for="`${idPrefix}-time`">时间<input :id="`${idPrefix}-time`" ref="timeInput" v-model="time" type="time" :disabled="!date"
        :aria-invalid="!!error" :aria-describedby="`${idPrefix}-hint`" @input="validate" /></label>
    </div>
    <div class="deadline-shortcuts">
      <button type="button" @click="shortcut(10 * 60_000)">10 分钟后</button><button type="button" @click="shortcut(HOUR)">1 小时后</button>
      <button type="button" :disabled="!date" @click="clear">清除提醒</button>
    </div>
    <p :id="`${idPrefix}-hint`" class="hint">按本地时间提醒一次，请保持应用运行（可最小化）。</p>
    <span v-if="error" class="field-error" role="alert">{{ error }}</span>
  </fieldset>
</template>
