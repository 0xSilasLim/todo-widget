import { chromium, expect } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { once } from 'node:events'

const root = resolve(import.meta.dirname, '..')
const artifactDir = resolve(root, 'artifacts', `native-${Date.now()}`)
const profile = resolve(artifactDir, 'profile')
const executable = resolve(root, 'src-tauri/target/debug/todo-widget.exe')
const probeScript = resolve(root, 'scripts/window_probe.py')
const python = process.env.PYTHON ?? 'python'
const port = Number(process.env.TODO_WIDGET_CDP_PORT ?? 9223)
const keepOpen = process.argv.includes('--keep-open')
mkdirSync(profile, { recursive: true })
const log = openSync(resolve(artifactDir, 'app.log'), 'a')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const report = { artifactDir, checks: [], errors: [] }
let child, browser, page

function measure() {
  const result = JSON.parse(execFileSync(python, [probeScript, String(child.pid)], { encoding: 'utf8' }))
  expect(result.windows).toHaveLength(1)
  return { ...result.windows[0], monitors: result.monitors }
}

async function launch() {
  child = spawn(executable, [], {
    cwd: root, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, TODO_WIDGET_TEST_DATA_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  })
  child.on('error', (error) => { report.errors.push(String(error)) })
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Native app exited: ${child.exitCode}`)
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) break } catch {}
    await pause(100)
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => !candidate.url().startsWith('devtools:'))
    if (page) break
    await pause(100)
  }
  if (!page) throw new Error('No WebView2 page was exposed')
  page.on('pageerror', (error) => report.errors.push(String(error)))
  await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible()
  await expect(page.locator('.error-banner')).toHaveCount(0)
}

async function close() {
  const exited = once(child, 'exit')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await Promise.race([exited, pause(10000).then(() => { throw new Error('Native app did not close') })])
  await browser.close().catch(() => {})
  child = undefined
  browser = undefined
  await pause(500)
}

async function saveSettled() { await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible() }
async function showPending() { await page.getByRole('tab', { name: /^待完成/ }).click() }
async function showCompleted() { await page.getByRole('tab', { name: /^已完成/ }).click() }

async function opacity(value, name) {
  await page.locator('#background-opacity').evaluate((input, value) => {
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await saveSettled()
  const style = await page.locator('.widget').evaluate((element) => ({ color: getComputedStyle(element).backgroundColor, opacity: getComputedStyle(element).opacity }))
  expect(style.opacity).toBe('1')
  const imagePath = resolve(artifactDir, name)
  await page.screenshot({ path: imagePath, omitBackground: true })
  const pixels = JSON.parse(execFileSync(python, [probeScript, '--image', imagePath], { encoding: 'utf8' }))
  expect(pixels.background[3]).toBe(Math.round(value / 100 * 255))
  return { style, pixels, imagePath }
}

try {
  await launch()
  report.initialWindow = measure()
  const primary = report.initialWindow.monitors.find((monitor) => monitor.primary)
  const scale = report.initialWindow.dpi / 96
  const expected = { width: Math.round(320 * scale), height: Math.round(420 * scale),
    x: primary.work.x + primary.work.width - Math.round((320 + 16) * scale), y: primary.work.y + Math.round(16 * scale) }
  for (const key of Object.keys(expected)) expect(Math.abs(report.initialWindow[key] - expected[key])).toBeLessThanOrEqual(1)
  // Tao retains WS_CAPTION for Windows animations but removes non-client chrome
  // via WM_NCCALCSIZE. Measure the actual frame rather than that style bit.
  expect(report.initialWindow.width).toBe(report.initialWindow.clientWidth)
  expect(report.initialWindow.height).toBe(report.initialWindow.clientHeight)
  expect(report.initialWindow.toolWindow).toBe(false)
  expect(report.initialWindow.topmost).toBe(true)
  report.checks.push('First launch: 320×420 DIP, primary work area, 16 DIP inset, no frame, normal taskbar window')

  await page.locator('#new-todo').click()
  report.composerFocus = await page.locator('#new-todo').evaluate((input) => {
    const style = getComputedStyle(input), rect = input.getBoundingClientRect()
    const clip = input.closest('.composer').getBoundingClientRect()
    const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
    return { visible: input.matches(':focus-visible'), left: rect.left - extent >= clip.left - .5,
      right: rect.right + extent <= clip.right + .5, top: rect.top - extent >= clip.top - .5,
      bottom: rect.bottom + extent <= clip.bottom + .5 }
  })
  expect(Object.values(report.composerFocus).every(Boolean)).toBe(true)
  report.checks.push('New-task input focus outline fits all four edges of its scrolling container')

  for (const text of ['整理今天的重点', '完成窗口验收', '待删除的验收任务']) {
    await page.getByLabel('新增待办', { exact: true }).fill(text)
    await page.getByRole('button', { name: '添加待办', exact: true }).click()
  }
  const originalCreatedAt = await page.locator('.todo-item').first().locator('time').getAttribute('datetime')
  expect(Math.abs(Date.parse(originalCreatedAt) - Date.now())).toBeLessThan(60_000)
  await expect(page.locator('.todo-item').first().locator('time')).toHaveText(/^\d{2}\/\d{2}\s\d{2}:\d{2}$/)
  await expect(page.locator('.todo-item').first().locator('time')).toHaveAttribute('aria-label', /^添加于 /)
  await page.getByRole('button', { name: '编辑：整理今天的重点', exact: true }).click()
  await page.getByRole('textbox', { name: '编辑待办内容', exact: true }).fill('整理今天的三件重点')
  await page.getByRole('textbox', { name: '编辑待办内容', exact: true }).press('Enter')
  await page.getByRole('checkbox', { name: '完成：整理今天的三件重点', exact: true }).click()
  await expect(page.locator('.todo-text')).toHaveText(['完成窗口验收', '待删除的验收任务'])
  await expect(page.getByRole('tab', { name: /^已完成/ })).toHaveText('已完成1')
  await showCompleted()
  await expect(page.locator('.todo-text')).toHaveText(['整理今天的三件重点'])
  await expect(page.locator('time')).toHaveAttribute('datetime', originalCreatedAt)
  await expect(page.locator('.sort-handle')).toHaveCount(0)
  await page.getByRole('checkbox', { name: '恢复：整理今天的三件重点', exact: true }).click()
  await expect(page.getByText('还没有已完成任务', { exact: true })).toBeVisible()
  await showPending()
  await page.getByRole('button', { name: '删除：待删除的验收任务', exact: true }).click()
  await page.getByRole('button', { name: /^排序：完成窗口验收/ }).press('Alt+ArrowUp')
  await expect(page.locator('.todo-text')).toHaveText(['完成窗口验收', '整理今天的三件重点'])
  await page.locator('.sort-handle').nth(0).dragTo(page.locator('.sort-handle').nth(1))
  await expect(page.locator('.todo-text')).toHaveText(['整理今天的三件重点', '完成窗口验收'])
  await page.locator('.sort-handle').nth(0).dragTo(page.locator('.sort-handle').nth(1))
  await expect(page.locator('.todo-text')).toHaveText(['完成窗口验收', '整理今天的三件重点'])
  await page.getByRole('checkbox', { name: '完成：整理今天的三件重点', exact: true }).click()
  await expect(page.locator('.todo-text')).toHaveText(['完成窗口验收'])
  await saveSettled()
  await page.screenshot({ path: resolve(artifactDir, 'tasks.png'), omitBackground: true })
  report.checks.push('Native WebView2: add, edit, automatic completion grouping, restore, delete, drag sorting and keyboard sorting')

  await page.getByRole('button', { name: '窗口设置', exact: true }).click()
  report.alpha20 = await opacity(20, 'opacity-20.png')
  report.alpha100 = await opacity(100, 'opacity-100.png')
  await opacity(20, 'settings.png')
  report.checks.push('Background pixel alpha is 51 at 20% and 255 at 100%; widget opacity stays 1')
  await page.locator('#always-on-top').uncheck()
  await saveSettled()
  expect(measure().topmost).toBe(false)
  await page.locator('#always-on-top').check()
  await saveSettled()
  expect(measure().topmost).toBe(true)
  await page.locator('#always-on-top').uncheck()
  await page.locator('#lock-position').check()
  await saveSettled()
  expect(measure().resizable).toBe(false)
  const denied = await page.evaluate(async () => {
    const results = {}
    for (const [command, args] of [['start_drag', {}], ['start_resize', { direction: 'SouthEast' }],
      ['plugin:store|load', { path: 'unauthorized.json' }], ['plugin:window|set_always_on_top', { label: 'main', value: true }],
      ['plugin:notification|notify', { options: { title: 'Denied renderer notification' } }]]) {
      try { await window.__TAURI_INTERNALS__.invoke(command, args); results[command] = 'ALLOWED' } catch (error) { results[command] = String(error) }
    }
    return results
  })
  for (const result of Object.values(denied)) expect(result).not.toBe('ALLOWED')
  report.deniedCommands = denied
  report.checks.push('Native topmost flag switches both ways; lock disables native resize and rejects drag/resize; direct Store and broad window API access denied')
  const beforeRestart = measure()
  const storeBefore = JSON.parse(readFileSync(resolve(profile, 'widget.json'), 'utf8'))
  expect(storeBefore.todos.map((todo) => todo.text)).toEqual(['完成窗口验收', '整理今天的三件重点'])
  expect(storeBefore.todos[1].completed).toBe(true)
  expect(storeBefore.todos[1].createdAt).toBe(Date.parse(originalCreatedAt))
  await close()
  await launch()
  await expect(page.locator('.todo-text')).toHaveText(['完成窗口验收'])
  await showCompleted()
  await expect(page.locator('.todo-text')).toHaveText(['整理今天的三件重点'])
  await expect(page.getByRole('checkbox', { name: '恢复：整理今天的三件重点', exact: true })).toBeChecked()
  await expect(page.locator('time')).toHaveAttribute('datetime', originalCreatedAt)
  report.checks.push('New tasks show local creation time; editing, completing, restoring, ordering and full restart retain the original millisecond timestamp')
  report.restoredWindow = measure()
  for (const key of ['x', 'y', 'width', 'height']) expect(report.restoredWindow[key]).toBe(beforeRestart[key])
  expect(report.restoredWindow.topmost).toBe(false)
  expect(report.restoredWindow.resizable).toBe(false)
  const restoredAlpha = await page.locator('.widget').evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(restoredAlpha).toContain('0.2')
  report.checks.push('Full process restart restores text, completion, order, opacity, topmost, lock and window geometry from Tauri Store')
  await page.screenshot({ path: resolve(artifactDir, 'restarted.png'), omitBackground: true })
  await page.getByRole('button', { name: '窗口设置', exact: true }).click()
  await page.locator('#lock-position').uncheck()
  await page.locator('#always-on-top').check()
  await opacity(88, 'settings-default.png')
  await page.getByRole('button', { name: '返回清单', exact: true }).click()
  await showPending()
  await saveSettled()

  const priorities = ['p0', 'p1', 'p2', 'p3']
  const fixtureText = (priority) => `优先级验收 ${priority.toUpperCase()}`
  const taskRow = (text) => page.locator('.todo-item').filter({ has: page.getByText(text, { exact: true }) })
  await expect(page.getByLabel('新增待办优先级', { exact: true })).toHaveValue('p2')
  for (const priority of priorities) {
    await page.getByLabel('新增待办', { exact: true }).fill(fixtureText(priority))
    await page.getByLabel('新增待办优先级', { exact: true }).selectOption(priority)
    await page.getByRole('button', { name: '添加待办', exact: true }).click()
    await expect(taskRow(fixtureText(priority)).locator('.priority-badge')).toHaveAttribute('data-priority', priority)
    await expect(page.getByLabel('新增待办优先级', { exact: true })).toHaveValue('p2')
  }
  await page.getByRole('button', { name: `编辑：${fixtureText('p0')}`, exact: true }).click()
  await page.getByLabel('编辑待办优先级', { exact: true }).selectOption('p3')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await expect(taskRow(fixtureText('p0')).locator('.priority-badge')).toHaveAttribute('data-priority', 'p0')
  await page.getByRole('button', { name: `编辑：${fixtureText('p0')}`, exact: true }).click()
  await page.getByLabel('编辑待办优先级', { exact: true }).selectOption('p1')
  await page.getByRole('button', { name: '保存编辑', exact: true }).click()
  await saveSettled()
  await close()
  // Seed only the closed, isolated profile with a task from the previous schema.
  const storePath = resolve(profile, 'widget.json')
  const legacyText = '旧版待办优先级兼容'
  const legacyStore = JSON.parse(readFileSync(storePath, 'utf8'))
  legacyStore.todos.push({ id: 'legacy-priority-fixture', text: legacyText, completed: true })
  writeFileSync(storePath, JSON.stringify(legacyStore, null, 2))
  await launch()
  for (const priority of priorities) {
    await expect(taskRow(fixtureText(priority)).locator('.priority-badge')).toHaveAttribute('data-priority', priority === 'p0' ? 'p1' : priority)
  }
  await showCompleted()
  await expect(taskRow(legacyText).locator('.priority-badge')).toHaveAttribute('data-priority', 'p2')
  await expect(taskRow(legacyText).locator('.todo-created')).toHaveText('添加时间未知')
  await expect(page.getByRole('checkbox', { name: `恢复：${legacyText}`, exact: true })).toBeChecked()
  await page.getByRole('button', { name: `编辑：${legacyText}`, exact: true }).click()
  await page.getByLabel('编辑待办优先级', { exact: true }).selectOption('p0')
  await page.getByRole('button', { name: '保存编辑', exact: true }).click()
  await saveSettled()
  const upgradedStore = JSON.parse(readFileSync(storePath, 'utf8'))
  expect(upgradedStore.todos.map((todo) => todo.text)).toEqual(legacyStore.todos.map((todo) => todo.text))
  expect(upgradedStore.todos.find((todo) => todo.id === 'legacy-priority-fixture')).toEqual({
    id: 'legacy-priority-fixture', text: legacyText, completed: true, priority: 'p0',
  })
  await close()
  await launch()
  await showCompleted()
  await expect(taskRow(legacyText).locator('.priority-badge')).toHaveAttribute('data-priority', 'p0')
  report.checks.push('P0–P3 add/edit/cancel and full-process restart persist priorities; legacy tasks default to P2 while retaining text, completion and order')

  await page.getByRole('button', { name: `永久删除：${legacyText}`, exact: true }).click()
  await expect(page.getByText('永久删除这条已完成任务？删除后无法恢复。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '取消', exact: true }).press('Escape')
  await expect(taskRow(legacyText).locator('.priority-badge')).toHaveAttribute('data-priority', 'p0')
  await page.getByRole('button', { name: `永久删除：${legacyText}`, exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await saveSettled()
  expect(JSON.parse(readFileSync(storePath, 'utf8')).todos.some((todo) => todo.id === 'legacy-priority-fixture')).toBe(true)
  await page.getByRole('button', { name: `永久删除：${legacyText}`, exact: true }).click()
  await page.screenshot({ path: resolve(artifactDir, 'delete-confirmation.png'), omitBackground: true })
  await page.getByRole('button', { name: '确认永久删除', exact: true }).click()
  await saveSettled()
  expect(JSON.parse(readFileSync(storePath, 'utf8')).todos.some((todo) => todo.id === 'legacy-priority-fixture')).toBe(false)
  await close()
  await launch()
  await showCompleted()
  await expect(page.locator('.todo-text')).toHaveText(['整理今天的三件重点'])
  await expect(page.getByRole('tab', { name: /^已完成/ })).toHaveText('已完成1')
  await page.screenshot({ path: resolve(artifactDir, 'completed.png'), omitBackground: true })
  report.checks.push('Completed tasks have their own counted view; cancel/Escape preserves them; confirmed permanent deletion removes only that task from Store and survives process restart')

  // Sorting must skip completed records interleaved with pending tasks in Store.
  await showPending()
  await page.getByRole('button', { name: /^排序：优先级验收 P0/ }).press('Alt+ArrowUp')
  await expect(page.locator('.todo-text').first()).toHaveText(fixtureText('p0'))
  await page.getByRole('button', { name: /^排序：优先级验收 P0/ }).press('Alt+ArrowDown')
  await expect(page.locator('.todo-text').first()).toHaveText('完成窗口验收')
  report.checks.push('Keyboard sorting skips completed records in Store and reorders visible pending tasks')
  for (const text of priorities.map(fixtureText)) {
    await page.getByRole('button', { name: `删除：${text}`, exact: true }).click()
  }
  await page.getByRole('button', { name: '编辑：完成窗口验收', exact: true }).click()
  await page.getByLabel('编辑待办优先级', { exact: true }).selectOption('p0')
  await page.getByRole('button', { name: '保存编辑', exact: true }).click()
  await showCompleted()
  await page.getByRole('button', { name: '编辑：整理今天的三件重点', exact: true }).click()
  await page.getByLabel('编辑待办优先级', { exact: true }).selectOption('p1')
  await page.getByRole('button', { name: '保存编辑', exact: true }).click()
  await saveSettled()
  await page.screenshot({ path: resolve(artifactDir, 'completed-priorities.png'), omitBackground: true })
  await showPending()
  await page.screenshot({ path: resolve(artifactDir, 'priorities.png'), omitBackground: true })
  async function measureLayout() { return page.evaluate(() => {
    const widget = document.querySelector('.widget')
    const originalWidth = widget.style.width
    const results = [280, 320, 375].map((width) => {
      widget.style.width = `${width}px`
      const right = widget.getBoundingClientRect().right
      return { width, overflow: widget.scrollWidth > widget.clientWidth,
        metadataSingleLine: [...document.querySelectorAll('.todo-meta')].every((meta) => {
          const bounds = meta.getBoundingClientRect()
          return meta.scrollWidth <= meta.clientWidth && [...meta.children].every((element) => {
            const rect = element.getBoundingClientRect()
            return Math.abs(rect.top - bounds.top) < 1 && rect.height <= parseFloat(getComputedStyle(element).lineHeight) + 1 && rect.left >= bounds.left - .5 && rect.right <= bounds.right + .5
          })
        }),
        controlsFit: [...document.querySelectorAll('.composer-inputs > *, .task-tab, .todo-item, .delete-actions button, .deadline-badge, .deadline-fields input')].every((element) => element.getBoundingClientRect().right <= right) }
    })
    widget.style.width = originalWidth
    return results
  }) }
  report.priorityLayout = await measureLayout()
  await showCompleted()
  await page.getByRole('button', { name: '永久删除：整理今天的三件重点', exact: true }).click()
  report.completedLayout = await measureLayout()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await showPending()
  for (const layout of [...report.priorityLayout, ...report.completedLayout]) {
    expect(layout.overflow).toBe(false)
    expect(layout.metadataSingleLine).toBe(true)
    expect(layout.controlsFit).toBe(true)
  }
  report.checks.push('Both task views, tabs, priorities, composer and deletion confirmation fit widths of 280, 320 and 375 CSS pixels without horizontal overflow')

  // Exercise deadlines through the same date/time controls as the desktop user.
  const parts = (timestamp) => {
    const date = new Date(timestamp), pad = (value) => String(value).padStart(2, '0')
    return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` }
  }
  const readStore = () => JSON.parse(readFileSync(storePath, 'utf8'))
  async function enterDeadline(timestamp, prefix) {
    const value = parts(timestamp)
    await page.locator(`#${prefix}-date`).fill(value.date)
    await page.locator(`#${prefix}-time`).fill(value.time)
  }
  async function addDeadlineTask(text, timestamp) {
    await page.getByLabel('新增待办', { exact: true }).fill(text)
    await page.locator('.deadline-toggle').click()
    await enterDeadline(timestamp, 'new-deadline')
    await page.getByRole('button', { name: '添加待办', exact: true }).click()
    await saveSettled()
    const task = readStore().todos.find((todo) => todo.text === text)
    expect(task.dueAt).toBe(Math.floor(timestamp / 60_000) * 60_000)
    await expect(page.locator('.deadline-toggle')).toHaveAttribute('aria-expanded', 'false')
    return task
  }
  const deadlineText = 'DDL 验收：完成阅读与笔记'
  let deadlineTask = await addDeadlineTask(deadlineText, Date.now() + 2 * 86_400_000)
  await expect(taskRow(deadlineText).locator('.deadline-badge')).toHaveClass(/deadline-neutral/)
  const initialDueAt = deadlineTask.dueAt
  await taskRow(deadlineText).locator('.deadline-badge').click()
  await enterDeadline(Date.now() - 3_600_000, `deadline-${deadlineTask.id}`)
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  expect(readStore().todos.find((todo) => todo.id === deadlineTask.id).dueAt).toBe(initialDueAt)
  await taskRow(deadlineText).locator('.deadline-badge').click()
  await enterDeadline(Date.now() + 12 * 3_600_000, `deadline-${deadlineTask.id}`)
  report.deadlineEditorLayout = await measureLayout()
  await page.getByRole('button', { name: '保存编辑', exact: true }).click()
  await saveSettled()
  await expect(taskRow(deadlineText).locator('.deadline-badge')).toHaveClass(/deadline-soon/)
  const shortText = 'DDL 验收：即将截止'
  const shortTask = await addDeadlineTask(shortText, Date.now() + 30 * 60_000)
  await expect(taskRow(shortText).locator('.deadline-badge')).toHaveClass(/deadline-urgent/)
  const overdueText = 'DDL 验收：已逾期'
  await addDeadlineTask(overdueText, Date.now() - 2 * 3_600_000)
  await expect(taskRow(overdueText).locator('.deadline-badge')).toHaveClass(/deadline-overdue/)
  await page.screenshot({ path: resolve(artifactDir, 'deadlines.png'), omitBackground: true })
  report.deadlineLayout = await measureLayout()
  await page.locator('.deadline-toggle').click()
  await page.locator('#new-deadline-date').fill(parts(Date.now() + 86_400_000).date)
  await expect(page.locator('#new-deadline-time')).toHaveValue('23:59')
  report.composerDeadlineLayout = await measureLayout()
  await page.getByRole('button', { name: '清除 DDL', exact: true }).click()
  await page.locator('.deadline-toggle').click()
  for (const layout of [...report.deadlineLayout, ...report.deadlineEditorLayout, ...report.composerDeadlineLayout]) {
    expect(layout.overflow).toBe(false)
    expect(layout.metadataSingleLine).toBe(true)
    expect(layout.controlsFit).toBe(true)
  }
  await page.getByRole('checkbox', { name: `完成：${shortText}`, exact: true }).click()
  await showCompleted()
  await expect(taskRow(shortText).locator('.deadline-badge')).toHaveClass(/deadline-neutral/)
  await expect(taskRow(shortText).locator('.deadline-badge')).toHaveAttribute('title', /已完成/)
  await saveSettled()
  await close()
  await launch()
  await showCompleted()
  await expect(taskRow(shortText).locator('.deadline-badge')).toContainText(parts(shortTask.dueAt).time)
  await page.getByRole('checkbox', { name: `恢复：${shortText}`, exact: true }).click()
  await showPending()
  expect(readStore().todos.find((todo) => todo.id === shortTask.id).dueAt).toBe(shortTask.dueAt)
  await taskRow(shortText).locator('.deadline-badge').click()
  await page.getByRole('button', { name: '清除 DDL', exact: true }).click()
  await page.getByRole('button', { name: '保存编辑', exact: true }).click()
  await saveSettled()
  expect(readStore().todos.find((todo) => todo.id === shortTask.id).dueAt).toBeUndefined()
  await expect(taskRow(shortText).locator('.deadline-badge')).toHaveText('设置 DDL')
  report.checks.push('DDL add/edit/cancel/clear, date-only 23:59, all urgency levels, completion/restore, persisted timestamps, restart, and narrow editor layouts pass')

  // Native scheduler: an isolated, synthetic task with a real near-future DDL.
  // Other fixture deadlines are cleared before enabling OS notifications.
  for (const text of [deadlineText, overdueText]) {
    await taskRow(text).locator('.deadline-badge').click()
    await page.getByRole('button', { name: '清除 DDL', exact: true }).click()
    await page.getByRole('button', { name: '保存编辑', exact: true }).click()
  }
  const reminderText = 'DDL 自动验收提醒（测试任务）'
  const reminderTask = await addDeadlineTask(reminderText, Date.now() + 90_000)
  await page.getByRole('button', { name: '窗口设置', exact: true }).click()
  await page.locator('#deadline-notifications').check()
  await saveSettled()
  await page.getByRole('button', { name: '返回清单', exact: true }).click()
  await page.getByRole('button', { name: '最小化', exact: true }).click()
  await expect.poll(() => readStore().deadlineReminders?.[reminderTask.id]?.stage, { timeout: 35_000 }).toBe(1)
  report.reminderWhileMinimized = measure().minimized
  expect(report.reminderWhileMinimized).toBe(true)
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('reveal_widget'))
  await close()
  await launch()
  expect(readStore().deadlineReminders[reminderTask.id]).toEqual({ dueAt: reminderTask.dueAt, stage: 1 })
  await expect.poll(() => readStore().deadlineReminders?.[reminderTask.id]?.stage, { timeout: 120_000 }).toBe(2)
  await close()
  await launch()
  expect(readStore().deadlineReminders[reminderTask.id]).toEqual({ dueAt: reminderTask.dueAt, stage: 2 })
  await page.getByRole('checkbox', { name: `完成：${reminderText}`, exact: true }).click()
  await showCompleted()
  await taskRow(reminderText).locator('.deadline-badge').click()
  await enterDeadline(Date.now() - 60_000, `deadline-${reminderTask.id}`)
  await page.getByRole('button', { name: '保存编辑', exact: true }).click()
  await saveSettled()
  await pause(16_000)
  expect(readStore().deadlineReminders[reminderTask.id]).toBeUndefined()
  await page.getByRole('checkbox', { name: `恢复：${reminderText}`, exact: true }).click()
  await expect.poll(() => readStore().deadlineReminders?.[reminderTask.id]?.stage, { timeout: 25_000 }).toBe(2)
  await showPending()
  await taskRow(reminderText).locator('.deadline-badge').click()
  await page.getByRole('button', { name: '清除 DDL', exact: true }).click()
  await page.getByRole('button', { name: '保存编辑', exact: true }).click()
  await saveSettled()
  expect(readStore().deadlineReminders[reminderTask.id]).toBeUndefined()
  await page.getByRole('button', { name: '窗口设置', exact: true }).click()
  await page.locator('#deadline-notifications').uncheck()
  await saveSettled()
  await page.getByRole('button', { name: '返回清单', exact: true }).click()
  report.checks.push('Rust scheduler submits 1-hour/due reminders while minimized, persists deduplication through process restarts, skips completed tasks, rearms changed deadlines and stops after clear/disable; Windows banner delivery remains subject to OS settings')
  // Use a compact synthetic fixture for shareable screenshots, never personal data.
  const screenshotNow = Date.now()
  await page.evaluate((now) => window.__TAURI_INTERNALS__.invoke('save_todos', { todos: [
    { id: 'ddl-docs-one', text: '完成论文阅读与笔记', completed: false, priority: 'p1', createdAt: now - 3_600_000, dueAt: now + 6 * 3_600_000 },
    { id: 'ddl-docs-two', text: '提交本周工作总结', completed: false, priority: 'p0', createdAt: now - 7_200_000, dueAt: now + 35 * 60_000 },
  ] }), screenshotNow)
  await close()
  await launch()
  await page.screenshot({ path: resolve(artifactDir, 'deadlines-docs.png'), omitBackground: true })
  await page.locator('.deadline-toggle').click()
  report.minimumHeightLayout = await page.evaluate(() => {
    const widget = document.querySelector('.widget')
    const originalWidth = widget.style.width, originalHeight = widget.style.height
    const results = [280, 320, 375].map((width) => {
      widget.style.width = `${width}px`; widget.style.height = '320px'
      const bounds = widget.getBoundingClientRect()
      const footer = document.querySelector('.widget-footer').getBoundingClientRect()
      const tabs = document.querySelector('.task-tabs').getBoundingClientRect()
      const composer = document.querySelector('.composer').getBoundingClientRect()
      return { width, height: 320, footerFits: footer.bottom <= bounds.bottom, tabsDoNotOverlapComposer: tabs.bottom <= composer.top,
        overflow: widget.scrollWidth > widget.clientWidth }
    })
    widget.style.width = originalWidth; widget.style.height = originalHeight
    return results
  })
  for (const layout of report.minimumHeightLayout) {
    expect(layout.footerFits).toBe(true)
    expect(layout.tabsDoNotOverlapComposer).toBe(true)
    expect(layout.overflow).toBe(false)
  }
  await page.locator('.deadline-toggle').click()
  report.checks.push('Expanded composer remains usable at the minimum 320px height with no tab overlap or clipped footer')
  expect(report.errors).toEqual([])
  report.passed = true
  if (keepOpen) {
    report.runningPid = child.pid
    report.profile = profile
    writeFileSync(resolve(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
    writeFileSync(resolve(root, 'artifacts/latest-native.json'), JSON.stringify(report, null, 2))
    console.log(`Native acceptance passed. Interactive window PID ${child.pid}; close the window to finish.`)
    await once(child, 'exit')
    child = undefined
    await browser.close().catch(() => {})
    browser = undefined
  } else { await close() }
} catch (error) {
  report.passed = false
  report.errors.push(String(error?.stack ?? error))
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifactDir, 'failure.png'), omitBackground: true }).catch(() => {})
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (child && child.exitCode === null) child.kill()
  writeFileSync(resolve(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  writeFileSync(resolve(root, 'artifacts/latest-native.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
