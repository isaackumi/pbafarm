/**
 * Brand colour contrast (CUSTOM-006, WCAG 2.x). No imports, so the browser
 * (company settings, CompanySettingsContext) and tests share it.
 *
 * The accent is painted behind white text (primary buttons, sidebar header)
 * and used as link/text colour on white surfaces, so the check that matters is
 * white against the accent: 4.5:1 for normal text (AA).
 */

export const AA_NORMAL = 4.5
export const AA_LARGE = 3
export const WHITE = '#FFFFFF'
/** Dark-theme card surface (styles/theme.css --surface). */
export const DARK_SURFACE = '#1C1C22'

export type Rgb = { r: number; g: number; b: number }

/** '#abc' | '#aabbcc' (with or without #) → rgb, or null. */
export function parseHex(hex: unknown): Rgb | null {
  if (typeof hex !== 'string') return null
  let raw = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(raw)) raw = raw.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(raw)) return null
  const n = parseInt(raw, 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

function channel(v: number) {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** Contrast ratio between two colours, 1 … 21; null when either is not a hex colour. */
export function contrastRatio(a: string, b: string): number | null {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return null
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

function mix(rgb: Rgb, toward: Rgb, t: number): Rgb {
  return {
    r: rgb.r + (toward.r - rgb.r) * t,
    g: rgb.g + (toward.g - rgb.g) * t,
    b: rgb.b + (toward.b - rgb.b) * t,
  }
}

/**
 * The closest colour to `hex` (same hue, mixed toward black or white) that
 * reaches `min` against `against`. Returns `hex` unchanged when it already
 * passes, and null when it is not a colour.
 */
export function accessibleVariant(hex: string, against: string = WHITE, min: number = AA_NORMAL): string | null {
  const rgb = parseHex(hex)
  const bg = parseHex(against)
  if (!rgb || !bg) return null
  const ratio = contrastRatio(hex, against)!
  if (ratio >= min) return toHex(rgb)
  // Move away from the background: darker on light backgrounds, lighter on dark.
  const target = luminance(bg) > 0.18 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (contrastRatio(toHex(mix(rgb, target, mid)), against)! >= min) hi = mid
    else lo = mid
  }
  let out = toHex(mix(rgb, target, hi))
  // Rounding to whole channels can land a hair under the threshold.
  for (let step = hi; contrastRatio(out, against)! < min && step < 1; ) {
    step = Math.min(1, step + 0.01)
    out = toHex(mix(rgb, target, step))
  }
  return out
}

export type ContrastCheck = {
  /** White text on the accent (buttons, header). */
  onWhiteText: number
  passes: boolean
  /** Large text / icons pass (3:1) even if normal text does not. */
  passesLarge: boolean
  /** The accent to use: the original when it passes, else the adjusted one. */
  accessibleHex: string
  /** Accent used as text on the dark-theme surface (only matters in dark mode). */
  onDarkSurface: number
}

/** Contrast report for a brand accent; null when the value is not a hex colour. */
export function checkBrandAccent(hex: string): ContrastCheck | null {
  const onWhiteText = contrastRatio(hex, WHITE)
  if (onWhiteText == null) return null
  return {
    onWhiteText: Math.round(onWhiteText * 100) / 100,
    passes: onWhiteText >= AA_NORMAL,
    passesLarge: onWhiteText >= AA_LARGE,
    accessibleHex: accessibleVariant(hex, WHITE, AA_NORMAL)!,
    onDarkSurface: Math.round(contrastRatio(hex, DARK_SURFACE)! * 100) / 100,
  }
}
