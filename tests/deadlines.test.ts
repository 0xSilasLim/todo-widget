import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeadlineEditor from '../src/components/DeadlineEditor.vue'
import TodoComposer from '../src/components/TodoComposer.vue'
import TodoItem from '../src/components/TodoItem.vue'
import { DAY, HOUR, MINUTE, deadlineStatus, localDateParts, parseLocalDeadline } from '../src/services/deadlines'

afterEach(() => { vi.useRealTimers() })

describe('deadline times and states', () => {
  it('round-trips local date/time, defaults date-only deadlines to 23:59, and rejects invalid input', () => {
    const value = parseLocalDeadline('2026-10-26', '18:30')!
    expect(localDateParts(value)).toEqual({ date: '2026-10-26', time: '18:30' })
    expect(localDateParts(parseLocalDeadline('2026-10-26')!).time).toBe('23:59')
    for (const [date, time] of [['2026-02-30', '18:00'], ['2026-10-26', '25:00'], ['2026-10-26', '18:61'], ['', '18:00'], ['abc', '00:00']]) {
      expect(parseLocalDeadline(date, time)).toBeNull()
    }
  })

  it('uses the agreed 24-hour, one-hour and overdue thresholds including exact boundaries', () => {
    const now = Date.now()
    expect(deadlineStatus(now + DAY + 1, now).tone).toBe('neutral')
    expect(deadlineStatus(now + DAY, now).tone).toBe('soon')
    expect(deadlineStatus(now + HOUR + 1, now).tone).toBe('soon')
    expect(deadlineStatus(now + HOUR, now).tone).toBe('urgent')
    expect(deadlineStatus(now + 35 * MINUTE, now).remaining).toBe('仅剩 35 分钟')
    expect(deadlineStatus(now + 1, now).remaining).toBe('仅剩 不到 1 分钟')
    expect(deadlineStatus(now, now).remaining).toBe('已到截止时间')
    expect(deadlineStatus(now - 20 * MINUTE, now).remaining).toBe('已逾期 20 分钟')
    expect(deadlineStatus(now - DAY, now, true).tone).toBe('neutral')
    expect(deadlineStatus(now - DAY, now, true).remaining).toBe('已完成')
  })

  it('updates displayed urgency when the wall clock jumps and stops warnings for completed tasks', async () => {
    const now = Date.now()
    const task = { id: 'one', text: '任务', completed: false, priority: 'p1' as const, dueAt: now + 2 * HOUR }
    const item = mount(TodoItem, { props: { todo: task, now, first: true, last: true, dragging: false } })
    expect(item.get('.deadline-badge').classes()).toContain('deadline-soon')
    await item.setProps({ now: now + 90 * MINUTE })
    expect(item.get('.deadline-badge').attributes('title')).toContain('仅剩 30 分钟')
    expect(item.get('.deadline-badge').attributes('aria-description')).toContain('仅剩 30 分钟')
    await item.setProps({ now: now + 3 * HOUR })
    expect(item.get('.deadline-badge').classes()).toContain('deadline-overdue')
    expect(item.get('.deadline-badge').text()).toMatch(/^逾期 /)
    await item.setProps({ todo: { ...task, completed: true } })
    expect(item.get('.deadline-badge').attributes('title')).toContain('已完成')
    expect(item.get('.deadline-badge').classes()).toContain('deadline-neutral')
    expect(item.get('.deadline-badge').text()).toContain('DDL')
  })
})

describe('deadline controls', () => {
  it('supports date-only entry, time editing, shortcuts and clearing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 31, 12))
    const editor = mount(DeadlineEditor, { props: { modelValue: null, idPrefix: 'test' } })
    await editor.get('input[type="date"]').setValue('2026-10-26')
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([parseLocalDeadline('2026-10-26')])
    await editor.get('input[type="time"]').setValue('18:30')
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([parseLocalDeadline('2026-10-26', '18:30')])
    await editor.findAll('button')[1].trigger('click')
    expect(editor.get<HTMLInputElement>('input[type="date"]').element.value).toBe('2026-11-01')
    await editor.findAll('button')[2].trigger('click')
    expect(editor.get<HTMLInputElement>('input[type="date"]').element.value).toBe('')
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([null])
  })

  it('adds with a deadline and resets it for the next task', async () => {
    const composer = mount(TodoComposer, { props: { disabled: false } })
    await composer.get('.deadline-toggle').trigger('click')
    await composer.get('input[type="date"]').setValue('2026-10-26')
    await composer.get('input[type="time"]').setValue('18:00')
    await composer.get('#new-todo').setValue('带 DDL 的任务')
    await composer.get('form').trigger('submit')
    expect(composer.emitted('add')).toEqual([['带 DDL 的任务', 'p2', parseLocalDeadline('2026-10-26', '18:00'), null]])
    expect(composer.get('.deadline-toggle').attributes('aria-expanded')).toBe('false')
    expect(composer.get<HTMLInputElement>('input[type="date"]').element.value).toBe('')
  })

  it('opens the task deadline editor directly, cancels without saving, and saves a cleared deadline', async () => {
    const dueAt = parseLocalDeadline('2026-10-26', '18:00')!
    const item = mount(TodoItem, { props: { todo: { id: 'one', text: '任务', completed: false, priority: 'p0', dueAt }, first: true, last: true, dragging: false }, attachTo: document.body })
    await item.get('.deadline-badge').trigger('click')
    expect(document.activeElement).toBe(item.get('input[type="date"]').element)
    await item.get('input[type="time"]').setValue('20:00')
    await item.get('[aria-label="取消编辑"]').trigger('click')
    expect(item.emitted('edit')).toBeUndefined()
    expect(item.get('.deadline-badge').text()).toContain('18:00')
    await item.get('.deadline-badge').trigger('click')
    await item.findAll('.deadline-shortcuts button')[2].trigger('click')
    await item.get('[aria-label="保存编辑"]').trigger('click')
    expect(item.emitted('edit')).toEqual([['one', '任务', 'p0', null, null]])
    item.unmount()
  })
})
