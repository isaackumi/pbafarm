import { describe, expect, it } from 'vitest'
import { createIdbKv } from './idbKv'

describe('idbKv without IndexedDB', () => {
  it('resolves quietly instead of throwing', async () => {
    const kv = createIdbKv(null)
    expect(await kv.get('k')).toBeNull()
    expect(await kv.set('k', [1])).toBe(false)
    expect(await kv.del('k')).toBe(true)
  })

  it('survives a factory that throws on open', async () => {
    const kv = createIdbKv({
      open() {
        throw new Error('blocked')
      },
    })
    expect(await kv.get('k')).toBeNull()
  })
})
