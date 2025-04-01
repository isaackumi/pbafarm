// lib/databaseService.js
import { supabase } from './supabase'

// Cage related functions
export const cageService = {
  // Get all cages
  async getAllCages() {
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

  // Get a single cage by ID
  async getCageById(id) {
    try {
      const { data, error } = await supabase
        .from('cages')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching cage:', error)
      return { data: null, error }
    }
  },

  // Create a new cage
  async createCage(cageData) {
    try {
      const { data, error } = await supabase.from('cages').insert([cageData])

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error creating cage:', error)
      return { data: null, error }
    }
  },

  // Update cage status
  async updateCageStatus(cageId, status) {
    try {
      const { data, error } = await supabase
        .from('cages')
        .update({ status })
        .match({ id: cageId })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error updating cage status:', error)
      return { data: null, error }
    }
  },

  // Update cage details
  async updateCage(cageId, cageData) {
    try {
      const { data, error } = await supabase
        .from('cages')
        .update(cageData)
        .match({ id: cageId })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error updating cage:', error)
      return { data: null, error }
    }
  },
}

// Daily records related functions
export const dailyRecordService = {
  // Get daily records for a cage
  async getDailyRecords(cageId, limit = 100) {
    try {
      const { data, error } = await supabase
        .from('daily_records')
        .select('*')
        .eq('cage_id', cageId)
        .order('date', { ascending: false })
        .limit(limit)

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching daily records:', error)
      return { data: null, error }
    }
  },

  // Create a new daily record
  async createDailyRecord(recordData) {
    try {
      const { data, error } = await supabase
        .from('daily_records')
        .insert([recordData])

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error creating daily record:', error)
      return { data: null, error }
    }
  },
}

// Biweekly records related functions
export const biweeklyRecordService = {
  // Get biweekly records for a cage
  async getBiweeklyRecords(cageId) {
    try {
      const { data, error } = await supabase
        .from('biweekly_records')
        .select('*')
        .eq('cage_id', cageId)
        .order('date', { ascending: false })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching biweekly records:', error)
      return { data: null, error }
    }
  },

  // Create a new biweekly record
  async createBiweeklyRecord(recordData) {
    try {
      const { data, error } = await supabase
        .from('biweekly_records')
        .insert([recordData])

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error creating biweekly record:', error)
      return { data: null, error }
    }
  },
}

// Harvest records related functions
export const harvestRecordService = {
  // Get harvest record for a cage
  async getHarvestRecord(cageId) {
    try {
      const { data, error } = await supabase
        .from('harvest_records')
        .select('*')
        .eq('cage_id', cageId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No harvest record found
          return { data: null, error: null }
        }
        throw error
      }
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching harvest record:', error)
      return { data: null, error }
    }
  },

  // Create a new harvest record
  async createHarvestRecord(recordData) {
    try {
      const { data, error } = await supabase
        .from('harvest_records')
        .insert([recordData])

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error creating harvest record:', error)
      return { data: null, error }
    }
  },
}

// User related functions
export const userService = {
  // Get user profile
  async getUserProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching user profile:', error)
      return { data: null, error }
    }
  },

  // Update user profile
  async updateUserProfile(userId, profileData) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(profileData)
        .match({ id: userId })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error updating user profile:', error)
      return { data: null, error }
    }
  },
}

// Statistics and analytics functions
export const analyticsService = {
  // Get cage summary statistics
  async getCageSummaryStats() {
    try {
      // Get all cages
      const { data: cages, error } = await supabase.from('cages').select('*')

      if (error) throw error

      // Calculate statistics
      const totalCages = cages.length
      const activeCages = cages.filter((cage) => cage.status === 'active')
        .length
      const harvestedCages = cages.filter((cage) => cage.status === 'harvested')
        .length
      const maintenanceCages = cages.filter(
        (cage) => cage.status === 'maintenance',
      ).length
      const fallowCages = cages.filter((cage) => cage.status === 'fallow')
        .length

      return {
        data: {
          totalCages,
          activeCages,
          harvestedCages,
          maintenanceCages,
          fallowCages,
          otherCages:
            totalCages -
            activeCages -
            harvestedCages -
            maintenanceCages -
            fallowCages,
        },
        error: null,
      }
    } catch (error) {
      console.error('Error getting cage statistics:', error)
      return { data: null, error }
    }
  },
}
