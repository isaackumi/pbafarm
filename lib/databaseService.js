// lib/databaseService.js (Updated to handle separate cage and stocking concerns)
import { supabase } from './supabase'

// Cage service - for cage physical information
export const cageService = {
  // Ensure tables exist first (will be called before operations)
  ensureTablesExist: async () => {
    try {
      await supabase.rpc('create_cage_tables_if_not_exist')
      return { success: true }
    } catch (error) {
      console.error('Error creating tables:', error)
      return { error }
    }
  },

  // Get all cages
  getAllCages: async () => {
    try {
      const { data, error } = await supabase
        .from('cages')
        .select('*')
        .order('name')

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching cages:', error)
      return { data: null, error }
    }
  },

  // Get a specific cage by ID
  getCageById: async (id) => {
    try {
      const { data, error } = await supabase
        .from('cages')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching cage by ID:', error)
      return { data: null, error }
    }
  },

  // Create a new cage
  createCage: async (cageData) => {
    try {
      const { data, error } = await supabase
        .from('cages')
        .insert([cageData])
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error creating cage:', error)
      return { data: null, error }
    }
  },

  // Update cage information
  updateCage: async (cageId, cageData) => {
    try {
      const { data, error } = await supabase
        .from('cages')
        .update(cageData)
        .eq('id', cageId)
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error updating cage:', error)
      return { data: null, error }
    }
  },

  // Update cage status
  updateCageStatus: async (cageId, status) => {
    try {
      const { data, error } = await supabase
        .from('cages')
        .update({ status })
        .eq('id', cageId)
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error updating cage status:', error)
      return { data: null, error }
    }
  },

  // Delete cage (if no stockings are associated)
  deleteCage: async (cageId) => {
    await cageService.ensureTablesExist()

    // First check if there are any stockings for this cage
    const { data: stockings, error: checkError } = await supabase
      .from('stocking_history')
      .select('id')
      .eq('cage_id', cageId)
      .limit(1)

    if (checkError) {
      return { error: checkError }
    }

    // If stockings exist, don't allow deletion
    if (stockings && stockings.length > 0) {
      return {
        error: {
          message:
            'Cannot delete cage with existing stocking records. Update its status instead.',
        },
      }
    }

    // If no stockings, proceed with deletion
    try {
      const { error } = await supabase
        .from('cages')
        .delete()
        .eq('id', cageId)

      if (error) throw error
      return { data: true, error: null }
    } catch (error) {
      console.error('Error deleting cage:', error)
      return { data: null, error }
    }
  },

  // Get cages suitable for new stocking (empty, fallow, or harvested)
  getAvailableCagesForStocking: async () => {
    await cageService.ensureTablesExist()

    return await supabase
      .from('cages')
      .select('*')
      .in('status', ['empty', 'fallow', 'harvested'])
      .order('name')
  },

  // Get all active cages (for data entry forms)
  getActiveCages: async () => {
    await cageService.ensureTablesExist()

    return await supabase
      .from('cages')
      .select('*')
      .eq('status', 'active')
      .order('name')
  },
}

