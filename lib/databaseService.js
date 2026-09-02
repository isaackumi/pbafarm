// lib/databaseService.js (Updated to use Convex)
import { getConvexHttpClient, api } from './convexBridge'

// Re-export cageService from cageService.js
export { cageService } from './cageService'

// Prefer the dedicated stockingService module (correct Convex API names)
export { stockingService } from './stockingService'

function omitNulls(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  }
  return out
}

// Daily records service
export const dailyRecordService = {
  getDailyRecords: async (cageId) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.dailyRecords.list, { cageId })
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  createDailyRecord: async (recordData) => {
    try {
      const client = getConvexHttpClient()
      const feedAmount = Number(
        recordData.feed_amount ?? recordData.feedAmount ?? 0,
      )
      const feedPrice = Number(
        recordData.feed_price ?? recordData.feedPrice ?? 0,
      )
      const args = omitNulls({
        cageId: recordData.cage_id || recordData.cageId,
        date: recordData.date,
        feedAmount,
        feedTypeId: recordData.feed_type_id || recordData.feedTypeId,
        feedType: recordData.feed_type || recordData.feedType,
        feedPrice,
        feedCost: Number(
          recordData.feed_cost ?? recordData.feedCost ?? feedAmount * feedPrice,
        ),
        mortality: Number(
          recordData.mortality ??
            recordData.mortality_count ??
            recordData.mortalityCount ??
            0,
        ),
        notes: recordData.notes,
      })
      const id = await client.mutation(api.dailyRecords.create, args)
      const data = await client.query(api.dailyRecords.get, { id })
      return { data: [data], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  getAllDailyRecords: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.dailyRecords.list, {})
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  getDailyRecord: async (id) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.dailyRecords.get, { id })
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  updateDailyRecord: async (id, updates) => {
    try {
      const client = getConvexHttpClient()
      const patch = omitNulls({
        date: updates.date,
        feedAmount:
          updates.feed_amount != null || updates.feedAmount != null
            ? Number(updates.feed_amount ?? updates.feedAmount)
            : undefined,
        feedTypeId: updates.feed_type_id || updates.feedTypeId,
        feedType: updates.feed_type || updates.feedType,
        feedPrice:
          updates.feed_price != null || updates.feedPrice != null
            ? Number(updates.feed_price ?? updates.feedPrice)
            : undefined,
        feedCost:
          updates.feed_cost != null || updates.feedCost != null
            ? Number(updates.feed_cost ?? updates.feedCost)
            : undefined,
        mortality:
          updates.mortality != null ||
          updates.mortality_count != null ||
          updates.mortalityCount != null
            ? Number(
                updates.mortality ??
                  updates.mortality_count ??
                  updates.mortalityCount,
              )
            : undefined,
        notes: updates.notes,
      })
      await client.mutation(api.dailyRecords.update, { id, patch })
      const data = await client.query(api.dailyRecords.get, { id })
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  deleteDailyRecord: async (id) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.dailyRecords.remove, { id })
      return { error: null }
    } catch (error) {
      return { error }
    }
  },

  createMany: async (records) => {
    try {
      const client = getConvexHttpClient()
      const mapped = (records || []).map((r) => {
        const feedAmount = Number(r.feed_amount ?? r.feedAmount ?? 0)
        const feedPrice = Number(r.feed_price ?? r.feedPrice ?? 0)
        return omitNulls({
          cageId: r.cage_id || r.cageId,
          date: r.date,
          feedAmount,
          feedTypeId: r.feed_type_id || r.feedTypeId,
          feedType: r.feed_type || r.feedType,
          feedPrice,
          feedCost: Number(r.feed_cost ?? r.feedCost ?? feedAmount * feedPrice),
          mortality: Number(r.mortality ?? r.mortality_count ?? 0),
          notes: r.notes,
        })
      })
      const ids = await client.mutation(api.dailyRecords.createMany, {
        records: mapped,
      })
      return { data: ids, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },
}

// Biweekly records service
export const biweeklyRecordService = {
  getBiweeklyRecords: async (cageId) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.biweeklyRecords.list, { cageId })
      return { data: data || [], error: null }
    } catch (error) {
      console.error('Error fetching biweekly records:', error)
      return { data: [], error }
    }
  },

  getAllBiweeklyRecords: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.biweeklyRecords.list, {})
      return { data: data || [], error: null }
    } catch (error) {
      console.error('Error fetching all biweekly records:', error)
      return { data: [], error }
    }
  },

  createBiweeklyRecord: async (recordData) => {
    try {
      const client = getConvexHttpClient()
      const samples = (recordData.samples || []).map((s, i) => ({
        samplingNumber: Number(s.sampling_number ?? s.samplingNumber ?? i + 1),
        fishCount: Number(s.fish_count ?? s.fishCount ?? 0),
        totalWeight: Number(s.total_weight ?? s.totalWeight ?? 0),
        averageBodyWeight: Number(
          s.average_body_weight ?? s.averageBodyWeight ?? s.abw ?? 0,
        ),
      }))
      const args = omitNulls({
        cageId: recordData.cage_id || recordData.cageId,
        date: recordData.date,
        batchCode: recordData.batch_code || recordData.batchCode,
        averageBodyWeight: Number(
          recordData.average_body_weight ??
            recordData.averageBodyWeight ??
            recordData.average_weight ??
            0,
        ),
        totalFishCount: Number(
          recordData.total_fish_count ?? recordData.totalFishCount ?? 0,
        ),
        totalWeight: Number(
          recordData.total_weight ?? recordData.totalWeight ?? 0,
        ),
        samples: samples.length ? samples : undefined,
      })
      const id = await client.mutation(api.biweeklyRecords.create, args)
      const data = await client.query(api.biweeklyRecords.get, { id })
      return { data, error: null }
    } catch (error) {
      console.error('Error creating biweekly record:', error)
      return { data: null, error }
    }
  },

  updateBiweeklyRecord: async (recordId, updates) => {
    try {
      const client = getConvexHttpClient()
      const patch = omitNulls({
        date: updates.date,
        batchCode: updates.batch_code || updates.batchCode,
        averageBodyWeight:
          updates.average_body_weight != null ||
          updates.averageBodyWeight != null
            ? Number(updates.average_body_weight ?? updates.averageBodyWeight)
            : undefined,
        totalFishCount:
          updates.total_fish_count != null || updates.totalFishCount != null
            ? Number(updates.total_fish_count ?? updates.totalFishCount)
            : undefined,
        totalWeight:
          updates.total_weight != null || updates.totalWeight != null
            ? Number(updates.total_weight ?? updates.totalWeight)
            : undefined,
      })
      await client.mutation(api.biweeklyRecords.update, {
        id: recordId,
        patch,
      })
      const data = await client.query(api.biweeklyRecords.get, { id: recordId })
      return { data, error: null }
    } catch (error) {
      console.error('Error updating biweekly record:', error)
      return { data: null, error }
    }
  },

  deleteBiweeklyRecord: async (recordId) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.biweeklyRecords.remove, { id: recordId })
      return { error: null }
    } catch (error) {
      console.error('Error deleting biweekly record:', error)
      return { error }
    }
  },

  /** Samples are created with the parent record — no separate Convex API. */
  createBiweeklySampling: async () => {
    return {
      data: null,
      error: new Error(
        'Sampling is saved with the biweekly record. Pass samples in createBiweeklyRecord.',
      ),
    }
  },

  getBiweeklySampling: async () => ({ data: [], error: null }),
  updateBiweeklySampling: async () => ({ data: null, error: null }),
  deleteBiweeklySampling: async () => ({ error: null }),

  getBiweeklyRecordsPaginated: async (page = 1, pageSize = 20) => {
    try {
      const client = getConvexHttpClient()
      const all = (await client.query(api.biweeklyRecords.list, {})) || []
      const totalCount = all.length
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
      const start = (page - 1) * pageSize
      return {
        data: all.slice(start, start + pageSize),
        error: null,
        totalCount,
        totalPages,
        currentPage: page,
      }
    } catch (error) {
      console.error('Error fetching paginated biweekly records:', error)
      return { data: [], error, totalCount: 0, totalPages: 0, currentPage: page }
    }
  },
}

