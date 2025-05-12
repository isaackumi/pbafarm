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
    await cageService.ensureTablesExist()
    return await supabase.from('cages').select('*').order('name')
  },

  // Get a specific cage by ID
  getCageById: async (id) => {
    await cageService.ensureTablesExist()
    return await supabase.from('cages').select('*').eq('id', id).single()
  },

  // Create a new cage
  createCage: async (cageData) => {
    await cageService.ensureTablesExist()

    // Add timestamps
    cageData.created_at = new Date()
    cageData.updated_at = new Date()

    return await supabase.from('cages').insert([cageData]).select()
  },

  // Update cage information
  updateCage: async (cageId, cageData) => {
    await cageService.ensureTablesExist()

    // Add updated timestamp
    cageData.updated_at = new Date()

    return await supabase
      .from('cages')
      .update(cageData)
      .eq('id', cageId)
      .select()
  },

  // Update cage status
  updateCageStatus: async (cageId, status) => {
    await cageService.ensureTablesExist()

    return await supabase
      .from('cages')
      .update({
        status,
        updated_at: new Date(),
      })
      .eq('id', cageId)
      .select()
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
    return await supabase.from('cages').delete().eq('id', cageId)
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
    return await supabase
      .from('biweekly_records')
      .select('*')
      .eq('cage_id', cageId)
      .order('date', { ascending: false })
  },

  // Create new biweekly record
  createBiweeklyRecord: async (recordData) => {
    return await supabase.from('biweekly_records').insert([recordData]).select()
  },
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

  // Create new harvest record
  createHarvestRecord: async (recordData) => {
    // Create harvest record
    const { data, error } = await supabase
      .from('harvest_records')
      .insert([recordData])
      .select()

    if (error) {
      return { error }
    }

    // Update cage status to harvested
    const { error: updateError } = await cageService.updateCageStatus(
      recordData.cage_id,
      'harvested',
    )

    if (updateError) {
      return { data, error: updateError }
    }

    return { data, error: null }
  },
}

// Analytics service
export const analyticsService = {
  // Get cage summary stats
  getCageSummaryStats: async () => {
    await cageService.ensureTablesExist()

    try {
      const { data: cages, error } = await supabase
        .from('cages')
        .select('status')

      if (error) throw error

      const stats = {
        totalCages: cages.length,
        activeCages: cages.filter((c) => c.status === 'active').length,
        harvestedCages: cages.filter((c) => c.status === 'harvested').length,
        maintenanceCages: cages.filter((c) => c.status === 'maintenance')
          .length,
        fallowCages: cages.filter((c) => c.status === 'fallow').length,
        emptyCages: cages.filter((c) => c.status === 'empty').length,
      }

      return { data: stats, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },
}
