import { getConvexHttpClient, api } from './convexBridge'
import { withActiveLocation, getActiveLocationId } from './locationScope'

const cageService = {
  getAllCages: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.cages.list, withActiveLocation())
      return { data, error: null, totalCount: data.length, totalPages: 1 }
    } catch (error) {
      console.error('Error fetching cages:', error)
      return { data: [], error, totalCount: 0, totalPages: 0 }
    }
  },

  getCageById: async (id) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.cages.get, { id })
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  getActiveCages: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.cages.getActive, withActiveLocation())
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  getCageByName: async (name) => {
    try {
      const { data } = await cageService.getAllCages()
      const found = (data || []).find(
        (c) => c.name?.toLowerCase() === name.trim().toLowerCase(),
      )
      return { data: found || null, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  createCage: async (cageData) => {
    try {
      const client = getConvexHttpClient()
      const args = {
        name: cageData.name,
        code: cageData.code || undefined,
        location: cageData.location || undefined,
        size:
          cageData.size != null && cageData.size !== ''
            ? Number(cageData.size)
            : undefined,
        capacity:
          cageData.capacity != null && cageData.capacity !== ''
            ? Number(cageData.capacity)
            : undefined,
        dimensions: cageData.dimensions || undefined,
        material: cageData.material || undefined,
        installationDate:
          cageData.installation_date || cageData.installationDate || undefined,
        stockingDate: cageData.stocking_date || cageData.stockingDate || undefined,
        initialCount:
          cageData.initial_count != null && cageData.initial_count !== ''
            ? Number(cageData.initial_count)
            : cageData.initialCount != null && cageData.initialCount !== ''
              ? Number(cageData.initialCount)
              : undefined,
        initialAbw:
          cageData.initial_abw != null && cageData.initial_abw !== ''
            ? Number(cageData.initial_abw)
            : cageData.initialAbw != null && cageData.initialAbw !== ''
              ? Number(cageData.initialAbw)
              : undefined,
        initialBiomass:
          cageData.initial_biomass != null && cageData.initial_biomass !== ''
            ? Number(cageData.initial_biomass)
            : cageData.initialBiomass != null && cageData.initialBiomass !== ''
              ? Number(cageData.initialBiomass)
              : undefined,
        status: cageData.status || undefined,
        notes: cageData.notes || undefined,
        locationId:
          cageData.locationId ||
          cageData.location_id ||
          getActiveLocationId() ||
          undefined,
      }
      // Convex optional fields reject null — drop null/undefined keys
      Object.keys(args).forEach((k) => {
        if (args[k] === null || args[k] === undefined || args[k] === '') delete args[k]
      })
      const id = await client.mutation(api.cages.create, args)
      const data = await client.query(api.cages.get, { id })
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  updateCage: async (cageId, cageData) => {
    try {
      const client = getConvexHttpClient()
      const patch = {}
      const stringFields = {
        name: 'name',
        location: 'location',
        dimensions: 'dimensions',
        material: 'material',
        installation_date: 'installationDate',
        stocking_date: 'stockingDate',
        last_maintenance_date: 'lastMaintenanceDate',
        next_maintenance_date: 'nextMaintenanceDate',
        status: 'status',
        notes: 'notes',
      }
      const numberFields = {
        size: 'size',
        capacity: 'capacity',
        initial_count: 'initialCount',
        current_count: 'currentCount',
        initial_abw: 'initialAbw',
        initial_biomass: 'initialBiomass',
        initial_weight: 'initialWeight',
        current_weight: 'currentWeight',
        growth_rate: 'growthRate',
        mortality_rate: 'mortalityRate',
      }

      const read = (snake, camel) => {
        if (cageData[snake] !== undefined) return cageData[snake]
        if (cageData[camel] !== undefined) return cageData[camel]
        return undefined
      }

      for (const [snake, camel] of Object.entries(stringFields)) {
        const value = read(snake, camel)
        if (value === undefined) continue
        if (value === null || value === '') continue
        patch[camel] = value
      }

      for (const [snake, camel] of Object.entries(numberFields)) {
        const value = read(snake, camel)
        if (value === undefined) continue
        if (value === null || value === '') continue
        const num = Number(value)
        if (Number.isNaN(num)) continue
        patch[camel] = num
      }

      await client.mutation(api.cages.update, { id: cageId, patch })
      const data = await client.query(api.cages.get, { id: cageId })
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  deleteCage: async (cageId) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.cages.remove, { id: cageId })
      return { error: null }
    } catch (error) {
      return { error }
    }
  },
}

export { cageService }
export default cageService
