import { MINUTE } from './deadlines'

export function nextReminderTime(delay = 10 * MINUTE, now = Date.now()) {
  return Math.ceil((now + delay) / MINUTE) * MINUTE
}

export function reminderStatus(remindAt: number, now: number, completed = false) {
  const date = new Date(remindAt)
  const label = date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const fullLabel = date.toLocaleString('zh-CN', { hourCycle: 'h23' })
  const state = completed ? '任务已完成，提醒已停止' : remindAt <= now ? '提醒时间已到' : '将在此时间提醒一次'
  return { label, description: `提醒时间：${fullLabel}；${state}；点击修改` }
}
