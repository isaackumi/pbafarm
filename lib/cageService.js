import { getConvexHttpClient, api } from './convexBridge'
import { withActiveLocation, getActiveLocationId } from './locationScope'

/** Arguments for api.cages.create from form fields (empty values dropped). */
export function cageCreateArgs(cageData, activeLocationId) {
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
    unitType: cageData.unitType || undefined,
    areaM2: cageData.areaM2,
    depthM: cageData.depthM,
    volumeM3: cageData.volumeM3,
    diameterM: cageData.diameterM,
    unitGroup: cageData.unitGroup || undefined,
    custom: cageData.custom,
    locationId:
      cageData.locationId ||
      cageData.location_id ||
      activeLocationId ||
      undefined,
  }
  // Convex optional fields reject null — drop null/undefined keys
  Object.keys(args).forEach((k) => {
    if (args[k] === null || args[k] === undefined || args[k] === '') delete args[k]
  })
  return args
}

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

  getActiveCages: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.cages.getActive, withActiveLocation())
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },
}

export { cageService }
export default cageService