// Harvest records service
export const harvestRecordService = {
  // Get harvest record for a cage
  getHarvestRecord: async (cageId) => {
    try {
      const client = getConvexHttpClient()
      const all = await client.query(api.harvest.list, {}); const data = (all||[]).filter(h => h.cage_id===cageId||h.cageId===cageId)
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Get all harvest records with cage information
  getAllHarvestRecords: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.harvest.list, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  // Export harvest records
  exportHarvestRecords: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.harvest.list, {})
      
      // Transform data to include cage name for CSV export
      const transformedData = data.map(record => ({
        ...record,
        cage_name: record.cage?.name || 'Unknown Cage',
        cage_code: record.cage?.code || 'Unknown'
      }))

      return { data: transformedData, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  async createHarvestRecord(recordData) {
    try {
      const client = getConvexHttpClient()
      const patch = {}
      
      // Map snake_case to camelCase
      const fieldMap = {
        cage_id: 'cageId',
        harvest_date: 'harvestDate',
        harvest_type: 'harvestType',
        total_weight: 'totalWeight',
        average_body_weight: 'averageBodyWeight',
        estimated_count: 'estimatedCount',
        fcr: 'fcr',
        size_breakdown: 'sizeBreakdown',
        notes: 'notes'
      }

      for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
        if (recordData[snakeKey] !== undefined) {
          patch[camelKey] = recordData[snakeKey]
        }
        if (recordData[camelKey] !== undefined) {
          patch[camelKey] = recordData[camelKey]
        }
      }

      // Convert numeric fields
      if (patch.totalWeight) patch.totalWeight = parseFloat(patch.totalWeight)
      if (patch.averageBodyWeight) patch.averageBodyWeight = parseFloat(patch.averageBodyWeight)
      if (patch.estimatedCount) patch.estimatedCount = parseInt(patch.estimatedCount, 10)
      if (patch.fcr) patch.fcr = parseFloat(patch.fcr)

      const id = await client.mutation(api.harvest.create, patch)
      const data = await client.query(api.harvest.get, { id })
      return { data, error: null }
    } catch (error) {
      console.error('Error creating harvest record:', error)
      return { data: null, error }
    }
  },

  async getHarvestRecords() {
    return this.getAllHarvestRecords()
  },

  async getHarvestRecord(id) {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.harvest.get, { id })
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching harvest record:', error)
      return { data: null, error }
    }
  },

  async updateHarvestRecord(id, updates) {
    try {
      const client = getConvexHttpClient()
      const patch = {}
      
      // Map snake_case to camelCase
      const fieldMap = {
        cage_id: 'cageId',
        harvest_date: 'harvestDate',
        harvest_type: 'harvestType',
        total_weight: 'totalWeight',
        average_body_weight: 'averageBodyWeight',
        estimated_count: 'estimatedCount',
        fcr: 'fcr',
        size_breakdown: 'sizeBreakdown',
        notes: 'notes'
      }

      for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
        if (updates[snakeKey] !== undefined) {
          patch[camelKey] = updates[snakeKey]
        }
        if (updates[camelKey] !== undefined) {
          patch[camelKey] = updates[camelKey]
        }
      }

      await client.mutation(api.harvest.update, { id, patch })
      const data = await client.query(api.harvest.get, { id })
      return { data, error: null }
    } catch (error) {
      console.error('Error updating harvest record:', error)
      return { data: null, error }
    }
  },

  async deleteHarvestRecord(id) {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.harvest.remove, { id })
      return { error: null }
    } catch (error) {
      console.error('Error deleting harvest record:', error)
      return { error }
    }
  },

  async exportHarvestRecords() {
    try {
      const { data, error } = await this.getAllHarvestRecords()
      if (error) throw error

      const csvData = data.map(record => ({
        'Cage Name': record.cage?.name || 'Unknown',
        'Cage Code': record.cage?.code || 'Unknown',
        'Harvest Date': new Date(record.harvestDate).toLocaleDateString(),
        'Harvest Type': record.harvestType,
        'Status': record.status,
        'Total Weight (kg)': record.totalWeight,
        'Average Body Weight (g)': record.averageBodyWeight,
        'Estimated Count': record.estimatedCount,
        'FCR': record.fcr,
        'Size Breakdown': JSON.stringify(record.sizeBreakdown),
        'Notes': record.notes
      }))

      return { data: csvData, error: null }
    } catch (error) {
      console.error('Error exporting harvest records:', error)
      return { data: null, error }
    }
  }
}

