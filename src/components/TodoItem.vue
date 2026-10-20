<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Check, GripVertical, Pencil, Trash2, X } from '@lucide/vue'
import { MAX_TODO_LENGTH, type Todo } from '../types'

const props = defineProps<{ todo: Todo; first: boolean; last: boolean; dragging: boolean }>()
const emit = defineEmits<{
  toggle: [id: string]; edit: [id: string, text: string]; remove: [id: string]
  drag: [id: string, event: DragEvent]; dragEnd: []; move: [id: string, offset: -1 | 1]
}>()
const editing = ref(false)
const draft = ref('')
const input = ref<HTMLTextAreaElement>()
const editButton = ref<HTMLButtonElement>()
const invalid = ref(false)

async function beginEdit() {
  draft.value = props.todo.text
  editing.value = true
  invalid.value = false
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

async function finish(save: boolean) {
  if (save && !draft.value.trim()) { invalid.value = true; return }
  if (save) emit('edit', props.todo.id, draft.value)
  editing.value = false
  await nextTick()
  editButton.value?.focus()
}

function editKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') { event.preventDefault(); void finish(false) }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void finish(true) }
}
</script>

<template>
  <li class="todo-item" :class="{ completed: todo.completed, dragging, editing }" :data-id="todo.id">
    <template v-if="!editing">
      <button class="sort-handle" draggable="true" :aria-label="`排序：${todo.text}，按 Alt 加上或下方向键移动`"
        title="拖动排序 · Alt + ↑ / ↓" @dragstart="$emit('drag', todo.id, $event)" @dragend="$emit('dragEnd')"
        @keydown.alt.up.prevent="!first && $emit('move', todo.id, -1)"
        @keydown.alt.down.prevent="!last && $emit('move', todo.id, 1)"><GripVertical :size="14" /></button>
      <label class="todo-check"><input type="checkbox" :checked="todo.completed" :aria-label="`完成：${todo.text}`"
          @change="$emit('toggle', todo.id)" /><span class="check-mark"><Check v-if="todo.completed" :size="12" /></span></label>
      <span class="todo-text" :title="todo.text" @dblclick="beginEdit">{{ todo.text }}</span>
      <div class="todo-actions">
        <button ref="editButton" class="row-button" :aria-label="`编辑：${todo.text}`" title="编辑（也可双击文字）"
          @click="beginEdit"><Pencil :size="14" /></button>
        <button class="row-button danger-button" :aria-label="`删除：${todo.text}`" title="删除" @click="$emit('remove', todo.id)"><Trash2 :size="14" /></button>
      </div>
    </template>
    <div v-else class="edit-form">
      <label class="sr-only" :for="`edit-${todo.id}`">编辑待办内容</label>
      <textarea :id="`edit-${todo.id}`" ref="input" v-model="draft" :maxlength="MAX_TODO_LENGTH"
        rows="3" :aria-invalid="invalid" :aria-describedby="invalid ? `error-${todo.id}` : undefined" @keydown="editKey" />
      <span v-if="invalid" :id="`error-${todo.id}`" class="field-error" role="alert">请填写待办内容</span>
      <div class="edit-actions"><span class="hint">Enter 保存 · Esc 取消</span>
        <button class="row-button" aria-label="取消编辑" title="取消编辑" @click="finish(false)"><X :size="16" /></button>
        <button class="row-button selected" aria-label="保存编辑" title="保存编辑" @click="finish(true)"><Check :size="16" /></button>
      </div>
    </div>
  </li>
</template>
