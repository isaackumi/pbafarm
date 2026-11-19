import { beforeEach, describe, expect, test, vi } from 'vitest'

const client = { mutation: vi.fn(), query: vi.fn() }
vi.mock('./convexBridge', () => ({
  getConvexHttpClient: () => client,
  api: {
    dailyRecords: { update: 'dailyRecords.update', remove: 'dailyRecords.remove' },
    harvest: { update: 'harvest.update', remove: 'harvest.remove', get: 'harvest.get' },
  },
}))

const { dailyRecordService, harvestRecordService } = await import('./databaseService')

const REASON = "This record is from an earlier cycle, so the cage's current fish count was not changed"

// The pages show `warnings` as a toast (pages/daily-data.js, pages/harvest.js),
// so the service must hand back the mutation's reason (PROD-000a, PROD-000c).
describe('record-only edits hand their reason to the page', () => {
  beforeEach(() => {
    client.mutation.mockReset()
    client.query.mockReset()
  })

  test('daily record edit and delete', async () => {
    client.mutation.mockResolvedValue({ id: 'd1', warnings: [REASON] })
    expect(await dailyRecordService.editDailyRecord('d1', { mortality: 3 })).toEqual({ warnings: [REASON], error: null })
    expect(client.mutation).toHaveBeenCalledWith('dailyRecords.update', { id: 'd1', patch: { mortality: 3 } })

    client.mutation.mockResolvedValue({ warnings: [REASON] })
    expect(await dailyRecordService.deleteDailyRecord('d1')).toEqual({ warnings: [REASON], error: null })
  })

  test('harvest edit and delete', async () => {
    client.mutation.mockResolvedValue({ id: 'h1', warnings: ['The cage was restocked or harvested again'] })
    client.query.mockResolvedValue({ id: 'h1' })
    const edited = await harvestRecordService.updateHarvestRecord('h1', { estimated_count: '9500' })
    expect(client.mutation).toHaveBeenCalledWith('harvest.update', { id: 'h1', patch: { estimatedCount: 9500 } })
    expect(edited).toEqual({ data: { id: 'h1' }, warnings: ['The cage was restocked or harvested again'], error: null })

    client.mutation.mockResolvedValue({ warnings: ['The cage has been restocked since'] })
    expect(await harvestRecordService.deleteHarvestRecord('h1')).toEqual({
      warnings: ['The cage has been restocked since'],
      error: null,
    })
  })
})