// Feed suppliers service
export const supplierService = {
  // Get all suppliers
  getAllSuppliers: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listSuppliers, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  // Create a new supplier
  createSupplier: async (supplierData) => {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(api.feed.createSupplier, supplierData)
      const all = await client.query(api.feed.listSuppliers, {}); const data = (all||[]).find(s => s.id===id||s._id===id)
      return { data: [data], error: null }
    } catch (error) {
      return { data: null, error }
    }
  },
};

// Feed types service
export const feedTypeService = {
  // Get all feed types with supplier info
  getAllFeedTypes: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listFeedTypes, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  // Create a new feed type
  createFeedType: async (feedTypeData) => {
    try {
      const client = getConvexHttpClient()
      const patch = {}
      
      // Map snake_case to camelCase
      const fieldMap = {
        name: 'name',
        supplier_id: 'supplierId',
        protein_content: 'proteinContent',
        fat_content: 'fatContent',
        pellet_size: 'pelletSize',
        price_per_kg: 'pricePerKg'
      }

      for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
        if (feedTypeData[snakeKey] !== undefined) {
          patch[camelKey] = feedTypeData[snakeKey]
        }
        if (feedTypeData[camelKey] !== undefined) {
          patch[camelKey] = feedTypeData[camelKey]
        }
      }

      const id = await client.mutation(api.feed.createFeedType, patch)
      const all = await client.query(api.feed.listFeedTypes, {}); const data = (all||[]).find(t => t.id===id||t._id===id)
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },
};

