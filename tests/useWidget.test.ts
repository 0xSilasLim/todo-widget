import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWidget } from '../src/composables/useWidget'
import { DEFAULT_SETTINGS } from '../src/types'

const service = vi.hoisted(() => ({
  isDesktop: vi.fn(() => true), load: vi.fn(), reveal: vi.fn().mockResolvedValue(undefined),
  saveTodos: vi.fn().mockResolvedValue(undefined), saveSettings: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/services/widgetService', () => ({ widgetService: service }))

beforeEach(() => {
  vi.resetAllMocks()
  service.isDesktop.mockReturnValue(true)
  service.reveal.mockResolvedValue(undefined)
  service.saveTodos.mockResolvedValue(undefined)
  service.saveSettings.mockResolvedValue(undefined)
  service.close.mockResolvedValue(undefined)
  service.load.mockResolvedValue({ todos: [], settings: { ...DEFAULT_SETTINGS } })
})

describe('local task state', () => {
  it('restores the saved order, completion, text and settings', async () => {
    service.load.mockResolvedValue({ todos: [{ id: 'one', text: '已保存', completed: true }], settings: { ...DEFAULT_SETTINGS, locked: true, backgroundOpacity: 0.2 } })
    const widget = useWidget()
    await widget.initialize()
    expect(widget.todos.value[0]).toEqual({ id: 'one', text: '已保存', completed: true })
    expect(widget.settings.value.locked).toBe(true)
    expect(widget.settings.value.backgroundOpacity).toBe(0.2)
    expect(service.saveTodos).not.toHaveBeenCalled()
  })

  it('adds, edits, completes, sorts and deletes using ordered snapshots', async () => {
    const widget = useWidget()
    await widget.initialize()
    expect(widget.add('  第一件事  ')).toBe(true)
    widget.add('第二件事')
    const first = widget.todos.value[0].id
    const second = widget.todos.value[1].id
    widget.edit(first, '修改后的任务')
    widget.toggle(first)
    widget.moveBy(second, -1)
    await widget.flush()
    expect(service.saveTodos).toHaveBeenLastCalledWith([
      { id: second, text: '第二件事', completed: false },
      { id: first, text: '修改后的任务', completed: true },
    ])
    expect(service.saveTodos.mock.calls[0][0]).toEqual([{ id: first, text: '第一件事', completed: false }])
    widget.remove(first)
    await widget.flush()
    expect(widget.remaining.value).toBe(1)
    expect(service.saveTodos).toHaveBeenLastCalledWith([{ id: second, text: '第二件事', completed: false }])
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
})