// Stocking history service
export const stockingService = {
  // Ensure tables exist
  ensureTablesExist: async () => {
    return await cageService.ensureTablesExist()
  },

  // Get all stockings (with cage info)
  getAllStockings: async () => {
    await stockingService.ensureTablesExist()

    return await supabase
      .from('stocking_history')
      .select(
        `
        *,
        cage:cage_id (
          id,
          name
        )
      `,
      )
      .order('stocking_date', { ascending: false })
  },

  // Get stocking history for a specific cage
  getStockingHistory: async (cageId) => {
    await stockingService.ensureTablesExist()

    return await supabase
      .from('stocking_history')
      .select('*')
      .eq('cage_id', cageId)
      .order('stocking_date', { ascending: false })
  },

  // Get all stockings in current year
  getCurrentYearStockings: async () => {
    await stockingService.ensureTablesExist()

    const currentYear = new Date().getFullYear()
    return await supabase
      .from('stocking_history')
      .select(
        `
        *,
        cage:cage_id (
          id,
          name
        )
      `,
      )
      .gte('stocking_date', `${currentYear}-01-01`)
      .lte('stocking_date', `${currentYear}-12-31`)
  },

  // Get specific stocking by ID
  getStockingById: async (stockingId) => {
    await stockingService.ensureTablesExist()

    return await supabase
      .from('stocking_history')
      .select(
        `
        *,
        cage:cage_id (
          id,
          name
        )
      `,
      )
      .eq('id', stockingId)
      .single()
  },

  // Create new stocking
  createStocking: async (stockingData) => {
    await stockingService.ensureTablesExist()

    // First create stocking record
    const { data: stocking, error: stockingError } = await supabase
      .from('stocking_history')
      .insert([stockingData])
      .select()

    if (stockingError) {
      return { error: stockingError }
    }

    // Then update cage status to active
    const { error: updateError } = await cageService.updateCageStatus(
      stockingData.cage_id,
      'active',
    )

    if (updateError) {
      return { data: stocking, error: updateError }
    }

    return { data: stocking, error: null }
  },

  // Update existing stocking
  updateStocking: async (stockingId, stockingData) => {
    await stockingService.ensureTablesExist()

    return await supabase
      .from('stocking_history')
      .update(stockingData)
      .eq('id', stockingId)
      .select()
  },

  // Get next stocking number for a cage in current year
  getNextStockingNumber: async (cageId) => {
    await stockingService.ensureTablesExist()

    const currentYear = new Date().getFullYear()
    const { data, error } = await supabase
      .from('stocking_history')
      .select('id')
      .eq('cage_id', cageId)
      .gte('stocking_date', `${currentYear}-01-01`)
      .lte('stocking_date', `${currentYear}-12-31`)

    if (error) throw error

    // Return stocking count + 1
    return (data ? data.length : 0) + 1
  },

  // Generate batch number
  generateBatchNumber: async (cageId) => {
    await stockingService.ensureTablesExist()

    try {
      // Get cage name
      const {
        data: cageData,
        error: cageError,
      } = await cageService.getCageById(cageId)

      if (cageError) throw cageError
      if (!cageData) throw new Error('Cage not found')

      const cageName = cageData.name

      // Get next stocking number
      const stockingCount = await stockingService.getNextStockingNumber(cageId)

      // Get year suffix
      const currentYear = new Date().getFullYear().toString().slice(-2) // Last 2 digits of year

      // Format: C1/125 (Cage 1, first stocking in year '25)
      const batchNumber = `${cageName}/${stockingCount}${currentYear}`

      return { data: batchNumber, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },
}

// Daily records service
export const dailyRecordService = {
  // Get daily records for a cage
  getDailyRecords: async (cageId) => {
    return await supabase
      .from('daily_records')
      .select('*')
      .eq('cage_id', cageId)
      .order('date', { ascending: false })
  },

  // Create new daily record
  createDailyRecord: async (recordData) => {
    return await supabase.from('daily_records').insert([recordData]).select()
  },
}

// Biweekly records service
export const biweeklyRecordService = {
  // Get biweekly records for a cage
  getBiweeklyRecords: async (cageId) => {
    try {
      const { data, error } = await supabase
        .from('biweekly_records')
        .select(`
          *,
          biweekly_sampling (*)
        `)
        .eq('cage_id', cageId)
        .order('date', { ascending: false })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching biweekly records:', error)
      return { data: null, error }
    }
  },

  // Get all biweekly records
  getAllBiweeklyRecords: async () => {
    try {
      const { data, error } = await supabase
        .from('biweekly_records')
        .select(`
          *,
          cages (
            name,
            code
          ),
          biweekly_sampling (*)
        `)
        .order('date', { ascending: false })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching all biweekly records:', error)
      return { data: null, error }
    }
  },

  // Create new biweekly record
  createBiweeklyRecord: async (recordData) => {
    try {
      // Add created_by field if not provided
      const { data: { user } } = await supabase.auth.getUser()
      const recordWithUser = {
        ...recordData,
        created_by: user?.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('biweekly_records')
        .insert([recordWithUser])
        .select()
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error creating biweekly record:', error)
      return { data: null, error }
    }
  },

  // Update biweekly record
  updateBiweeklyRecord: async (recordId, updates) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const recordWithUser = {
        ...updates,
        updated_by: user?.id,
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('biweekly_records')
        .update(recordWithUser)
        .eq('id', recordId)
        .select()
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error updating biweekly record:', error)
      return { data: null, error }
    }
  },

  // Delete biweekly record
  deleteBiweeklyRecord: async (recordId) => {
    try {
      const { error } = await supabase
        .from('biweekly_records')
        .delete()
        .eq('id', recordId)

      if (error) throw error
      return { error: null }
    } catch (error) {
      console.error('Error deleting biweekly record:', error)
      return { error }
    }
  },

  // Create biweekly sampling
  createBiweeklySampling: async (samplingData) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const samplingWithUser = {
        ...samplingData,
        created_by: user?.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('biweekly_sampling')
        .insert([samplingWithUser])
        .select()
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error creating biweekly sampling:', error)
      return { data: null, error }
    }
  },

  // Get biweekly sampling for a record
  getBiweeklySampling: async (recordId) => {
    try {
      const { data, error } = await supabase
        .from('biweekly_sampling')
        .select('*')
        .eq('biweekly_record_id', recordId)
        .order('sampling_number', { ascending: true })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching biweekly sampling:', error)
      return { data: null, error }
    }
  },

  // Update biweekly sampling
  updateBiweeklySampling: async (samplingId, updates) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const samplingWithUser = {
        ...updates,
        updated_by: user?.id,
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('biweekly_sampling')
        .update(samplingWithUser)
        .eq('id', samplingId)
        .select()
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error updating biweekly sampling:', error)
      return { data: null, error }
    }
  },

  // Delete biweekly sampling
  deleteBiweeklySampling: async (samplingId) => {
    try {
      const { error } = await supabase
        .from('biweekly_sampling')
        .delete()
        .eq('id', samplingId)

      if (error) throw error
      return { error: null }
    } catch (error) {
      console.error('Error deleting biweekly sampling:', error)
      return { error }
    }
  },

  // Get biweekly records with pagination
  getBiweeklyRecordsPaginated: async (page = 1, pageSize = 20) => {
    try {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const { data, error, count } = await supabase
        .from('biweekly_records')
        .select(`
          *,
          cages (
            name,
            code
          ),
          biweekly_sampling (*)
        `, { count: 'exact' })
        .order('date', { ascending: false })
        .range(from, to)

      if (error) throw error

      return {
        data,
        error: null,
        totalCount: count,
        totalPages: Math.ceil(count / pageSize),
        currentPage: page
      }
    } catch (error) {
      console.error('Error fetching paginated biweekly records:', error)
      return { data: null, error, totalCount: 0, totalPages: 0, currentPage: page }
    }
  }
}

