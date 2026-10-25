<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ListChecks } from '@lucide/vue'
import type { Priority, Todo } from '../types'
import TodoItem from './TodoItem.vue'

const props = defineProps<{ todos: Todo[] }>()
const emit = defineEmits<{
  toggle: [id: string]; edit: [id: string, text: string, priority: Priority]; remove: [id: string]
  reorder: [id: string, target: string]; move: [id: string, offset: -1 | 1]
}>()
const draggedId = ref('')
const dropId = ref('')
const announcement = ref('')
const tabs = ['pending', 'completed'] as const
type TaskTab = typeof tabs[number]
const activeTab = ref<TaskTab>('pending')
const tabButtons = ref<HTMLButtonElement[]>([])
const panel = ref<HTMLDivElement>()
const pendingTodos = computed(() => props.todos.filter((todo) => !todo.completed))
const completedTodos = computed(() => props.todos.filter((todo) => todo.completed))
const visibleTodos = computed(() => activeTab.value === 'pending' ? pendingTodos.value : completedTodos.value)

// A task added from either view should be visible while the composer keeps focus.
watch(() => props.todos.length, (count, previous) => {
  if (count > previous) activeTab.value = 'pending'
})

async function selectTab(tab: TaskTab, focus = false) {
  activeTab.value = tab
  endDrag()
  await nextTick()
  if (panel.value) panel.value.scrollTop = 0
  if (focus) tabButtons.value[tabs.indexOf(tab)]?.focus()
}

function tabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - tabs.indexOf(activeTab.value)
  void selectTab(tabs[index], true)
}

async function focusAfterChange(index: number) {
  await nextTick()
  const checkboxes = panel.value?.querySelectorAll<HTMLInputElement>('.todo-check input')
  const next = checkboxes?.[Math.min(index, checkboxes.length - 1)]
  const target = next ?? tabButtons.value[tabs.indexOf(activeTab.value)]
  target?.focus()
}

function toggle(id: string) {
  const index = visibleTodos.value.findIndex((todo) => todo.id === id)
  announcement.value = activeTab.value === 'pending' ? '任务已移入已完成，可在已完成页签中查看' : '任务已恢复到待完成'
  emit('toggle', id)
  void focusAfterChange(index)
}

function remove(id: string) {
  const index = visibleTodos.value.findIndex((todo) => todo.id === id)
  announcement.value = '任务已永久删除'
  emit('remove', id)
  void focusAfterChange(index)
}

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
  <div class="todo-view">
    <div class="task-tabs" role="tablist" aria-label="任务分类">
      <button v-for="tab in tabs" :id="`task-tab-${tab}`" :key="tab" ref="tabButtons" class="task-tab" role="tab"
        :aria-selected="activeTab === tab" :tabindex="activeTab === tab ? 0 : -1" aria-controls="task-panel"
        @click="selectTab(tab)" @keydown="tabKey">
        {{ tab === 'pending' ? '待完成' : '已完成' }}<span class="tab-count">{{ tab === 'pending' ? pendingTodos.length : completedTodos.length }}</span>
      </button>
    </div>
    <div id="task-panel" ref="panel" class="list-scroll" role="tabpanel" :aria-labelledby="`task-tab-${activeTab}`">
      <div v-if="visibleTodos.length === 0" class="empty-state">
        <ListChecks :size="36" :stroke-width="1.4" />
        <template v-if="activeTab === 'completed'">
          <p>还没有已完成任务</p><span>勾选待办后，会自动收纳到这里。</span>
        </template>
        <template v-else-if="completedTodos.length">
          <p>待办都完成了</p><span>在“已完成”中查看，或在下方记录新任务。</span>
        </template>
        <template v-else><p>今天，先做一件事</p><span>在下方记下待办，完成后轻轻勾选。</span></template>
      </div>
      <ol v-else class="todo-list" :aria-label="activeTab === 'pending' ? '待办列表' : '已完成任务列表'">
        <TodoItem v-for="(todo, index) in visibleTodos" :key="todo.id" :todo="todo" :first="index === 0"
          :last="index === visibleTodos.length - 1" :dragging="draggedId === todo.id" :class="{ 'drop-target': dropId === todo.id }"
          @toggle="toggle" @edit="(id, text, priority) => $emit('edit', id, text, priority)" @remove="remove"
          @drag="startDrag" @drag-end="endDrag" @move="move" @dragover.prevent="!todo.completed && (dropId = todo.id)" @drop.prevent="!todo.completed && drop(todo.id)" />
      </ol>
    </div>
    <span class="sr-only" aria-live="polite">{{ announcement }}</span>
  </div>
</template>
