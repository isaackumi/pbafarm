import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveTransferType,
  transferBiomassKg,
  classifyDestination,
  sourceCagePatchAfterTransfer,
} from './fishTransferLogic.ts'

describe('deriveTransferType', () => {
  it('is full when qty equals source count', () => {
    assert.equal(deriveTransferType(1000, 1000), 'full')
  })
  it('is partial when qty is less', () => {
    assert.equal(deriveTransferType(400, 1000), 'partial')
  })
})

describe('transferBiomassKg', () => {
  it('matches top-up formula', () => {
    assert.equal(transferBiomassKg(1000, 50), 50)
  })
})

describe('classifyDestination', () => {
  const empty = ['empty', 'fallow', 'harvested']
  it('stocks empty-eligible statuses', () => {
    assert.equal(classifyDestination('empty', empty), 'stock')
    assert.equal(classifyDestination('fallow', empty), 'stock')
  })
  it('topups active', () => {
    assert.equal(classifyDestination('active', empty), 'topup')
  })
  it('rejects maintenance', () => {
    assert.equal(classifyDestination('maintenance', empty), 'invalid')
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
    assert.equal(patch.currentCount, 0)
    assert.equal(patch.status, 'empty')
  })
  it('reduces on partial', () => {
    const patch = sourceCagePatchAfterTransfer({
      transferType: 'partial',
      quantity: 400,
      sourceCurrentCount: 1000,
      now: 1,
    })
    assert.equal(patch.currentCount, 600)
    assert.equal(patch.status, 'active')
  })
})
