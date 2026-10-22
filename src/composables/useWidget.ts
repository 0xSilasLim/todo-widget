import { computed, ref, toRaw } from 'vue'
import { DEFAULT_PRIORITY, DEFAULT_SETTINGS, MAX_TODO_LENGTH, type Priority, type Settings, type Todo } from '../types'
import { widgetService } from '../services/widgetService'

export function useWidget() {
  const todos = ref<Todo[]>([])
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const loading = ref(true)
  const saving = ref(false)
  const error = ref('')
  const ready = ref(false)
  const remaining = computed(() => todos.value.filter((todo) => !todo.completed).length)
  let queue = Promise.resolve()
  let pending = 0
  const failedWrites = new Map<string, () => Promise<void>>()

  function enqueue(key: string, write: () => Promise<void>) {
    pending += 1
    saving.value = true
    queue = queue.then(async () => {
      try {
        await write()
        failedWrites.delete(key)
        if (failedWrites.size === 0) error.value = ''
      } catch (reason) {
        failedWrites.set(key, write)
        error.value = `保存失败，请重试：${String(reason)}`
      } finally {
        pending -= 1
        saving.value = pending > 0
      }
    })
    return queue
  }

  async function initialize() {
    loading.value = true
    error.value = ''
    try {
      if (!widgetService.isDesktop()) throw new Error('请通过桌面应用打开，浏览器预览无法保存数据。')
      const data = await widgetService.load()
      todos.value = data.todos
      settings.value = data.settings
      ready.value = true
    } catch (reason) {
      error.value = `无法读取本地数据：${String(reason)}`
    } finally {
      loading.value = false
      if (widgetService.isDesktop()) {
        await widgetService.reveal().catch((reason) => { error.value = String(reason) })
      }
    }
  }

  function persistTodos() {
    const snapshot = todos.value.map((todo) => ({ ...toRaw(todo) }))
    return enqueue('todos', () => widgetService.saveTodos(snapshot))
  }

  function add(text: string, priority: Priority = DEFAULT_PRIORITY) {
    const trimmed = text.trim().slice(0, MAX_TODO_LENGTH)
    if (!trimmed || !ready.value) return false
    todos.value.push({ id: crypto.randomUUID(), text: trimmed, completed: false, priority })
    void persistTodos()
    return true
  }

  function edit(id: string, text: string, priority?: Priority) {
    const todo = todos.value.find((item) => item.id === id)
    const trimmed = text.trim().slice(0, MAX_TODO_LENGTH)
    if (!todo || !trimmed) return false
    todo.text = trimmed
    if (priority !== undefined) todo.priority = priority
    void persistTodos()
    return true
  }

  function toggle(id: string) {
    const todo = todos.value.find((item) => item.id === id)
    if (!todo) return
    todo.completed = !todo.completed
    void persistTodos()
  }

  function remove(id: string) {
    todos.value = todos.value.filter((todo) => todo.id !== id)
    void persistTodos()
  }

  function move(id: string, targetId: string) {
    const source = todos.value.findIndex((todo) => todo.id === id)
    const target = todos.value.findIndex((todo) => todo.id === targetId)
    if (source < 0 || target < 0 || source === target) return
    const [todo] = todos.value.splice(source, 1)
    todos.value.splice(target, 0, todo)
    void persistTodos()
  }

  function moveBy(id: string, offset: -1 | 1) {
    const index = todos.value.findIndex((todo) => todo.id === id)
    const target = todos.value[index + offset]
    if (index >= 0 && target) move(id, target.id)
  }

  async function updateSettings(patch: Partial<Settings>) {
    const snapshot = { ...settings.value, ...patch }
    snapshot.backgroundOpacity = Math.min(1, Math.max(0.2, snapshot.backgroundOpacity))
    settings.value = snapshot
    await enqueue('settings', () => widgetService.saveSettings(snapshot))
  }

  async function runWindowAction(action: () => Promise<void>) {
    try { await action() } catch (reason) { error.value = `窗口操作失败：${String(reason)}` }
  }

  async function close() {
    await queue
    // Keep failed writes in memory so closing cannot silently discard them.
    if (failedWrites.size > 0) return
    await runWindowAction(widgetService.close)
  }

  function retry() {
    if (!ready.value) return initialize()
    for (const [key, write] of failedWrites) void enqueue(key, write)
  }

  return {
    todos, settings, loading, saving, error, ready, remaining,
    initialize, add, edit, toggle, remove, move, moveBy, updateSettings,
    runWindowAction, retry, close, flush: () => queue,
  }
}
