<script setup lang="ts">
import { PRIORITIES, PRIORITY_LABELS, type Priority } from '../types'

defineProps<{ label: string; disabled?: boolean }>()
const priority = defineModel<Priority>({ required: true })
</script>

<template>
  <select v-model="priority" class="priority-select" :class="`priority-${priority}`" :aria-label="label"
    :disabled="disabled" :title="`${priority.toUpperCase()} ${PRIORITY_LABELS[priority]} · P0 最高，P3 最低`">
    <option v-for="value in PRIORITIES" :key="value" :value="value">{{ value.toUpperCase() }}</option>
  </select>
</template>
