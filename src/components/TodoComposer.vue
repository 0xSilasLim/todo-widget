<script setup lang="ts">
import { ref } from 'vue'
import { Plus } from '@lucide/vue'
import { DEFAULT_PRIORITY, MAX_TODO_LENGTH, type Priority } from '../types'
import PrioritySelect from './PrioritySelect.vue'

defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ add: [text: string, priority: Priority] }>()
const draft = ref('')
const priority = ref<Priority>(DEFAULT_PRIORITY)

function submit() {
  if (!draft.value.trim()) return
  emit('add', draft.value, priority.value)
  draft.value = ''
  priority.value = DEFAULT_PRIORITY
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <label class="sr-only" for="new-todo">新增待办</label>
    <input id="new-todo" v-model="draft" :disabled="disabled" :maxlength="MAX_TODO_LENGTH"
      autocomplete="off" placeholder="记下一件要做的事…" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()" />
    <PrioritySelect v-model="priority" label="新增待办优先级" :disabled="disabled" />
    <button class="primary-button add-button" type="submit" aria-label="添加待办" title="添加待办（Enter）"
      :disabled="disabled || !draft.trim()"><Plus :size="20" /></button>
  </form>
</template>
