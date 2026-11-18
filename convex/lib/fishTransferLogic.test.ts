import { describe, expect, it } from 'vitest'
import {
  deriveTransferType,
  transferBiomassKg,
  classifyDestination,
  sourceCagePatchAfterTransfer,
} from './fishTransferLogic'

describe('deriveTransferType', () => {
  it('is full when qty equals source count', () => {
    expect(deriveTransferType(1000, 1000)).toBe('full')
  })
  it('is partial when qty is less', () => {
    expect(deriveTransferType(400, 1000)).toBe('partial')
  })
})

describe('transferBiomassKg', () => {
  it('matches top-up formula', () => {
    expect(transferBiomassKg(1000, 50)).toBe(50)
  })
})

describe('classifyDestination', () => {
  const empty = ['empty', 'fallow', 'harvested']
  it('stocks empty-eligible statuses', () => {
    expect(classifyDestination('empty', empty)).toBe('stock')
    expect(classifyDestination('fallow', empty)).toBe('stock')
  })
  it('topups active', () => {
    expect(classifyDestination('active', empty)).toBe('topup')
  })
  it('rejects maintenance', () => {
    expect(classifyDestination('maintenance', empty)).toBe('invalid')
  })
})

describe('sourceCagePatchAfterTransfer', () => {
  it('empties on full', () => {
    const patch = sourceCagePatchAfterTransfer({
      transferType: 'full',
      quantity: 1000,
      sourceCurrentCount: 1000,
      now: 1,
    })
    expect(patch.currentCount).toBe(0)
    expect(patch.status).toBe('empty')
  })
  it('reduces on partial', () => {
    const patch = sourceCagePatchAfterTransfer({
      transferType: 'partial',
      quantity: 400,
      sourceCurrentCount: 1000,
      now: 1,
    })
    expect(patch.currentCount).toBe(600)
    expect(patch.status).toBe('active')
  })
})
