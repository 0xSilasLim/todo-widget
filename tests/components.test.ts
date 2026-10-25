import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TodoComposer from '../src/components/TodoComposer.vue'
import TodoItem from '../src/components/TodoItem.vue'
import SettingsPanel from '../src/components/SettingsPanel.vue'
import { DEFAULT_SETTINGS } from '../src/types'

describe('widget controls', () => {
  it('adds on submit, clears the draft, and blocks empty input', async () => {
    const composer = mount(TodoComposer, { props: { disabled: false } })
    await composer.get('input').setValue('买牛奶')
    await composer.get('form').trigger('submit')
    expect(composer.emitted('add')).toEqual([['买牛奶', 'p2', null]])
    expect((composer.get('input').element as HTMLInputElement).value).toBe('')
    await composer.get('form').trigger('submit')
    expect(composer.emitted('add')).toHaveLength(1)
  })

  it('does not save an edit while confirming Chinese input composition', async () => {
    const item = mount(TodoItem, { props: { todo: { id: 'one', text: '中文任务', completed: false, priority: 'p2' }, first: true, last: true, dragging: false } })
    await item.get('[title="编辑（也可双击文字）"]').trigger('click')
    await item.get('textarea').setValue('修改')
    await item.get('textarea').trigger('keydown', { key: 'Enter', isComposing: true })
    expect(item.emitted('edit')).toBeUndefined()
    await item.get('textarea').trigger('keydown', { key: 'Enter', isComposing: false })
    expect(item.emitted('edit')).toEqual([['one', '修改', 'p2', null]])
  })

  it('offers keyboard ordering and cancels an edit with Escape', async () => {
    const item = mount(TodoItem, { props: { todo: { id: 'one', text: '任务', completed: false, priority: 'p3' }, first: false, last: false, dragging: false } })
    await item.get('.sort-handle').trigger('keydown', { key: 'ArrowUp', altKey: true })
    expect(item.emitted('move')).toEqual([['one', -1]])
    await item.get('[title="编辑（也可双击文字）"]').trigger('click')
    await item.get('textarea').setValue('不保存')
    await item.get('select').setValue('p0')
    await item.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(item.emitted('edit')).toBeUndefined()
    expect(item.text()).toContain('任务')
    expect(item.get('.priority-badge').text()).toBe('P3 · 低')
  })

  it('adds with the selected priority and resets the next task to P2', async () => {
    const composer = mount(TodoComposer, { props: { disabled: false } })
    expect(composer.get('select').element.value).toBe('p2')
    await composer.get('select').setValue('p0')
    await composer.get('input').setValue('紧急任务')
    await composer.get('form').trigger('submit')
    expect(composer.emitted('add')).toEqual([['紧急任务', 'p0', null]])
    expect(composer.get('select').element.value).toBe('p2')
    await composer.setProps({ disabled: true })
    expect(composer.get('select').attributes('disabled')).toBeDefined()
  })

  it('saves priority changes together with the task text', async () => {
    const item = mount(TodoItem, { props: { todo: { id: 'one', text: '任务', completed: true, priority: 'p3' }, first: true, last: true, dragging: false } })
    await item.get('[title="编辑（也可双击文字）"]').trigger('click')
    expect(item.get('select').element.value).toBe('p3')
    await item.get('select').setValue('p1')
    expect(item.emitted('edit')).toBeUndefined()
    await item.get('[aria-label="保存编辑"]').trigger('click')
    expect(item.emitted('edit')).toEqual([['one', '任务', 'p1', null]])
  })

  it('shows local creation time with the full timestamp available and labels legacy tasks honestly', () => {
    const createdAt = Date.UTC(2026, 9, 25, 2, 30)
    const item = mount(TodoItem, { props: { todo: { id: 'new', text: '有时间的任务', completed: false, priority: 'p2', createdAt }, first: true, last: true, dragging: false } })
    expect(item.get('time').attributes('datetime')).toBe('2026-10-25T02:30:00.000Z')
    expect(item.get('time').text()).toMatch(/^添加于 \d{2}\/\d{2}\s\d{2}:\d{2}$/)
    expect(item.get('time').attributes('title')).toContain('2026')
    const legacy = mount(TodoItem, { props: { todo: { id: 'old', text: '旧任务', completed: true, priority: 'p1' }, first: true, last: true, dragging: false } })
    expect(legacy.find('time').exists()).toBe(false)
    expect(legacy.text()).toContain('添加时间未知')
  })

  it('previews opacity before committing, and disables reset when locked', async () => {
    const panel = mount(SettingsPanel, { props: { settings: { ...DEFAULT_SETTINGS, locked: true } } })
    const range = panel.get('input[type="range"]')
    ;(range.element as HTMLInputElement).value = '20'
    await range.trigger('input')
    expect(panel.emitted('previewOpacity')).toEqual([[0.2]])
    expect(panel.emitted('update')).toBeUndefined()
    await range.trigger('change')
    expect(panel.emitted('update')).toEqual([[{ backgroundOpacity: 0.2 }]])
    expect(panel.get('.reset-button').attributes('disabled')).toBeDefined()
  })
})
