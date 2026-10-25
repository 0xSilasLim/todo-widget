<script setup lang="ts">
import { ref } from 'vue'
import { CalendarClock, Plus } from '@lucide/vue'
import { DEFAULT_PRIORITY, MAX_TODO_LENGTH, type Priority } from '../types'
import PrioritySelect from './PrioritySelect.vue'
import DeadlineEditor from './DeadlineEditor.vue'

defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ add: [text: string, priority: Priority, dueAt: number | null] }>()
const draft = ref('')
const priority = ref<Priority>(DEFAULT_PRIORITY)
const dueAt = ref<number | null>(null)
const deadlineOpen = ref(false)
const deadlineValid = ref(true)

function submit() {
  if (!draft.value.trim() || !deadlineValid.value) return
  emit('add', draft.value, priority.value, dueAt.value)
  draft.value = ''
  priority.value = DEFAULT_PRIORITY
  dueAt.value = null
  deadlineOpen.value = false
  deadlineValid.value = true
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <div class="composer-inputs">
    <label class="sr-only" for="new-todo">新增待办</label>
    <input id="new-todo" v-model="draft" :disabled="disabled" :maxlength="MAX_TODO_LENGTH"
      autocomplete="off" placeholder="记下一件要做的事…" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()" />
    <PrioritySelect v-model="priority" label="新增待办优先级" :disabled="disabled" />
    <button class="primary-button add-button" type="submit" aria-label="添加待办" title="添加待办（Enter）"
      :disabled="disabled || !draft.trim() || !deadlineValid"><Plus :size="20" /></button>
    </div>
    <button class="deadline-toggle" type="button" :disabled="disabled" :aria-expanded="deadlineOpen" aria-controls="composer-deadline"
      @click="deadlineOpen = !deadlineOpen"><CalendarClock :size="14" />{{ dueAt == null ? '设置 DDL' : '已设置 DDL' }}</button>
    <DeadlineEditor v-show="deadlineOpen" id="composer-deadline" v-model="dueAt" id-prefix="new-deadline" :disabled="disabled" @validity="deadlineValid = $event" />
  </form>
</template>
