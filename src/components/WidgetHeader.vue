<script setup lang="ts">
import { GripHorizontal, LockKeyhole, Minus, Pin, PinOff, Settings2, X } from '@lucide/vue'

defineProps<{ locked: boolean; pinned: boolean; disabled: boolean; settingsOpen: boolean }>()
defineEmits<{ drag: []; pin: []; settings: []; minimize: []; close: [] }>()
</script>

<template>
  <header class="widget-header">
    <button class="drag-area" :disabled="locked || disabled" :title="locked ? '位置已锁定' : '按住拖动窗口'"
      aria-label="拖动窗口" @mousedown.left.prevent="!locked && $emit('drag')">
      <LockKeyhole v-if="locked" :size="16" /><GripHorizontal v-else :size="16" />
      <span>Todo</span>
    </button>
    <nav class="window-controls" aria-label="窗口操作">
      <button class="icon-button" :class="{ selected: pinned }" :disabled="disabled"
        :aria-pressed="pinned" :aria-label="pinned ? '取消始终置顶' : '始终置顶'"
        :title="pinned ? '取消始终置顶' : '始终置顶'" @click="$emit('pin')">
        <Pin v-if="pinned" :size="16" /><PinOff v-else :size="16" />
      </button>
      <button class="icon-button" :class="{ selected: settingsOpen }" :disabled="disabled"
        :aria-expanded="settingsOpen" aria-controls="settings-panel" aria-label="窗口设置" title="窗口设置"
        @click="$emit('settings')"><Settings2 :size="16" /></button>
      <button class="icon-button" aria-label="最小化" title="最小化" @click="$emit('minimize')"><Minus :size="16" /></button>
      <button class="icon-button close-button" aria-label="关闭" title="关闭（下次启动恢复）" @click="$emit('close')"><X :size="16" /></button>
    </nav>
  </header>
</template>
