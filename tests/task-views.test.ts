import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { DEFAULT_SETTINGS, type Todo, type WidgetData } from '../src/types'

const service = vi.hoisted(() => ({
  isDesktop: vi.fn(() => true), load: vi.fn(), reveal: vi.fn(),
  saveTodos: vi.fn(), guardClose: vi.fn(),
}))
vi.mock('../src/services/widgetService', () => ({ widgetService: service }))

let stored: WidgetData
const mounted: VueWrapper[] = []

beforeEach(() => {
  vi.resetAllMocks()
  stored = { todos: [], settings: { ...DEFAULT_SETTINGS } }
  service.isDesktop.mockReturnValue(true)
  service.reveal.mockResolvedValue(undefined)
  service.guardClose.mockResolvedValue(() => {})
  service.load.mockImplementation(async () => structuredClone(stored))
  service.saveTodos.mockImplementation(async (todos: Todo[]) => { stored.todos = structuredClone(todos) })
})

afterEach(() => { for (const widget of mounted.splice(0)) widget.unmount() })

async function openWidget() {
  const widget = mount(App, { attachTo: document.body })
  mounted.push(widget)
  await flushPromises()
  return widget
}

const pendingTab = '#task-tab-pending'
const completedTab = '#task-tab-completed'

describe('pending and completed task views', () => {
  it('moves completed tasks out of the pending view, restores both views after restart, and can reopen a task', async () => {
    stored.todos = [
      { id: 'one', text: '今天要做的事', completed: false, priority: 'p0', createdAt: 1_792_895_400_000 },
      { id: 'done', text: '原来已完成的事', completed: true, priority: 'p3' },
    ]
    let widget = await openWidget()
    expect(widget.findAll('.todo-text').map((row) => row.text())).toEqual(['今天要做的事'])
    expect(widget.get(pendingTab).text()).toBe('待完成1')
    expect(widget.get(completedTab).text()).toBe('已完成1')
    await widget.get('[aria-label="完成：今天要做的事"]').setValue(true)
    await flushPromises()
    expect(widget.findAll('.todo-item')).toHaveLength(0)
    expect(widget.text()).toContain('待办都完成了')
    expect(widget.get(completedTab).text()).toBe('已完成2')
    widget.unmount()

    widget = await openWidget()
    expect(widget.get(pendingTab).attributes('aria-selected')).toBe('true')
    expect(widget.findAll('.todo-item')).toHaveLength(0)
    await widget.get(completedTab).trigger('click')
    expect(widget.findAll('.todo-text').map((row) => row.text())).toEqual(['今天要做的事', '原来已完成的事'])
    expect(widget.findAll('.priority-badge').map((badge) => badge.attributes('data-priority'))).toEqual(['p0', 'p3'])
    expect(widget.findAll('.sort-handle')).toHaveLength(0)
    expect(widget.get('time').attributes('datetime')).toBe(new Date(1_792_895_400_000).toISOString())
    expect(widget.text()).toContain('添加时间未知')
    await widget.get('[aria-label="恢复：今天要做的事"]').setValue(false)
    await flushPromises()
    expect(widget.findAll('.todo-text').map((row) => row.text())).toEqual(['原来已完成的事'])
    await widget.get(pendingTab).trigger('click')
    expect(widget.get('.todo-text').text()).toBe('今天要做的事')
    expect(stored.todos).toEqual([
      { id: 'one', text: '今天要做的事', completed: false, priority: 'p0', createdAt: 1_792_895_400_000 },
      { id: 'done', text: '原来已完成的事', completed: true, priority: 'p3' },
    ])
  })

  it('requires confirmation before permanent deletion, supports cancel and Escape, and keeps deletion after restart', async () => {
    stored.todos = [
      { id: 'keep', text: '保留待办', completed: false, priority: 'p2' },
      { id: 'done', text: '待删除的已完成任务', completed: true, priority: 'p1' },
    ]
    let widget = await openWidget()
    await widget.get(completedTab).trigger('click')
    const removeButton = '[aria-label="永久删除：待删除的已完成任务"]'
    await widget.get(removeButton).trigger('click')
    expect(widget.text()).toContain('删除后无法恢复')
    expect(document.activeElement?.textContent).toBe('取消')
    expect(service.saveTodos).not.toHaveBeenCalled()
    await widget.get('.delete-confirmation button').trigger('keydown', { key: 'Escape' })
    expect(widget.find('.delete-confirmation').exists()).toBe(false)
    expect(document.activeElement).toBe(widget.get(removeButton).element)
    await widget.get(removeButton).trigger('click')
    await widget.get('.delete-confirmation button').trigger('click')
    expect(service.saveTodos).not.toHaveBeenCalled()
    await widget.get(removeButton).trigger('click')
    await widget.get('[aria-label="确认永久删除"]').trigger('click')
    await flushPromises()
    expect(widget.text()).toContain('还没有已完成任务')
    expect(widget.get(completedTab).text()).toBe('已完成0')
    expect(stored.todos.map((todo) => todo.id)).toEqual(['keep'])
    widget.unmount()

    widget = await openWidget()
    expect(widget.get('.todo-text').text()).toBe('保留待办')
    await widget.get(completedTab).trigger('click')
    expect(widget.findAll('.todo-item')).toHaveLength(0)
    expect(widget.get(completedTab).text()).toBe('已完成0')
  })

  it('keeps keyboard focus usable as rows move and supports keyboard tab navigation', async () => {
    stored.todos = [
      { id: 'one', text: '第一件', completed: false, priority: 'p2' },
      { id: 'two', text: '第二件', completed: false, priority: 'p2' },
    ]
    const widget = await openWidget()
    await widget.get('[aria-label="完成：第一件"]').setValue(true)
    expect(document.activeElement).toBe(widget.get('[aria-label="完成：第二件"]').element)
    await widget.get('[aria-label="完成：第二件"]').setValue(true)
    expect(document.activeElement).toBe(widget.get(pendingTab).element)
    await widget.get(pendingTab).trigger('keydown', { key: 'ArrowRight' })
    expect(widget.get(completedTab).attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(widget.get(completedTab).element)
    expect(widget.findAll('.todo-item')).toHaveLength(2)
    await widget.get(completedTab).trigger('keydown', { key: 'Home' })
    expect(widget.get(pendingTab).attributes('aria-selected')).toBe('true')
    await widget.get(pendingTab).trigger('keydown', { key: 'End' })
    expect(widget.get(completedTab).attributes('aria-selected')).toBe('true')
  })

  it('shows a task added while viewing completed tasks in the pending view', async () => {
    const widget = await openWidget()
    await widget.get(completedTab).trigger('click')
    const input = widget.get('#new-todo')
    ;(input.element as HTMLInputElement).focus()
    await input.setValue('新的一件事')
    await widget.get('form').trigger('submit')
    await flushPromises()
    expect(widget.get(pendingTab).attributes('aria-selected')).toBe('true')
    expect(widget.get('.todo-text').text()).toBe('新的一件事')
    expect(document.activeElement).toBe(input.element)
  })
})
