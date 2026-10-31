import { DEFAULT_BACKGROUND_COLOR } from '../types'

const TEXT_COLORS = { normal: '#263347', muted: '#5c6879', light: '#ffffff', dark: '#000000' }

function rgb(color: string) {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16))
}

function luminance(channels: number[]) {
  const linear = channels.map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

export function backgroundAppearance(color: string) {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color : DEFAULT_BACKGROUND_COLOR
  const channels = rgb(hex), background = luminance(channels)
  const contrast = (foreground: string) => {
    const light = luminance(rgb(foreground))
    return (Math.max(background, light) + 0.05) / (Math.min(background, light) + 0.05)
  }
  const text = contrast(TEXT_COLORS.normal) >= 4.5 ? TEXT_COLORS.normal
    : contrast(TEXT_COLORS.light) >= 4.5 ? TEXT_COLORS.light : TEXT_COLORS.dark
  const muted = contrast(TEXT_COLORS.muted) >= 4.5 ? TEXT_COLORS.muted : text
  return { rgb: channels.join(', '), text, muted }
}
