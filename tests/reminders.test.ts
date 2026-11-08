import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReminderEditor from '../src/components/ReminderEditor.vue'
import TodoItem from '../src/components/TodoItem.vue'
import { HOUR, MINUTE, localDateParts } from '../src/services/deadlines'
import { nextReminderTime, reminderStatus } from '../src/services/reminders'

const now = new Date(2026, 9, 30, 23, 55, 30).getTime()
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now) })
afterEach(() => { vi.useRealTimers() })

describe('custom reminder times', () => {
  it('rounds a suggested time up to a future minute across midnight', () => {
    const value = nextReminderTime()
    expect(value % MINUTE).toBe(0)
    expect(value).toBeGreaterThanOrEqual(now + 10 * MINUTE)
    expect(localDateParts(value)).toEqual({ date: '2026-10-31', time: '00:06' })
    expect(reminderStatus(value, now).description).toContain('提醒一次')
    expect(reminderStatus(value, value).description).toContain('提醒时间已到')
    expect(reminderStatus(value, value, true).description).toContain('提醒已停止')
  })

  it('supports presets, rejects a changed past time, and clears the reminder', async () => {
    const editor = mount(ReminderEditor, { props: { modelValue: null, idPrefix: 'test' } })
    await editor.findAll('button')[1].trigger('click')
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([nextReminderTime(HOUR)])
    await editor.get('input[type="date"]').setValue('2026-10-29')
    expect(editor.text()).toContain('晚于当前时间')
    expect(editor.emitted('validity')?.at(-1)).toEqual([false])
    await editor.findAll('button')[2].trigger('click')
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([null])
    expect(editor.emitted('validity')?.at(-1)).toEqual([true])
  })

  it('revalidates before saving if the clock has passed a newly selected time', async () => {
    const item = mount(TodoItem, { props: { todo: { id: 'one', text: '任务', completed: false, priority: 'p2' }, first: true, last: true, dragging: false } })
    await item.get('[aria-label="设置提醒：任务"]').trigger('click')
    await item.get('.reminder-editor button').trigger('click')
    vi.setSystemTime(now + HOUR)
    await item.get('[aria-label="保存编辑"]').trigger('click')
    expect(item.emitted('edit')).toBeUndefined()
    expect(item.text()).toContain('晚于当前时间')
  })

  it('opens from the task bell, cancels without writing, and saves a cleared reminder', async () => {
    const remindAt = nextReminderTime(HOUR)
    const item = mount(TodoItem, { props: { todo: { id: 'one', text: '任务', completed: false, priority: 'p1', remindAt }, first: true, last: true, dragging: false }, attachTo: document.body })
    const bell = '[aria-label="设置提醒：任务"]'
    expect(item.get(bell).attributes('title')).toContain('2026')
    await item.get(bell).trigger('click')
    expect(document.activeElement).toBe(item.get('#reminder-one-date').element)
    await item.get('#reminder-one-time').setValue('12:00')
    await item.get('[aria-label="取消编辑"]').trigger('click')
    expect(item.emitted('edit')).toBeUndefined()
    await item.get(bell).trigger('click')
    await item.findAll('.reminder-editor button')[2].trigger('click')
    await item.get('[aria-label="保存编辑"]').trigger('click')
    expect(item.emitted('edit')).toEqual([['one', '任务', 'p1', null, null]])
    item.unmount()
  })

  it('preserves an unchanged past reminder including its original milliseconds while editing text', async () => {
    const remindAt = now - HOUR + 123
    const item = mount(TodoItem, { props: { todo: { id: 'one', text: '任务', completed: true, priority: 'p2', remindAt }, first: true, last: true, dragging: false } })
    expect(item.get('[aria-label="设置提醒：任务"]').attributes('title')).toContain('提醒已停止')
    await item.get('[aria-label="编辑：任务"]').trigger('click')
    await item.get('textarea').setValue('修改文字')
    await item.get('[aria-label="保存编辑"]').trigger('click')
    expect(item.emitted('edit')).toEqual([['one', '修改文字', 'p2', null, remindAt]])
  })
})
