import { describe, expect, it } from 'vitest'
import { backgroundAppearance } from '../src/services/appearance'
import { DEFAULT_BACKGROUND_COLOR } from '../src/types'

function contrast(first: string, second: string) {
  const brightness = (hex: string) => [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const values = [brightness(first), brightness(second)].sort((a, b) => a - b)
  return (values[1] + 0.05) / (values[0] + 0.05)
}

describe('whole-widget color palette', () => {
  it('colors panels, fields, borders and actions from the selected color', () => {
    const theme = backgroundAppearance('#95D5B2')
    expect(theme['--color-surface']).toBe('#95d5b2')
    expect(theme['--surface-rgb']).toBe('149, 213, 178')
    expect(theme['--color-raised']).not.toBe('#ffffff')
    expect(theme['--color-accent']).not.toBe('#245fc2')
    expect(theme['--color-accent-soft']).not.toBe('#e5edfb')
    expect(backgroundAppearance('#000000')['color-scheme']).toBe('dark')
    expect(backgroundAppearance('#ffffff')['color-scheme']).toBe('light')
  })

  it('keeps text and actions legible on all their surfaces, including hover and warning states', () => {
    for (const color of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#95d5b2', '#777777', '#707070', '#888888', '#ff00ff', '#ffff00', '#1b365d', DEFAULT_BACKGROUND_COLOR]) {
      const theme = backgroundAppearance(color)
      for (const surface of ['--color-surface', '--color-raised', '--color-accent-soft', '--color-border'] as const) {
        expect(contrast(theme['--color-text'], theme[surface]), `${color} text on ${surface}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme['--color-accent'], theme[surface]), `${color} accent on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const surface of ['--color-surface', '--color-raised', '--color-accent-soft', '--color-border'] as const) {
        expect(contrast(theme['--color-muted'], theme[surface]), `${color} secondary text on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const surface of ['--color-accent', '--color-accent-hover'] as const) {
        expect(contrast(theme['--color-on-accent'], theme[surface]), `${color} primary action`).toBeGreaterThanOrEqual(4.5)
      }
      for (const kind of ['danger', 'warning'] as const) {
        for (const surface of ['--color-surface', '--color-raised', `--color-${kind}-soft`] as const) {
          expect(contrast(theme[`--color-${kind}`], theme[surface]), `${color} ${kind} text`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('uses the default palette for an invalid stored color', () => {
    expect(backgroundAppearance('invalid')).toEqual(backgroundAppearance(DEFAULT_BACKGROUND_COLOR))
  })
})
