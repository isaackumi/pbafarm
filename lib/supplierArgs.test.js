import { describe, expect, it } from 'vitest'
import { supplierCreateArgs, supplierUpdateArgs } from './supplierArgs'

describe('supplier args', () => {
  it('joins contact parts and drops empty values', () => {
    expect(
      supplierCreateArgs({ name: 'Raanan', website: '', phone: '024', email: 'a@b.c' }),
    ).toEqual({ name: 'Raanan', contactInfo: '024 | a@b.c' })
  })

  it('prefers explicit contact info and wraps updates in a patch', () => {
    expect(supplierUpdateArgs('s1', { name: 'X', contact_info: 'call', phone: '1' })).toEqual({
      id: 's1',
      patch: { name: 'X', contactInfo: 'call' },
    })
  })
})
