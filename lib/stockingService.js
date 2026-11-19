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

/** Arguments for api.stocking.updateStocking from snake_case form fields. */
export function stockingPatchArgs(stockingId, stockingData) {
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
  return { id: stockingId, patch }
}

const stockingService = {
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
          species: stockingData.species,
          custom: stockingData.custom,
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
}

export { stockingService }
export default stockingService
