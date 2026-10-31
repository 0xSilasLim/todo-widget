<script setup lang="ts">
import { ref, watch } from 'vue'
import { ArrowUpRight, ChevronLeft } from '@lucide/vue'
import { DEFAULT_BACKGROUND_COLOR, type Settings } from '../types'

const props = defineProps<{ settings: Settings }>()
const emit = defineEmits<{
  back: []; update: [patch: Partial<Settings>]; reset: []; previewOpacity: [opacity: number]; previewColor: [color: string]
}>()
const opacity = ref(Math.round(props.settings.backgroundOpacity * 100))
const color = ref(props.settings.backgroundColor)
watch(() => props.settings.backgroundOpacity, (value) => { opacity.value = Math.round(value * 100) })
watch(() => props.settings.backgroundColor, (value) => { color.value = value })

function preview(event: Event) {
  opacity.value = Number((event.target as HTMLInputElement).value)
  emit('previewOpacity', opacity.value / 100)
}

function previewColor(event: Event) {
  color.value = (event.target as HTMLInputElement).value
  emit('previewColor', color.value)
}

function resetColor() {
  color.value = DEFAULT_BACKGROUND_COLOR
  emit('update', { backgroundColor: DEFAULT_BACKGROUND_COLOR })
}
</script>

<template>
  <section id="settings-panel" class="settings-panel" aria-label="窗口设置">
    <button class="back-button" @click="$emit('back')"><ChevronLeft :size="16" />返回清单</button>
    <h1>窗口设置</h1>
    <label class="setting-row" for="always-on-top"><span><strong>始终置顶</strong><small>显示在其他普通窗口之上</small></span>
      <input id="always-on-top" class="switch" type="checkbox" :checked="settings.alwaysOnTop"
        @change="$emit('update', { alwaysOnTop: ($event.target as HTMLInputElement).checked })" /></label>
    <label class="setting-row" for="lock-position"><span><strong>锁定位置</strong><small>同时暂停拖动和大小调整</small></span>
      <input id="lock-position" class="switch" type="checkbox" :checked="settings.locked"
        @change="$emit('update', { locked: ($event.target as HTMLInputElement).checked })" /></label>
    <label class="setting-row" for="deadline-notifications"><span><strong>DDL 自动提醒</strong><small>未单独设置提醒的任务，在截止前 1 小时、到期时提醒</small></span>
      <input id="deadline-notifications" class="switch" type="checkbox" :checked="settings.deadlineNotifications"
        @change="$emit('update', { deadlineNotifications: ($event.target as HTMLInputElement).checked })" /></label>
    <p class="hint">到时只响一声，不弹横幅，无需开启 Windows 通知。应用运行或最小化时提醒，退出后停止；静音时听不到。</p>
    <div class="color-setting">
      <div class="color-setting-heading"><label for="background-color">背景颜色</label>
        <button class="color-reset" :disabled="color === DEFAULT_BACKGROUND_COLOR" @click="resetColor">恢复默认</button>
      </div>
      <div class="color-picker-row">
        <input id="background-color" type="color" :value="color" @input="previewColor"
          @change="$emit('update', { backgroundColor: ($event.target as HTMLInputElement).value })" />
        <output for="background-color">{{ color.toUpperCase() }}</output>
      </div>
      <p class="hint">窗口与任务卡片同步变色，文字自动适配深浅。</p>
    </div>
    <div class="opacity-setting"><label for="background-opacity">背景不透明度 <output for="background-opacity">{{ opacity }}%</output></label>
      <input id="background-opacity" type="range" min="20" max="100" step="1" :value="opacity" @input="preview"
        @change="$emit('update', { backgroundOpacity: opacity / 100 })" />
      <div class="range-labels"><span>20% 轻透</span><span>100% 实色</span></div>
      <p class="hint">只调整背景，文字和按钮保持清晰。</p>
    </div>
    <button class="secondary-button reset-button" :disabled="settings.locked" @click="$emit('reset')">
      <ArrowUpRight :size="16" />回到主屏右上角
    </button>
    <p class="hint settings-hint">{{ settings.locked ? '解锁后可移动和调整窗口大小。' : '按住顶部拖动，拖动边缘调整大小。' }}</p>
  </section>
</template>
