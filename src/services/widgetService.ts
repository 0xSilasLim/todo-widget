import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Settings, Todo, WidgetData } from '../types'

// One native service owns access to the Store and window commands. A browser
// preview never silently falls back to a second persistence implementation.
export const widgetService = {
  isDesktop: isTauri,
  load: () => invoke<WidgetData>('load_widget'),
  reveal: () => invoke<void>('reveal_widget'),
  saveTodos: (todos: Todo[]) => invoke<void>('save_todos', { todos }),
  saveSettings: (settings: Settings) => invoke<void>('update_settings', { settings }),
  watchReminderErrors: (callback: (error: string) => void) => listen<string>('deadline-reminder-error', (event) => callback(event.payload)),
  resetPosition: () => invoke<void>('reset_position'),
  startDrag: () => invoke<void>('start_drag'),
  startResize: (direction: string) => invoke<void>('start_resize', { direction }),
  minimize: () => getCurrentWindow().minimize(),
  close: () => getCurrentWindow().destroy(),
  guardClose: (close: () => Promise<void>): Promise<UnlistenFn> => getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault()
    await close()
  }),
}
