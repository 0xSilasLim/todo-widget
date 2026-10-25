export const PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const
export type Priority = typeof PRIORITIES[number]
export const DEFAULT_PRIORITY: Priority = 'p2'
export const PRIORITY_LABELS: Record<Priority, string> = {
  p0: '紧急', p1: '高', p2: '普通', p3: '低',
}

export interface Todo {
  id: string
  text: string
  completed: boolean
  priority: Priority
  createdAt?: number | null
}

export interface Settings {
  alwaysOnTop: boolean
  locked: boolean
  backgroundOpacity: number
}

export interface WidgetData {
  todos: Todo[]
  settings: Settings
}

export const DEFAULT_SETTINGS: Settings = {
  alwaysOnTop: true,
  locked: false,
  backgroundOpacity: 0.88,
}

export const MAX_TODO_LENGTH = 500
