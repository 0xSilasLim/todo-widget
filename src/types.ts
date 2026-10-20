export interface Todo {
  id: string
  text: string
  completed: boolean
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
