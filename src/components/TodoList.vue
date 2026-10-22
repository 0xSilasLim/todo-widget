<script setup lang="ts">
import { ref } from 'vue'
import { ListChecks } from '@lucide/vue'
import type { Priority, Todo } from '../types'
import TodoItem from './TodoItem.vue'

defineProps<{ todos: Todo[] }>()
const emit = defineEmits<{
  toggle: [id: string]; edit: [id: string, text: string, priority: Priority]; remove: [id: string]
  reorder: [id: string, target: string]; move: [id: string, offset: -1 | 1]
}>()
const draggedId = ref('')
const dropId = ref('')
const announcement = ref('')

function startDrag(id: string, event: DragEvent) {
  draggedId.value = id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
}

function endDrag() { draggedId.value = ''; dropId.value = '' }

function drop(target: string) {
  if (draggedId.value && draggedId.value !== target) {
    emit('reorder', draggedId.value, target)
    announcement.value = '待办顺序已更新'
  }
  endDrag()
}

function move(id: string, offset: -1 | 1) {
  emit('move', id, offset)
  announcement.value = offset === -1 ? '待办已上移' : '待办已下移'
}
</script>

<template>
  <div v-if="todos.length === 0" class="empty-state">
    <ListChecks :size="36" :stroke-width="1.4" />
    <p>今天，先做一件事</p><span>在下方记下待办，完成后轻轻勾选。</span>
  </div>
  <ol v-else class="todo-list" aria-label="待办列表">
    <TodoItem v-for="(todo, index) in todos" :key="todo.id" :todo="todo" :first="index === 0"
      :last="index === todos.length - 1" :dragging="draggedId === todo.id" :class="{ 'drop-target': dropId === todo.id }"
      @toggle="$emit('toggle', $event)" @edit="(id, text, priority) => $emit('edit', id, text, priority)" @remove="$emit('remove', $event)"
      @drag="startDrag" @drag-end="endDrag" @move="move" @dragover.prevent="dropId = todo.id" @drop.prevent="drop(todo.id)" />
  </ol>
  <span class="sr-only" aria-live="polite">{{ announcement }}</span>
</template>
