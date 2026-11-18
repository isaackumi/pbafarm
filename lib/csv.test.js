import { describe, expect, test } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  test('quotes commas, quotes and new lines; blanks for null', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [null, 'l1\nl2'], [1.5, undefined]])).toBe(
      'a,b\n"x,y","say ""hi"""\n,"l1\nl2"\n1.5,',
    )
  })
})
