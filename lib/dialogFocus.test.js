import { describe, expect, it } from 'vitest'
import { nextFocus } from './dialogFocus'

describe('nextFocus (dialog focus trap)', () => {
  const [a, b, c] = ['a', 'b', 'c']
  const items = [a, b, c]

  it('wraps Tab from the last control to the first', () => {
    expect(nextFocus(items, c, false)).toBe(a)
  })

  it('wraps Shift+Tab from the first control to the last', () => {
    expect(nextFocus(items, a, true)).toBe(c)
  })

  it('lets the browser move focus between inner controls', () => {
    expect(nextFocus(items, a, false)).toBeNull()
    expect(nextFocus(items, c, true)).toBeNull()
  })

  it('pulls focus back in when it escaped the dialog', () => {
    expect(nextFocus(items, 'outside', false)).toBe(a)
    expect(nextFocus(items, 'outside', true)).toBe(c)
  })

  it('does nothing when the dialog has no focusable controls', () => {
    expect(nextFocus([], a, false)).toBeNull()
  })
})