// Harvest records service
export const harvestRecordService = {
  // Get harvest record for a cage
  getHarvestRecord: async (cageId) => {
    return await supabase
      .from('harvest_records')
      .select('*')
      .eq('cage_id', cageId)
      .single()
  },

  // Get all harvest records with cage information
  getAllHarvestRecords: async () => {
    return await supabase
      .from('harvest_records')
      .select(`
        *,
        cages (
          name,
          code
        )
      `)
      .order('harvest_date', { ascending: false })
  },

  // Export harvest records
  exportHarvestRecords: async () => {
    const { data, error } = await supabase
      .from('harvest_records')
      .select(`
        *,
        cages (
          name,
          code
        )
      `)
      .order('harvest_date', { ascending: false })

    if (error) return { error }

    // Transform data to include cage name
    const transformedData = data.map(record => ({
      ...record,
      cage_name: record.cages?.name || 'Unknown Cage',
      cage_code: record.cages?.code || 'Unknown'
    }))

    return { data: transformedData, error: null }
  },

  async createHarvestRecord(recordData) {
    try {
      const { data, error } = await supabase
        .from('harvest_records')
        .insert([{
          cage_id: recordData.cage_id,
          harvest_date: recordData.harvest_date,
          harvest_type: recordData.harvest_type,
          status: recordData.harvest_type === 'complete' ? 'completed' : 'in_progress',
          total_weight: parseFloat(recordData.total_weight),
          average_body_weight: parseFloat(recordData.average_body_weight),
          estimated_count: parseInt(recordData.estimated_count, 10),
          fcr: parseFloat(recordData.fcr),
          size_breakdown: recordData.size_breakdown,
          notes: recordData.notes,
          created_at: new Date().toISOString()
        }])
        .select()
        .single()

      if (error) throw error

      // Update cage status based on harvest type
      const newCageStatus = recordData.harvest_type === 'complete' ? 'harvested' : 'harvesting';
      const { error: updateError } = await supabase
        .from('cages')
        .update({ status: newCageStatus, updated_at: new Date() })
        .match({ id: recordData.cage_id })

      if (updateError) throw updateError

      return { data, error: null }
    } catch (error) {
      console.error('Error creating harvest record:', error)
      return { data: null, error }
    }
  },

  async getHarvestRecords() {
    try {
      const { data, error } = await supabase
        .from('harvest_records')
        .select(`
          *,
          cages (
            name,
            code
          )
        `)
        .order('harvest_date', { ascending: false })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching harvest records:', error)
      return { data: null, error }
    }
  },

  async getHarvestRecord(id) {
    try {
      const { data, error } = await supabase
        .from('harvest_records')
        .select(`
          *,
          cages (
            name,
            code
          )
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching harvest record:', error)
      return { data: null, error }
    }
  },

  async updateHarvestRecord(id, updates) {
    try {
      const { data, error } = await supabase
        .from('harvest_records')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error updating harvest record:', error)
      return { data: null, error }
    }
  },

  async deleteHarvestRecord(id) {
    try {
      const { error } = await supabase
        .from('harvest_records')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { error: null }
    } catch (error) {
      console.error('Error deleting harvest record:', error)
      return { error }
    }
  },

  async exportHarvestRecords() {
    try {
      const { data, error } = this.getAllHarvestRecords()
      if (error) throw error

      const csvData = data.map(record => ({
        'Cage Name': record.cages.name,
        'Cage Code': record.cages.code,
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

// Feed suppliers service
export const supplierService = {
  // Get all suppliers
  getAllSuppliers: async () => {
    return await supabase
      .from('feed_suppliers')
      .select('*')
      .order('name');
  },

  // Create a new supplier
  createSupplier: async (supplierData) => {
    return await supabase
      .from('feed_suppliers')
      .insert([supplierData])
      .select();
  },
};

// Feed types service
export const feedTypeService = {
  // Get all feed types with supplier info
  getAllFeedTypes: async () => {
    return await supabase
      .from('feed_types')
      .select(`
        *,
        supplier:supplier_id (
          name
        )
      `)
      .order('name');
  },

  // Create a new feed type
  createFeedType: async (feedTypeData) => {
     const { data, error } = await supabase
      .from('feed_types')
      .insert([feedTypeData])
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  },
};

// Analytics service
export const analyticsService = {
  /**
   * Get cage summary statistics
   */
  getCageSummaryStats: async () => {
    try {
      const { data: cages, error } = await supabase
        .from('cages')
        .select('*')

      if (error) throw error

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
      const { data: cages, error } = await supabase
        .from('cages')
        .select('*')

      if (error) throw error

      const harvestData = cages.reduce((acc, cage) => {
        if (!cage.stocking_date) return acc
        
        const stockingDate = new Date(cage.stocking_date)
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
      const { data: cages, error } = await supabase
        .from('cages')
        .select('*')

      if (error) throw error

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
      const { data: cages, error } = await supabase
        .from('cages')
        .select('*')

      if (error) throw error

      const growthData = cages
        .filter(cage => cage.status === 'active' && cage.stocking_date)
        .map(cage => {
          const stockingDate = new Date(cage.stocking_date)
          const today = new Date()
          const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
          return {
            cageId: cage.id,
            cageName: cage.name,
            doc,
            initialWeight: cage.initial_weight,
            currentWeight: cage.current_weight,
            growthRate: cage.growth_rate,
          }
        })

      return { data: growthData, error: null }
    } catch (error) {
      console.error('Error fetching growth trends:', error)
      return { data: null, error }
    }
  }
}