// Analytics service
export const analyticsService = {
  /**
   * Get cage summary statistics
   */
  getCageSummaryStats: async () => {
    try {
      const client = getConvexHttpClient()
      const cages = await client.query(api.cages.list, {})

      const stats = {
        totalCages: cages.length,
        activeCages: cages.filter(cage => cage.status === 'active').length,
        harvestedCages: cages.filter(cage => cage.status === 'harvested').length,
        maintenanceCages: cages.filter(cage => cage.status === 'maintenance').length,
        fallowCages: cages.filter(cage => cage.status === 'fallow').length,
        emptyCages: cages.filter(cage => cage.status === 'empty').length,
      }

      return { data: stats, error: null }
    } catch (error) {
      console.error('Error fetching cage statistics:', error)
      return { data: null, error }
    }
  },

  /**
   * Get harvest readiness analytics
   */
  getHarvestReadiness: async () => {
    try {
      const client = getConvexHttpClient()
      const cages = await client.query(api.cages.list, {})

      const harvestData = cages.reduce((acc, cage) => {
        if (!cage.stockingDate) return acc
        
        const stockingDate = new Date(cage.stockingDate)
        const today = new Date()
        const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
        
        if (doc >= 100) {
          acc.ready++
        } else if (doc >= 80) {
          acc.soon++
        } else {
          acc.growing++
        }
        return acc
      }, { ready: 0, soon: 0, growing: 0 })

      return { data: harvestData, error: null }
    } catch (error) {
      console.error('Error fetching harvest readiness:', error)
      return { data: null, error }
    }
  },

  /**
   * Get status distribution analytics
   */
  getStatusDistribution: async () => {
    try {
      const client = getConvexHttpClient()
      const cages = await client.query(api.cages.list, {})

      const statusCount = cages.reduce((acc, cage) => {
        acc[cage.status] = (acc[cage.status] || 0) + 1
        return acc
      }, {})

      const distribution = Object.entries(statusCount).map(([status, count]) => ({
        name: status.charAt(0).toUpperCase() + status.slice(1),
        value: count,
      }))

      return { data: distribution, error: null }
    } catch (error) {
      console.error('Error fetching status distribution:', error)
      return { data: null, error }
    }
  },

  /**
   * Get growth trends analytics
   */
  getGrowthTrends: async () => {
    try {
      const client = getConvexHttpClient()
      const cages = await client.query(api.cages.getActive, {})

      const growthData = cages
        .filter(cage => cage.stockingDate)
        .map(cage => {
          const stockingDate = new Date(cage.stockingDate)
          const today = new Date()
          const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
          return {
            cageId: cage._id,
            cageName: cage.name,
            doc,
            initialWeight: cage.initialWeight,
            currentWeight: cage.currentWeight,
            growthRate: cage.growthRate,
          }
        })

      return { data: growthData, error: null }
    } catch (error) {
      console.error('Error fetching growth trends:', error)
      return { data: null, error }
    }
  }
}
