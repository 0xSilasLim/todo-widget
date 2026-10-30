<script setup lang="ts">
import { ref } from 'vue'
import { Bell, CalendarClock, Plus } from '@lucide/vue'
import { DEFAULT_PRIORITY, MAX_TODO_LENGTH, type Priority } from '../types'
import PrioritySelect from './PrioritySelect.vue'
import DeadlineEditor from './DeadlineEditor.vue'
import ReminderEditor from './ReminderEditor.vue'
import { reminderStatus } from '../services/reminders'

defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ add: [text: string, priority: Priority, dueAt: number | null, remindAt: number | null] }>()
const draft = ref('')
const priority = ref<Priority>(DEFAULT_PRIORITY)
const dueAt = ref<number | null>(null)
const deadlineOpen = ref(false)
const deadlineValid = ref(true)
const remindAt = ref<number | null>(null)
const reminderOpen = ref(false)
const reminderValid = ref(true)
const reminderEditor = ref<InstanceType<typeof ReminderEditor>>()

function submit() {
  if (!draft.value.trim() || !deadlineValid.value || !reminderEditor.value?.validate()) return
  emit('add', draft.value, priority.value, dueAt.value, remindAt.value)
  draft.value = ''
  priority.value = DEFAULT_PRIORITY
  dueAt.value = null
  deadlineOpen.value = false
  deadlineValid.value = true
  remindAt.value = null
  reminderOpen.value = false
  reminderValid.value = true
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
      :disabled="disabled || !draft.trim() || !deadlineValid || !reminderValid"><Plus :size="20" /></button>
    </div>
    <div class="composer-options"><button class="deadline-toggle" type="button" :disabled="disabled" :aria-expanded="deadlineOpen" aria-controls="composer-deadline"
      @click="deadlineOpen = !deadlineOpen"><CalendarClock :size="14" />{{ dueAt == null ? '设置 DDL' : '已设置 DDL' }}</button>
    <button class="reminder-toggle" :class="{ selected: remindAt != null }" type="button" :disabled="disabled" :aria-expanded="reminderOpen" aria-controls="composer-reminder"
      @click="reminderOpen = !reminderOpen"><Bell :size="14" />{{ remindAt == null ? '设置提醒' : `提醒 ${reminderStatus(remindAt, Date.now()).label}` }}</button></div>
    <DeadlineEditor v-show="deadlineOpen" id="composer-deadline" v-model="dueAt" id-prefix="new-deadline" :disabled="disabled" @validity="deadlineValid = $event" />
    <ReminderEditor v-show="reminderOpen" id="composer-reminder" ref="reminderEditor" v-model="remindAt" id-prefix="new-reminder" :disabled="disabled" @validity="reminderValid = $event" />
  </form>
</template>
