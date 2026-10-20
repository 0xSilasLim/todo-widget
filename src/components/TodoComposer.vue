<script setup lang="ts">
import { ref } from 'vue'
import { Plus } from '@lucide/vue'
import { MAX_TODO_LENGTH } from '../types'

defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ add: [text: string] }>()
const draft = ref('')

function submit() {
  if (!draft.value.trim()) return
  emit('add', draft.value)
  draft.value = ''
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <label class="sr-only" for="new-todo">新增待办</label>
    <input id="new-todo" v-model="draft" :disabled="disabled" :maxlength="MAX_TODO_LENGTH"
      autocomplete="off" placeholder="记下一件要做的事…" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()" />
    <button class="primary-button add-button" type="submit" aria-label="添加待办" title="添加待办（Enter）"
      :disabled="disabled || !draft.trim()"><Plus :size="20" /></button>
  </form>
</template>
