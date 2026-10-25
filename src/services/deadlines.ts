export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function localDateParts(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

export function parseLocalDeadline(date: string, time = '23:59'): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  if (year < 1970 || year > 9999) return null
  const result = new Date(year, month - 1, day, hour, minute)
  // Reject invalid dates and local times skipped by a daylight-saving change.
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day
    || result.getHours() !== hour || result.getMinutes() !== minute) return null
  const timestamp = result.getTime()
  return timestamp >= 0 && timestamp <= 253_402_300_799_999 ? timestamp : null
}

function duration(milliseconds: number) {
  if (milliseconds < MINUTE) return '不到 1 分钟'
  if (milliseconds < HOUR) return `${Math.ceil(milliseconds / MINUTE)} 分钟`
  if (milliseconds < DAY) return `${Math.floor(milliseconds / HOUR)} 小时 ${Math.floor(milliseconds % HOUR / MINUTE)} 分钟`
  return `${Math.floor(milliseconds / DAY)} 天 ${Math.floor(milliseconds % DAY / HOUR)} 小时`
}

export function deadlineStatus(dueAt: number, now: number, completed = false) {
  const difference = dueAt - now
  const date = new Date(dueAt)
  const label = date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const fullLabel = date.toLocaleString('zh-CN', { hourCycle: 'h23' })
  if (completed) return { label, fullLabel, tone: 'neutral', remaining: '已完成' }
  if (difference <= 0) return { label, fullLabel, tone: 'overdue', remaining: difference === 0 ? '已到截止时间' : `已逾期 ${duration(-difference)}` }
  return {
    label, fullLabel, tone: difference <= HOUR ? 'urgent' : difference <= DAY ? 'soon' : 'neutral',
    remaining: `${difference <= HOUR ? '仅剩' : '剩余'} ${duration(difference)}`,
  }
}
