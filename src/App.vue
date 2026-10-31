<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { Grip, LockKeyhole } from '@lucide/vue'
import WidgetHeader from './components/WidgetHeader.vue'
import TodoList from './components/TodoList.vue'
import TodoComposer from './components/TodoComposer.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { useWidget } from './composables/useWidget'
import { widgetService } from './services/widgetService'
import { backgroundAppearance } from './services/appearance'
import type { Settings } from './types'

const model = useWidget()
const { todos, settings, loading, saving, error, ready, remaining } = model
const settingsOpen = ref(false)
const previewOpacity = ref<number>()
const previewColor = ref<string>()
const backgroundStyle = computed(() => {
  const appearance = backgroundAppearance(previewColor.value ?? settings.value.backgroundColor)
  return {
    '--background-opacity': previewOpacity.value ?? settings.value.backgroundOpacity,
    '--surface-rgb': appearance.rgb,
    '--task-text': appearance.text,
    '--task-muted': appearance.muted,
  }
})
const directions = ['North', 'NorthEast', 'East', 'SouthEast', 'South', 'SouthWest', 'West', 'NorthWest']
let unlistenClose: UnlistenFn | undefined
let unlistenReminders: UnlistenFn | undefined
const reminderError = ref('')

function resize(direction: string) {
  if (!settings.value.locked && ready.value) void model.runWindowAction(() => widgetService.startResize(direction))
}

function toggleSettings() {
  settingsOpen.value = !settingsOpen.value
  previewOpacity.value = undefined
  previewColor.value = undefined
}

function updateSettings(patch: Partial<Settings>) {
  if (patch.backgroundOpacity !== undefined) previewOpacity.value = undefined
  if (patch.backgroundColor !== undefined) previewColor.value = undefined
  return model.updateSettings(patch)
}

onMounted(async () => {
  if (widgetService.isDesktop()) unlistenClose = await widgetService.guardClose(model.close)
  if (widgetService.isDesktop()) unlistenReminders = await widgetService.watchReminderErrors((message) => { reminderError.value = message })
  await model.initialize()
})
onBeforeUnmount(() => { unlistenClose?.(); unlistenReminders?.() })
</script>

<template>
  <main class="widget" :class="{ 'position-locked': settings.locked }" :style="backgroundStyle">
    <WidgetHeader :locked="settings.locked" :pinned="settings.alwaysOnTop" :disabled="!ready" :settings-open="settingsOpen"
      @drag="model.runWindowAction(widgetService.startDrag)" @pin="model.updateSettings({ alwaysOnTop: !settings.alwaysOnTop })"
      @settings="toggleSettings" @minimize="model.runWindowAction(widgetService.minimize)" @close="model.close" />
    <div v-if="error" class="error-banner" role="alert"><span>{{ error }}</span><button @click="model.retry">重试</button></div>
    <div v-if="reminderError" class="error-banner" role="status">桌面提醒暂不可用，将自动重试：{{ reminderError }}</div>
    <div v-if="loading" class="loading-state" role="status">正在读取本地清单…</div>
    <template v-else-if="ready">
      <SettingsPanel v-if="settingsOpen" :settings="settings" @back="toggleSettings"
        @update="updateSettings" @preview-opacity="previewOpacity = $event" @preview-color="previewColor = $event"
        @reset="model.runWindowAction(widgetService.resetPosition)" />
      <template v-else>
        <section class="list-heading"><h1>待办清单</h1><span class="count-label">{{ remaining ? `${remaining} 件待完成` : todos.length ? '全部完成了' : '从一件小事开始' }}</span></section>
        <TodoList :todos="todos" @toggle="model.toggle" @edit="model.edit" @remove="model.remove" @reorder="model.move" @move="model.moveBy" />
        <TodoComposer :disabled="!ready" @add="model.add" />
      </template>
    </template>
    <footer class="widget-footer"><span role="status" aria-live="polite">{{ saving ? '正在保存…' : error ? '尚未保存' : ready ? '已保存在本机' : '本地待办' }}</span>
      <span v-if="settings.locked" class="lock-status"><LockKeyhole :size="11" />位置已锁定</span>
      <button v-else class="resize-grip" aria-label="调整窗口大小" title="按住调整窗口大小" :disabled="!ready" @mousedown.left.prevent="resize('SouthEast')"><Grip :size="16" /></button>
    </footer>
    <template v-if="!settings.locked && ready"><div v-for="direction in directions" :key="direction" class="resize-edge" :class="`resize-${direction}`" aria-hidden="true" @mousedown.left.prevent="resize(direction)" /></template>
  </main>
</template>
