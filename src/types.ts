// Retained in the storage contract for compatibility with existing task files.
export type Priority = 'p0' | 'p1' | 'p2' | 'p3'
export const DEFAULT_PRIORITY: Priority = 'p2'

export interface Todo {
  id: string
  text: string
  completed: boolean
  priority: Priority
  createdAt?: number | null
  dueAt?: number | null
  remindAt?: number | null
}

export interface Settings {
  alwaysOnTop: boolean
  locked: boolean
  backgroundOpacity: number
  backgroundColor: string
  deadlineNotifications: boolean
}

export interface WidgetData {
  todos: Todo[]
  settings: Settings
}

export const DEFAULT_BACKGROUND_COLOR = '#f4f6f9'

export const DEFAULT_SETTINGS: Settings = {
  alwaysOnTop: true,
  locked: false,
  backgroundOpacity: 0.88,
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  deadlineNotifications: false,
}

export const MAX_TODO_LENGTH = 500
