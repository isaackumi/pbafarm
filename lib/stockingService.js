import { getConvexHttpClient, api } from './convexBridge'

function omitNulls(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  }
  return out
}

const stockingService = {
  getAllStockings: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.stocking.listStockingHistory, {})
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  getStockingHistory: async (cageId) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.stocking.listStockingHistory, { cageId })
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  createStocking: async (stockingData) => {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(
        api.stocking.createStocking,
        omitNulls({
          cageId: stockingData.cage_id || stockingData.cageId,
          batchNumber: stockingData.batch_number || stockingData.batchNumber,
          stockingDate: stockingData.stocking_date || stockingData.stockingDate,
          fishCount: Number(stockingData.fish_count ?? stockingData.fishCount),
          initialAbw: Number(stockingData.initial_abw ?? stockingData.initialAbw),
          initialBiomass: Number(
            stockingData.initial_biomass ??
              stockingData.initialBiomass ??
              ((stockingData.fish_count || stockingData.fishCount) *
                (stockingData.initial_abw || stockingData.initialAbw)) /
                1000,
          ),
          sourceLocation: stockingData.source_location || stockingData.sourceLocation,
          sourceCage: stockingData.source_cage || stockingData.sourceCage,
          transferSupervisor:
            stockingData.transfer_supervisor || stockingData.transferSupervisor,
          samplingSupervisor:
            stockingData.sampling_supervisor || stockingData.samplingSupervisor,
          notes: stockingData.notes,
        }),
      )
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  createTopup: async (topupData) => {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(
        api.stocking.createTopup,
        omitNulls({
          stockingId: topupData.stocking_id || topupData.stockingId,
          topupDate: topupData.topup_date || topupData.topupDate,
          fishCount: Number(topupData.fish_count ?? topupData.fishCount),
          abw: Number(topupData.abw),
          sourceLocation: topupData.source_location || topupData.sourceLocation,
          transferSupervisor:
            topupData.transfer_supervisor || topupData.transferSupervisor,
          notes: topupData.notes,
        }),
      )
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  approveRecord: async (recordId, type = 'stocking') => {
    try {
      const client = getConvexHttpClient()
      if (type === 'topup') {
        await client.mutation(api.stocking.approveTopup, { id: recordId })
      } else {
        await client.mutation(api.stocking.approveStocking, { id: recordId })
      }
      return { error: null }
    } catch (error) {
      return { error }
    }
  },

  rejectRecord: async (recordId, reason, type = 'stocking') => {
    try {
      const client = getConvexHttpClient()
      if (type === 'topup') {
        await client.mutation(api.stocking.rejectTopup, { id: recordId, notes: reason })
      } else {
        await client.mutation(api.stocking.rejectStocking, { id: recordId, notes: reason })
      }
      return { error: null }
    } catch (error) {
      return { error }
    }
  },

  getPendingApprovals: async () => {
    try {
      const client = getConvexHttpClient()
      const stockings = await client.query(api.stocking.listStockingHistory, {
        status: 'pending_approval',
      })
      const topups = await client.query(api.stocking.listTopupHistory, {
        status: 'pending_approval',
      })
      return {
        data: { stockings: stockings || [], topups: topups || [] },
        error: null,
      }
    } catch (error) {
      return { data: { stockings: [], topups: [] }, error }
    }
  },

  listTopups: async (stockingId) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.stocking.listTopupHistory, { stockingId })
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  updateStocking: async (stockingId, stockingData) => {
    try {
      const client = getConvexHttpClient()
      const patch = omitNulls({
        stockingDate: stockingData.stocking_date || stockingData.stockingDate,
        fishCount:
          stockingData.fish_count != null || stockingData.fishCount != null
            ? Number(stockingData.fish_count ?? stockingData.fishCount)
            : undefined,
        initialAbw:
          stockingData.initial_abw != null || stockingData.initialAbw != null
            ? Number(stockingData.initial_abw ?? stockingData.initialAbw)
            : undefined,
        initialBiomass:
          stockingData.initial_biomass != null ||
          stockingData.initialBiomass != null
            ? Number(stockingData.initial_biomass ?? stockingData.initialBiomass)
            : undefined,
        sourceLocation:
          stockingData.source_location || stockingData.sourceLocation,
        notes: stockingData.notes,
      })
      await client.mutation(api.stocking.updateStocking, {
        id: stockingId,
        patch,
      })
      const all = await client.query(api.stocking.listStockingHistory, {})
      const data = (all || []).find(
        (s) => s.id === stockingId || s._id === stockingId,
      )
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },
}

export { stockingService }
export default stockingService
