import { describe, expect, test } from 'vitest'
import { AA_NORMAL, accessibleVariant, checkBrandAccent, contrastRatio, parseHex } from './contrast'

describe('brand colour contrast (CUSTOM-006)', () => {
  test('ratios follow WCAG 2.x', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
    expect(contrastRatio('nope', '#FFFFFF')).toBeNull()
    expect(parseHex('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
  })

  test('a pale accent fails AA and gets a darker variant that passes', () => {
    const c = checkBrandAccent('#7DD3FC')!
    expect(c.passes).toBe(false)
    expect(c.accessibleHex).not.toBe('#7DD3FC')
    expect(contrastRatio(c.accessibleHex, '#FFFFFF')!).toBeGreaterThanOrEqual(AA_NORMAL)
    // The variant stays close: it is not simply black.
    expect(c.accessibleHex).not.toBe('#000000')
  })

  test('an accent that already passes is kept as is', () => {
    const c = checkBrandAccent('#1E3A5F')!
    expect(c.passes).toBe(true)
    expect(c.accessibleHex.toUpperCase()).toBe('#1E3A5F')
    expect(accessibleVariant('#1E3A5F')!.toUpperCase()).toBe('#1E3A5F')
    expect(checkBrandAccent('zz')).toBeNull()
  })
})
