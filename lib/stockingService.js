import { getConvexHttpClient, api } from './convexBridge'
import { withActiveLocation } from './locationScope'

function omitNulls(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  }
  return out
}

async function withCageLookup(stockings) {
  const client = getConvexHttpClient()
  const cages = await client.query(api.cages.list, withActiveLocation())
  const byId = Object.fromEntries(
    (cages || []).map((c) => [c.id || c._id, c]),
  )
  return (stockings || []).map((s) => {
    const cageId = s.cage_id || s.cageId
    const cage = byId[cageId] || null
    return {
      ...s,
      id: s.id || s._id,
      cage,
      cage_name: cage?.name,
    }
  })
}

const stockingService = {
  getAllStockings: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(
        api.stocking.listStockingHistory,
        withActiveLocation(),
      )
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  /** Approved stockings on active cages — used by top-up form. */
  getActiveStockings: async () => {
    try {
      const client = getConvexHttpClient()
      const [stockings, cages] = await Promise.all([
        client.query(api.stocking.listStockingHistory, withActiveLocation({ status: 'approved' })),
        client.query(api.cages.list, withActiveLocation()),
      ])
      const byId = Object.fromEntries(
        (cages || []).map((c) => [c.id || c._id, c]),
      )
      const activeCageIds = new Set(
        (cages || [])
          .filter((c) => c.status === 'active')
          .map((c) => c.id || c._id),
      )
      const data = (stockings || [])
        .filter((s) => activeCageIds.has(s.cage_id || s.cageId))
        .map((s) => {
          const cage = byId[s.cage_id || s.cageId] || null
          return {
            ...s,
            id: s.id || s._id,
            cage,
            cage_name: cage?.name,
          }
        })
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  getStockingById: async (stockingId) => {
    try {
      const client = getConvexHttpClient()
      const [all, topups] = await Promise.all([
        client.query(api.stocking.listStockingHistory, withActiveLocation()),
        client.query(api.stocking.listTopupHistory, { stockingId }),
      ])
      const stocking = (all || []).find(
        (s) => s.id === stockingId || s._id === stockingId,
      )
      if (!stocking) {
        return { data: null, error: new Error('Stocking not found') }
      }
      const [enriched] = await withCageLookup([stocking])
      return {
        data: {
          ...enriched,
          topups: (topups || []).filter(
            (t) => t.status === 'approved' || t.status === 'pending_approval',
          ),
        },
        error: null,
      }
    } catch (error) {
      return { data: null, error }
    }
  },

  getStockingHistory: async (cageId) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.stocking.listStockingHistory, withActiveLocation({ cageId }))
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

  /** Alias used by TopUpForm */
  createTopUp: async (topupData) => stockingService.createTopup(topupData),

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
        await client.mutation(api.stocking.rejectTopup, {
          id: recordId,
          reason,
        })
      } else {
        await client.mutation(api.stocking.rejectStocking, {
          id: recordId,
          reason,
        })
      }
      return { error: null }
    } catch (error) {
      return { error }
    }
  },

  getPendingApprovals: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.stocking.listPendingApprovals, {})
      return {
        data: data || { stockings: [], topups: [], all: [] },
        error: null,
      }
    } catch (error) {
      return { data: { stockings: [], topups: [], all: [] }, error }
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
      const all = await client.query(api.stocking.listStockingHistory, withActiveLocation())
      const data = (all || []).find(
        (s) => s.id === stockingId || s._id === stockingId,
      )
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  deleteStocking: async (stockingId, reason) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.stocking.removeStocking, {
        id: stockingId,
        reason: reason || undefined,
      })
      return { error: null }
    } catch (error) {
      return { error }
    }
  },
}

export { stockingService }
export default stockingService
