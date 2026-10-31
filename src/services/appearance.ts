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

function contrast(first: string, second: string) {
  const values = [luminance(rgb(first)), luminance(rgb(second))].sort((a, b) => a - b)
  return (values[1] + 0.05) / (values[0] + 0.05)
}

function mix(first: string, second: string, amount: number) {
  const start = rgb(first), end = rgb(second)
  return '#' + start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount).toString(16).padStart(2, '0')).join('')
}

function foreground(background: string) {
  return contrast(TEXT_COLORS.normal, background) >= 4.5 ? TEXT_COLORS.normal
    : contrast(TEXT_COLORS.light, background) >= 4.5 ? TEXT_COLORS.light : TEXT_COLORS.dark
}

function surface(base: string, target: string, amount: number, text: string) {
  for (let step = 10; step >= 0; step -= 1) {
    const candidate = mix(base, target, amount * step / 10)
    if (contrast(text, candidate) >= 4.5) return candidate
  }
  return base
}

function readableTint(seed: string, target: string, backgrounds: string[]) {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mix(seed, target, step / 20)
    if (backgrounds.every(background => contrast(candidate, background) >= 4.5)) return candidate
  }
  return target
}

export function backgroundAppearance(color: string) {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_BACKGROUND_COLOR
  const text = foreground(hex), dark = text === TEXT_COLORS.light
  const ink = dark ? TEXT_COLORS.light : TEXT_COLORS.dark
  const raised = surface(hex, TEXT_COLORS.light, 0.08, text)
  const soft = surface(hex, dark ? TEXT_COLORS.light : TEXT_COLORS.dark, 0.12, text)
  const border = surface(hex, ink, 0.2, text)
  const surfaces = [hex, raised, soft, border]
  const muted = surfaces.every(background => contrast(TEXT_COLORS.muted, background) >= 4.5) ? TEXT_COLORS.muted : text
  const accent = readableTint(hex, ink, surfaces)
  const onAccent = foreground(accent)
  const accentHover = surface(accent, onAccent === TEXT_COLORS.light ? TEXT_COLORS.dark : TEXT_COLORS.light, 0.12, onAccent)
  const dangerSoft = surface(hex, '#a32636', 0.12, text)
  const warningSoft = surface(hex, '#805218', 0.12, text)
  return {
    '--surface-rgb': rgb(hex).join(', '),
    '--color-surface': hex,
    '--color-raised': raised,
    '--color-border': border,
    '--color-text': text,
    '--color-muted': muted,
    '--color-accent': accent,
    '--color-accent-hover': accentHover,
    '--color-accent-soft': soft,
    '--color-on-accent': onAccent,
    '--color-danger': readableTint('#a32636', ink, [hex, raised, dangerSoft]),
    '--color-danger-soft': dangerSoft,
    '--color-warning': readableTint('#805218', ink, [hex, raised, warningSoft]),
    '--color-warning-soft': warningSoft,
    'color-scheme': dark ? 'dark' : 'light',
  }
}
