// lib/cageService.js (enhanced version)
import { supabase } from './supabase'

// Helper function to handle retries
const withRetry = async (operation, maxRetries = 3) => {
  let lastError
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (error.message.includes('insufficient resources') || error.message.includes('Failed to fetch')) {
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000))
        continue
      }
      throw error
    }
  }
  throw lastError
}

const cageService = {
  /**
   * Get all cages with pagination
   */
  getAllCages: async (page = 1, pageSize = 50) => {
    try {
      // First get total count with retry
      const { count, error: countError } = await withRetry(() =>
        supabase
          .from('cages')
          .select('*', { count: 'exact', head: true })
      )

      if (countError) throw countError

      // Then get paginated data with retry
      const { data, error } = await withRetry(() =>
        supabase
          .from('cages')
          .select(`
            id, 
            name, 
            status, 
            location, 
            size, 
            stocking_date, 
            installation_date,
            initial_weight,
            current_weight,
            growth_rate,
            initial_count,
            current_count,
            mortality_rate,
            last_maintenance_date,
            next_maintenance_date
          `)
          .order('name')
          .range((page - 1) * pageSize, page * pageSize - 1)
      )

      if (error) throw error

      return { 
        data, 
        error: null,
        totalCount: count,
        totalPages: Math.ceil(count / pageSize)
      }
    } catch (error) {
      console.error('Error fetching cages:', error)
      return { 
        data: [], 
        error,
        totalCount: 0,
        totalPages: 0
      }
    }
  },

  /**
   * Get a specific cage by ID
   */
  getCageById: async (id) => {
    try {
      const { data, error } = await withRetry(() =>
        supabase
          .from('cages')
          .select('*')
          .eq('id', id)
          .single()
      )

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching cage by ID:', error)
      return { data: null, error }
    }
  },

  /**
   * Get a cage by name (case-insensitive)
   */
  getCageByName: async (name) => {
    try {
      const { data, error } = await withRetry(() =>
        supabase
          .from('cages')
          .select('*')
          .ilike('name', name.trim())
          .limit(1)
          .maybeSingle()
      )

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching cage by name:', error)
      return { data: null, error }
    }
  },

  /**
   * Create a new cage
   */
  createCage: async (cageData) => {
    try {
      // Add timestamps
      const now = new Date().toISOString()
      const data = {
        ...cageData,
        created_at: now,
        updated_at: now,
        // Initialize metrics
        initial_weight: cageData.initial_weight || null,
        current_weight: cageData.current_weight || null,
        growth_rate: cageData.growth_rate || null,
        initial_count: cageData.initial_count || null,
        current_count: cageData.current_count || null,
        mortality_rate: cageData.mortality_rate || null,
        last_maintenance_date: cageData.last_maintenance_date || null,
        next_maintenance_date: cageData.next_maintenance_date || null
      }

      const { data: result, error } = await withRetry(() =>
        supabase
          .from('cages')
          .insert([data])
          .select()
      )

      if (error) throw error
      return { data: result[0], error: null }
    } catch (error) {
      console.error('Error creating cage:', error)
      return { data: null, error }
    }
  },

  /**
   * Update cage information
   */
  updateCage: async (cageId, cageData) => {
    try {
      // Add updated timestamp
      const data = {
        ...cageData,
        updated_at: new Date().toISOString(),
      }

      const { data: result, error } = await withRetry(() =>
        supabase
          .from('cages')
          .update(data)
          .eq('id', cageId)
          .select()
      )

      if (error) throw error
      return { data: result[0], error: null }
    } catch (error) {
      console.error('Error updating cage:', error)
      return { data: null, error }
    }
  },

  /**
   * Update cage metrics
   */
  updateCageMetrics: async (cageId, metrics) => {
    try {
      const { data: result, error } = await withRetry(() =>
        supabase
          .from('cages')
          .update({
            ...metrics,
            updated_at: new Date().toISOString()
          })
          .eq('id', cageId)
          .select()
      )

      if (error) throw error
      return { data: result[0], error: null }
    } catch (error) {
      console.error('Error updating cage metrics:', error)
      return { data: null, error }
    }
  },

  /**
   * Update cage status
   */
  updateCageStatus: async (cageId, status) => {
    try {
      const { data, error } = await withRetry(() =>
        supabase
          .from('cages')
          .update({
            status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', cageId)
          .select()
      )

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error updating cage status:', error)
      return { data: null, error }
    }
  },

  /**
   * Get active cages
   */
  getActiveCages: async () => {
    try {
      const { data, error } = await withRetry(() =>
        supabase
          .from('cages')
          .select('*')
          .eq('status', 'active')
          .order('name')
      )

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching active cages:', error)
      return { data: null, error }
    }
  },

  /**
   * Delete a cage (if no associations exist)
   */
  deleteCage: async (cageId) => {
    try {
      // Check if the cage has associated records
      const { data: records, error: checkError } = await withRetry(() =>
        supabase
          .from('daily_records')
          .select('id')
          .eq('cage_id', cageId)
          .limit(1)
      )

      if (checkError) throw checkError

      // If records exist, don't allow deletion
      if (records && records.length > 0) {
        return {
          error: {
            message:
              'Cannot delete cage with existing records. Update status instead.',
          },
        }
      }

      // If no records, proceed with deletion
      const { data, error } = await withRetry(() =>
        supabase
          .from('cages')
          .delete()
          .eq('id', cageId)
      )

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error deleting cage:', error)
      return { data: null, error }
    }
  },

  /**
   * Calculate and update growth metrics
   */
  calculateGrowthMetrics: async (cageId) => {
    try {
      // Get current cage data
      const { data: cage, error: fetchError } = await withRetry(() =>
        supabase
          .from('cages')
          .select('initial_weight, current_weight, initial_count, current_count')
          .eq('id', cageId)
          .single()
      )

      if (fetchError) throw fetchError

      // Calculate growth rate
      let growthRate = null
      if (cage.initial_weight && cage.current_weight) {
        growthRate = ((cage.current_weight - cage.initial_weight) / cage.initial_weight * 100).toFixed(2)
      }

      // Calculate mortality rate
      let mortalityRate = null
      if (cage.initial_count && cage.current_count) {
        mortalityRate = ((cage.initial_count - cage.current_count) / cage.initial_count * 100).toFixed(2)
      }

      // Update metrics
      const { data: result, error: updateError } = await withRetry(() =>
        supabase
          .from('cages')
          .update({
            growth_rate: growthRate,
            mortality_rate: mortalityRate,
            updated_at: new Date().toISOString()
          })
          .eq('id', cageId)
          .select()
      )

      if (updateError) throw updateError
      return { data: result[0], error: null }
    } catch (error) {
      console.error('Error calculating growth metrics:', error)
      return { data: null, error }
    }
  }
}

export default cageService
