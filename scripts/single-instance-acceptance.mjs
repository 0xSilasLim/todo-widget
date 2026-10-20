import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, openSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const artifactDir = resolve(root, 'artifacts', `single-instance-${Date.now()}`)
const profile = resolve(artifactDir, 'profile')
const executable = resolve(root, 'src-tauri/target/debug/todo-widget.exe')
const python = process.env.PYTHON ?? 'python'
const port = Number(process.env.TODO_WIDGET_CDP_PORT ?? 9243)
mkdirSync(profile, { recursive: true })
const log = openSync(resolve(artifactDir, 'app.log'), 'a')
const report = { artifactDir, checks: [], errors: [] }
const children = []
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let browser, page, primary

function launch() {
  const child = spawn(executable, [], {
    cwd: root, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, TODO_WIDGET_TEST_DATA_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  })
  child.on('error', (error) => report.errors.push(String(error)))
  children.push(child)
  return child
}

function measure(pid) {
  return JSON.parse(execFileSync(python, [resolve(root, 'scripts/window_probe.py'), String(pid)], { encoding: 'utf8' }))
}

async function until(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await pause(100)
  }
  throw new Error(message)
}

async function repeatLaunch() {
  const duplicate = launch()
  await until(() => duplicate.exitCode !== null,
    'Repeated launch stayed running instead of exiting and activating the original window', 5000)
  assert.equal(duplicate.exitCode, 0)
  assert.equal(primary.exitCode, null)
  const current = measure(primary.pid)
  assert.equal(current.windows.length, 1)
  assert.equal(current.windows[0].handle, report.initial.windows[0].handle)
  return current
}

try {
  primary = launch()
  await until(async () => {
    if (primary.exitCode !== null) throw new Error(`Initial process exited: ${primary.exitCode}`)
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok } catch { return false }
  }, 'WebView2 did not start', 20000)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  await until(() => {
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => !candidate.url().startsWith('devtools:'))
    return Boolean(page)
  }, 'No application page')
  await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible()
  report.initial = measure(primary.pid)
  assert.equal(report.initial.windows.length, 1)

  for (let attempt = 0; attempt < 3; attempt += 1) await repeatLaunch()
  report.checks.push('Three repeated launches exit successfully and reuse the original process and window handle')

  await page.getByLabel('新增待办', { exact: true }).fill('单实例回归：保留原有任务')
  await page.getByRole('button', { name: '添加待办', exact: true }).click()
  await page.getByRole('button', { name: '取消始终置顶', exact: true }).click()
  await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible()
  const beforeMinimize = measure(primary.pid).windows[0]
  await page.getByRole('button', { name: '最小化', exact: true }).click()
  await until(() => measure(primary.pid).windows[0]?.minimized, 'Window did not minimize')
  report.minimized = measure(primary.pid)
  report.restored = await repeatLaunch()
  assert.equal(report.restored.windows[0].minimized, false)
  await until(() => measure(primary.pid).foregroundPid === primary.pid, 'Original window was not focused')
  report.restored = measure(primary.pid)
  for (const key of ['x', 'y', 'width', 'height', 'topmost']) {
    assert.equal(report.restored.windows[0][key], beforeMinimize[key])
  }
  await expect(page.locator('.todo-text')).toHaveText(['单实例回归：保留原有任务'])
  await expect(page.getByRole('button', { name: '始终置顶', exact: true })).toBeVisible()
  report.checks.push('Launching while minimized restores and focuses the same window, preserving geometry, tasks and topmost setting')

  const burst = [launch(), launch(), launch()]
  await Promise.all(burst.map((child) => once(child, 'exit', { signal: AbortSignal.timeout(10000) })))
  for (const child of burst) assert.equal(child.exitCode, 0)
  assert.equal(measure(primary.pid).windows.length, 1)
  report.checks.push('Three simultaneous repeated launches create no additional persistent process or window')
  report.passed = true
} catch (error) {
  report.passed = false
  report.errors.push(String(error?.stack ?? error))
  report.runningProcesses = children.filter((child) => child.exitCode === null).map((child) => measure(child.pid))
  process.exitCode = 1
} finally {
  // Only processes created here use the isolated acceptance profile.
  if (page && !page.isClosed() && primary?.exitCode === null) {
    const exited = once(primary, 'exit', { signal: AbortSignal.timeout(5000) }).catch(() => {})
    await page.getByRole('button', { name: '关闭', exact: true }).click().catch(() => {})
    await exited
  }
  if (browser) await browser.close().catch(() => {})
  for (const child of children) if (child.exitCode === null) child.kill()
  writeFileSync(resolve(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  writeFileSync(resolve(root, 'artifacts/latest-single-instance.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
