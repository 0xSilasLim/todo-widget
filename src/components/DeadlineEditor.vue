<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { localDateParts, parseLocalDeadline } from '../services/deadlines'

const props = defineProps<{ modelValue: number | null; idPrefix: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; validity: [valid: boolean] }>()
const date = ref('')
const time = ref('23:59')
const invalid = ref(false)
const dateInput = ref<HTMLInputElement>()
const timeInput = ref<HTMLInputElement>()

watch(() => props.modelValue, (value) => {
  const parts = value == null ? { date: '', time: '23:59' } : localDateParts(value)
  date.value = parts.date
  time.value = parts.time
  invalid.value = false
}, { immediate: true })

function update() {
  const result = date.value ? parseLocalDeadline(date.value, time.value || '23:59') : null
  invalid.value = !!dateInput.value?.validity.badInput || !!timeInput.value?.validity.badInput || (!!date.value && result == null)
  emit('validity', !invalid.value)
  if (!invalid.value) emit('update:modelValue', result)
}

async function shortcut(offset: number) {
  const day = new Date()
  day.setDate(day.getDate() + offset)
  date.value = localDateParts(day.getTime()).date
  if (!time.value) time.value = '23:59'
  await nextTick()
  update()
}

async function clear() { date.value = ''; time.value = '23:59'; await nextTick(); update() }
defineExpose({ focus: () => dateInput.value?.focus() })
</script>

<template>
  <fieldset class="deadline-editor" :disabled="disabled">
    <legend>截止时间（可选）</legend>
    <div class="deadline-fields">
      <label :for="`${idPrefix}-date`">日期<input :id="`${idPrefix}-date`" ref="dateInput" v-model="date" type="date"
        min="1970-01-01" max="9999-12-31" :aria-invalid="invalid" :aria-describedby="`${idPrefix}-hint`" @input="update" /></label>
      <label :for="`${idPrefix}-time`">时间<input :id="`${idPrefix}-time`" ref="timeInput" v-model="time" type="time" :disabled="!date"
        :aria-invalid="invalid" :aria-describedby="`${idPrefix}-hint`" @input="update" /></label>
    </div>
    <div class="deadline-shortcuts">
      <button type="button" @click="shortcut(0)">今天</button><button type="button" @click="shortcut(1)">明天</button>
      <button type="button" :disabled="!date" @click="clear">清除 DDL</button>
    </div>
    <p :id="`${idPrefix}-hint`" class="hint">按本地时间设置；只选日期默认 23:59。</p>
    <span v-if="invalid" class="field-error" role="alert">请选择有效的日期和时间。</span>
  </fieldset>
</template>
