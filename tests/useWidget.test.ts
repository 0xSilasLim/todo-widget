import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWidget } from '../src/composables/useWidget'
import { DEFAULT_SETTINGS, type Todo } from '../src/types'

const service = vi.hoisted(() => ({
  isDesktop: vi.fn(() => true), load: vi.fn(), reveal: vi.fn().mockResolvedValue(undefined),
  saveTodos: vi.fn().mockResolvedValue(undefined), saveSettings: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/services/widgetService', () => ({ widgetService: service }))
const createdAt = Date.UTC(2026, 9, 25, 2, 30)

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(createdAt)
  service.isDesktop.mockReturnValue(true)
  service.reveal.mockResolvedValue(undefined)
  service.saveTodos.mockResolvedValue(undefined)
  service.saveSettings.mockResolvedValue(undefined)
  service.close.mockResolvedValue(undefined)
  service.load.mockResolvedValue({ todos: [], settings: { ...DEFAULT_SETTINGS } })
})
afterEach(() => { vi.useRealTimers() })

describe('local task state', () => {
  it('restores, edits and clears a reminder independently from the deadline and keeps it through task changes', async () => {
    const remindAt = createdAt + 60_000, dueAt = createdAt + 3_600_000
    service.load.mockResolvedValue({ todos: [{ id: 'saved', text: '已保存的提醒', completed: false, priority: 'p0', createdAt, dueAt, remindAt }], settings: { ...DEFAULT_SETTINGS } })
    const widget = useWidget()
    await widget.initialize()
    expect(widget.todos.value[0].remindAt).toBe(remindAt)
    widget.edit('saved', '只改文字')
    widget.toggle('saved')
    widget.toggle('saved')
    widget.add('无 DDL 的提醒', 'p2', null, remindAt + 60_000)
    widget.moveBy('saved', 1)
    await widget.flush()
    expect(widget.todos.value.find(todo => todo.id === 'saved')).toMatchObject({ createdAt, dueAt, remindAt })
    expect(widget.todos.value.find(todo => todo.text === '无 DDL 的提醒')).toMatchObject({ remindAt: remindAt + 60_000 })
    widget.edit('saved', '改提醒', undefined, undefined, remindAt + 120_000)
    await widget.flush()
    expect(widget.todos.value.find(todo => todo.id === 'saved')).toMatchObject({ dueAt, remindAt: remindAt + 120_000 })
    widget.edit('saved', '清除提醒', undefined, undefined, null)
    await widget.flush()
    expect(service.saveTodos.mock.lastCall?.[0].find((todo: Todo) => todo.id === 'saved')).toMatchObject({ dueAt, remindAt: null })
  })
  it('restores the saved order, completion, text and settings', async () => {
    service.load.mockResolvedValue({ todos: [{ id: 'one', text: '已保存', completed: true, priority: 'p1' }], settings: { ...DEFAULT_SETTINGS, locked: true, backgroundOpacity: 0.2 } })
    const widget = useWidget()
    await widget.initialize()
    expect(widget.todos.value[0]).toEqual({ id: 'one', text: '已保存', completed: true, priority: 'p1' })
    expect(widget.settings.value.locked).toBe(true)
    expect(widget.settings.value.backgroundOpacity).toBe(0.2)
    expect(service.saveTodos).not.toHaveBeenCalled()
  })

  it('adds, edits, completes, sorts and deletes using ordered snapshots', async () => {
    const widget = useWidget()
    await widget.initialize()
    expect(widget.add('  第一件事  ', 'p0')).toBe(true)
    widget.add('第二件事', 'p3')
    const first = widget.todos.value[0].id
    const second = widget.todos.value[1].id
    widget.edit(first, '修改后的任务', 'p1')
    widget.moveBy(second, -1)
    widget.toggle(first)
    await widget.flush()
    expect(service.saveTodos).toHaveBeenLastCalledWith([
      { id: second, text: '第二件事', completed: false, priority: 'p3', createdAt },
      { id: first, text: '修改后的任务', completed: true, priority: 'p1', createdAt },
    ])
    expect(service.saveTodos.mock.calls[0][0]).toEqual([{ id: first, text: '第一件事', completed: false, priority: 'p0', createdAt }])
    widget.remove(first)
    await widget.flush()
    expect(widget.remaining.value).toBe(1)
    expect(service.saveTodos).toHaveBeenLastCalledWith([{ id: second, text: '第二件事', completed: false, priority: 'p3', createdAt }])
  })

  it('defaults new tasks to P2 and preserves priority when only text is edited', async () => {
    const widget = useWidget()
    await widget.initialize()
    widget.add('普通任务')
    const id = widget.todos.value[0].id
    expect(widget.todos.value[0].priority).toBe('p2')
    widget.edit(id, '设为紧急', 'p0')
    widget.edit(id, '仅修改文字')
    await widget.flush()
    expect(service.saveTodos).toHaveBeenLastCalledWith([{ id, text: '仅修改文字', completed: false, priority: 'p0', createdAt }])
  })

  it('orders only pending tasks when completed tasks are interleaved in the store', async () => {
    service.load.mockResolvedValue({ todos: [
      { id: 'one', text: '第一件', completed: false, priority: 'p0' },
      { id: 'done', text: '已完成', completed: true, priority: 'p1' },
      { id: 'two', text: '第二件', completed: false, priority: 'p2' },
      { id: 'three', text: '第三件', completed: false, priority: 'p3' },
    ], settings: { ...DEFAULT_SETTINGS } })
    const widget = useWidget()
    await widget.initialize()
    widget.moveBy('two', -1)
    await widget.flush()
    expect(widget.todos.value.filter((todo) => !todo.completed).map((todo) => todo.id)).toEqual(['two', 'one', 'three'])
    widget.moveBy('two', -1)
    widget.move('two', 'done')
    widget.moveBy('done', 1)
    await widget.flush()
    expect(service.saveTodos).toHaveBeenCalledTimes(1)
    widget.toggle('done')
    await widget.flush()
    expect(widget.todos.value.map((todo) => todo.id)).toEqual(['two', 'one', 'done', 'three'])
    expect(widget.remaining.value).toBe(4)
    expect(widget.todos.value[2].priority).toBe('p1')
  })

  it('records creation time once and preserves it through edits, completion, restore and sorting', async () => {
    const widget = useWidget()
    await widget.initialize()
    widget.add('记录添加时间', 'p1')
    const id = widget.todos.value[0].id
    expect(widget.todos.value[0].createdAt).toBe(createdAt)
    vi.setSystemTime(createdAt + 60_000)
    widget.add('一分钟后添加')
    expect(widget.todos.value[1].createdAt).toBe(createdAt + 60_000)
    widget.edit(id, '修改内容', 'p0')
    widget.toggle(id)
    widget.toggle(id)
    widget.moveBy(id, 1)
    await widget.flush()
    expect(service.saveTodos.mock.lastCall?.[0].find((todo: Todo) => todo.id === id)).toEqual({
      id, text: '修改内容', completed: false, priority: 'p0', createdAt,
    })
  })

  it('rejects blank tasks and empty edits without writing', async () => {
    const widget = useWidget()
    await widget.initialize()
    expect(widget.add('  \n  ')).toBe(false)
    widget.add('有效任务')
    expect(widget.edit(widget.todos.value[0].id, '  ')).toBe(false)
    await widget.flush()
    expect(service.saveTodos).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed task write after a successful settings write and retries it', async () => {
    service.saveTodos.mockRejectedValueOnce(new Error('disk full'))
    const widget = useWidget()
    await widget.initialize()
    widget.add('不能丢失')
    await widget.updateSettings({ alwaysOnTop: false })
    expect(widget.error.value).toContain('disk full')
    await widget.close()
    expect(service.close).not.toHaveBeenCalled()
    widget.retry()
    await widget.flush()
    expect(widget.error.value).toBe('')
    expect(service.saveTodos).toHaveBeenCalledTimes(2)
    await widget.close()
    expect(service.close).toHaveBeenCalledOnce()
  })

  it('waits for the last write before closing', async () => {
    let finishSave!: () => void
    service.saveTodos.mockReturnValue(new Promise<void>((resolve) => { finishSave = resolve }))
    const widget = useWidget()
    await widget.initialize()
    widget.add('关闭前写入')
    const close = widget.close()
    await Promise.resolve()
    expect(service.close).not.toHaveBeenCalled()
    finishSave()
    await close
    expect(service.close).toHaveBeenCalledOnce()
  })

  it('never overwrites unreadable data with an empty default list', async () => {
    service.load.mockRejectedValue(new Error('invalid store'))
    const widget = useWidget()
    await widget.initialize()
    expect(widget.ready.value).toBe(false)
    expect(widget.add('new')).toBe(false)
    expect(service.saveTodos).not.toHaveBeenCalled()
    expect(widget.error.value).toContain('invalid store')
  })

  it('clamps opacity at the UI boundary', async () => {
    const widget = useWidget()
    await widget.initialize()
    await widget.updateSettings({ backgroundOpacity: 0 })
    expect(service.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, backgroundOpacity: 0.2 })
    await widget.updateSettings({ backgroundOpacity: 2 })
    expect(service.saveSettings).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, backgroundOpacity: 1 })
  })

  it('preserves deadlines through text edits, sorting, completion and restore, and can change or clear them', async () => {
    const widget = useWidget()
    await widget.initialize()
    const dueAt = createdAt + 3_600_000
    widget.add('带截止时间', 'p1', dueAt)
    const id = widget.todos.value[0].id
    widget.edit(id, '修改内容')
    widget.toggle(id)
    widget.toggle(id)
    widget.add('另一件')
    widget.moveBy(id, 1)
    await widget.flush()
    expect(widget.todos.value.find((todo) => todo.id === id)?.dueAt).toBe(dueAt)
    widget.edit(id, '修改内容', 'p0', dueAt + 60_000)
    expect(widget.todos.value.find((todo) => todo.id === id)?.dueAt).toBe(dueAt + 60_000)
    widget.edit(id, '修改内容', 'p0', null)
    await widget.flush()
    expect(service.saveTodos.mock.lastCall?.[0].find((todo: Todo) => todo.id === id)).toMatchObject({ dueAt: null, createdAt })
  })
})
