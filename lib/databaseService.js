// lib/databaseService.js (Updated to use Convex)
import { getConvexHttpClient, api } from './convexBridge'
import { withActiveLocation } from './locationScope'

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
      const data = await client.query(api.dailyRecords.list, withActiveLocation({ cageId }))
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
        mortalityCause:
          recordData.mortality_cause ||
          recordData.mortalityCause ||
          undefined,
        notes: recordData.notes,
        dissolvedOxygen:
          recordData.dissolved_oxygen != null ||
          recordData.dissolvedOxygen != null
            ? Number(
                recordData.dissolved_oxygen ?? recordData.dissolvedOxygen,
              )
            : undefined,
        temperatureC:
          recordData.temperature_c != null || recordData.temperatureC != null
            ? Number(recordData.temperature_c ?? recordData.temperatureC)
            : undefined,
        secchiCm:
          recordData.secchi_cm != null || recordData.secchiCm != null
            ? Number(recordData.secchi_cm ?? recordData.secchiCm)
            : undefined,
        allowNegative: recordData.allowNegative,
        overrideReason: recordData.overrideReason || recordData.override_reason,
      })
      // allowNegative is boolean — omitNulls drops false; keep true explicitly
      if (recordData.allowNegative === true) args.allowNegative = true
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
      const data = await client.query(api.dailyRecords.list, withActiveLocation())
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

  /** Records in a date range: { dateFrom, dateTo, cageId? } (YYYY-MM-DD). */
  listRecords: async ({ dateFrom, dateTo, cageId } = {}) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(
        api.dailyRecords.list,
        withActiveLocation(omitNulls({ dateFrom, dateTo, cageId })),
      )
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  /** Send a camelCase patch as-is (empty strings allowed, e.g. to clear notes). */
  editDailyRecord: async (id, patch, { allowNegative, overrideReason } = {}) => {
    try {
      const client = getConvexHttpClient()
      const result = await client.mutation(api.dailyRecords.update, {
        id,
        patch,
        ...(allowNegative ? { allowNegative: true, overrideReason } : {}),
      })
      return { warnings: result?.warnings || [], error: null }
    } catch (error) {
      return { error }
    }
  },

  deleteDailyRecord: async (id) => {
    try {
      const client = getConvexHttpClient()
      const result = await client.mutation(api.dailyRecords.remove, { id })
      return { warnings: result?.warnings || [], error: null }
    } catch (error) {
      return { error }
    }
  },

  /** What's already logged on a date: [{ cage_id, feed_type_id, feed_amount, mortality }] */
  listForDate: async (date) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.dailyRecords.listForDate, { date })
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  /** Save several cages for one date atomically (all lines or none). */
  createBatch: async ({ date, records, allowNegative, overrideReason, clientMutationId }) => {
    try {
      const client = getConvexHttpClient()
      const ids = await client.mutation(api.dailyRecords.createBatch, {
        date,
        records: (records || []).map((r) => omitNulls(r)),
        ...(allowNegative ? { allowNegative: true } : {}),
        ...(overrideReason ? { overrideReason } : {}),
        ...(clientMutationId ? { clientMutationId } : {}),
      })
      return { data: ids, error: null }
    } catch (error) {
      return { data: null, error }
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
        dissolvedOxygen:
          recordData.dissolved_oxygen != null ||
          recordData.dissolvedOxygen != null
            ? Number(
                recordData.dissolved_oxygen ?? recordData.dissolvedOxygen,
              )
            : undefined,
        temperatureC:
          recordData.temperature_c != null || recordData.temperatureC != null
            ? Number(recordData.temperature_c ?? recordData.temperatureC)
            : undefined,
        secchiCm:
          recordData.secchi_cm != null || recordData.secchiCm != null
            ? Number(recordData.secchi_cm ?? recordData.secchiCm)
            : undefined,
        samples: samples.length ? samples : undefined,
        custom: recordData.custom,
      })
      const id = await client.mutation(api.biweeklyRecords.create, args)
      const data = await client.query(api.biweeklyRecords.get, { id })
      return { data, error: null }
    } catch (error) {
      console.error('Error creating biweekly record:', error)
      return { data: null, error }
    }
  },

  /** Sampling for several cages on one date, saved atomically (MOBILE-005). */
  createBatch: async ({ date, records, clientMutationId }) => {
    try {
      const client = getConvexHttpClient()
      const ids = await client.mutation(api.biweeklyRecords.createBatch, {
        date,
        records: (records || []).map((r) => omitNulls(r)),
        ...(clientMutationId ? { clientMutationId } : {}),
      })
      return { data: ids, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },
}

// Harvest records service
export const harvestRecordService = {
  // Get harvest record for a cage
  getHarvestRecord: async (cageId) => {
    try {
      const client = getConvexHttpClient()
      const all = await client.query(api.harvest.list, withActiveLocation()); const data = (all||[]).filter(h => h.cage_id===cageId||h.cageId===cageId)
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // Get all harvest records with cage information
  getAllHarvestRecords: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.harvest.list, withActiveLocation())
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  // Export harvest records
  exportHarvestRecords: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.harvest.list, withActiveLocation())
      
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
        notes: 'notes',
        withdrawal_override_reason: 'withdrawalOverrideReason',
        custom: 'custom'
      }

      for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
        if (recordData[snakeKey] !== undefined) {
          patch[camelKey] = recordData[snakeKey]
        }
        if (recordData[camelKey] !== undefined) {
          patch[camelKey] = recordData[camelKey]
        }
      }

      if (recordData.status !== undefined) patch.status = recordData.status
      if (recordData.clientMutationId) patch.clientMutationId = recordData.clientMutationId

      // FCR is computed on the server (PROD-009); a typed one is only a fallback.
      if (patch.fcr === '' || patch.fcr == null || !Number.isFinite(Number(patch.fcr))) delete patch.fcr
      else patch.fcr = Number(patch.fcr)
      // Convex validators require real numbers — coerce and reject blanks.
      for (const key of ['totalWeight', 'averageBodyWeight', 'estimatedCount']) {
        const n = Number(patch[key])
        if (patch[key] === '' || patch[key] == null || !Number.isFinite(n)) {
          throw new Error(`Harvest ${key} must be a number`)
        }
        patch[key] = key === 'estimatedCount' ? Math.round(n) : n
      }
      if (!patch.notes) delete patch.notes

      // harvest.create returns { id, warnings }, not a bare id
      const result = await client.mutation(api.harvest.create, patch)
      const id = result?.id ?? result
      const data = await client.query(api.harvest.get, { id })
      return { data, warnings: result?.warnings || [], error: null }
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

      if (updates.status !== undefined) patch.status = updates.status
      delete patch.cageId // not editable through update
      for (const key of ['totalWeight', 'averageBodyWeight', 'estimatedCount', 'fcr']) {
        if (patch[key] === undefined) continue
        const n = Number(patch[key])
        if (patch[key] === '' || patch[key] == null || !Number.isFinite(n)) {
          delete patch[key]
        } else {
          patch[key] = n
        }
      }

      const result = await client.mutation(api.harvest.update, { id, patch })
      const data = await client.query(api.harvest.get, { id })
      return { data, warnings: result?.warnings || [], error: null }
    } catch (error) {
      console.error('Error updating harvest record:', error)
      return { data: null, error }
    }
  },

  async addSamplingData(samplingData) {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(api.harvest.createSampling, {
        harvestId: samplingData.harvest_id || samplingData.harvestId,
        crateSize: Number.isFinite(samplingData.crate_size)
          ? samplingData.crate_size
          : undefined,
        samples: samplingData.samples || [],
      })
      return { data: id, error: null }
    } catch (error) {
      console.error('Error adding sampling data:', error)
      return { data: null, error }
    }
  },

  async deleteHarvestRecord(id) {
    try {
      const client = getConvexHttpClient()
      const result = await client.mutation(api.harvest.remove, { id })
      return { warnings: result?.warnings || [], error: null }
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
        'Harvest Date': new Date(record.harvest_date).toLocaleDateString(),
        'Harvest Type': record.harvest_type,
        'Status': record.status,
        'Total Weight (kg)': record.total_weight,
        'Average Body Weight (g)': record.average_body_weight,
        'Estimated Count': record.estimated_count,
        'FCR': record.fcr,
        'Size Breakdown': JSON.stringify(record.size_breakdown),
        'Notes': record.notes
      }))

      return { data: csvData, error: null }
    } catch (error) {
      console.error('Error exporting harvest records:', error)
      return { data: null, error }
    }
  }
}

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
