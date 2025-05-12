// lib/cageService.js (enhanced version)
import { supabase } from './supabase'

const cageService = {
  /**
   * Get all cages
   */
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

  /**
   * Get a specific cage by ID
   */
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

  /**
   * Get a cage by name (case-insensitive)
   */
  getCageByName: async (name) => {
    try {
      const { data, error } = await supabase
        .from('cages')
        .select('*')
        .ilike('name', name.trim())
        .limit(1)
        .maybeSingle()

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
      }

      const { data: result, error } = await supabase
        .from('cages')
        .insert([data])
        .select()

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

      const { data: result, error } = await supabase
        .from('cages')
        .update(data)
        .eq('id', cageId)
        .select()

      if (error) throw error
      return { data: result[0], error: null }
    } catch (error) {
      console.error('Error updating cage:', error)
      return { data: null, error }
    }
  },

  /**
   * Update cage status
   */
  updateCageStatus: async (cageId, status) => {
    try {
      const { data, error } = await supabase
        .from('cages')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cageId)
        .select()

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
      const { data, error } = await supabase
        .from('cages')
        .select('*')
        .eq('status', 'active')
        .order('name')

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
      const { data: records, error: checkError } = await supabase
        .from('daily_records')
        .select('id')
        .eq('cage_id', cageId)
        .limit(1)

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
      const { data, error } = await supabase
        .from('cages')
        .delete()
        .eq('id', cageId)

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error deleting cage:', error)
      return { data: null, error }
    }
  },
}

export default cageService
