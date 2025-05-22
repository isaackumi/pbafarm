// lib/feedTypeService.js (enhanced version)
import { supabase } from './supabase'

export const feedTypeService = {
  /**
   * Get all feed types
   */
  async getAllFeedTypes() {
    try {
      console.log('Fetching all feed types...')
      const { data, error } = await supabase
        .from('feed_types')
        .select('*')
        .order('name')

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Feed types fetched successfully:', data?.length || 0)
      return { data, error: null }
    } catch (error) {
      console.error('Error in getAllFeedTypes:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to fetch feed types',
          details: error
        }
      }
    }
  },

  /**
   * Get only active feed types
   */
  async getActiveFeedTypes() {
    try {
      console.log('Fetching active feed types...')
      const { data, error } = await supabase
        .from('feed_types')
        .select('*')
        .eq('active', true)
        .order('name')

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Active feed types fetched successfully:', data?.length || 0)
      return { data, error: null }
    } catch (error) {
      console.error('Error in getActiveFeedTypes:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to fetch active feed types',
          details: error
        }
      }
    }
  },

  /**
   * Get feed type by id
   */
  async getFeedTypeById(id) {
    try {
      console.log('Fetching feed type by ID:', id)
      const { data, error } = await supabase
        .from('feed_types')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Feed type fetched successfully:', data)
      return { data, error: null }
    } catch (error) {
      console.error('Error in getFeedTypeById:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to fetch feed type',
          details: error
        }
      }
    }
  },

  /**
   * Get feed type by name (case-insensitive)
   */
  getFeedTypeByName: async (name) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select('*')
        .ilike('name', name.trim())
        .is('deleted_at', null)
        .eq('active', true)
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching feed type by name:', error)
      return { data: null, error }
    }
  },

  /**
   * Get the last used feed type for a specific cage
   */
  getLastUsedFeedType: async (cageId) => {
    try {
      const { data, error } = await supabase
        .from('daily_records')
        .select('feed_type_id, feed_types(id, name, price_per_kg)')
        .eq('cage_id', cageId)
        .order('date', { ascending: false })
        .limit(1)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No records found
          return null
        }
        throw error
      }

      return data.feed_types
    } catch (error) {
      console.error('Error fetching last used feed type:', error)
      return null
    }
  },

  /**
   * Create new feed type
   */
  async createFeedType(feedTypeData) {
    try {
      console.log('Creating new feed type:', feedTypeData)
      const { data, error } = await supabase
        .from('feed_types')
        .insert([feedTypeData])
        .select()

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Feed type created successfully:', data)
      return { data, error: null }
    } catch (error) {
      console.error('Error in createFeedType:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to create feed type',
          details: error
        }
      }
    }
  },

  /**
   * Update feed type
   */
  async updateFeedType(id, updates) {
    try {
      console.log('Updating feed type:', { id, updates })
      const { data, error } = await supabase
        .from('feed_types')
        .update(updates)
        .eq('id', id)
        .select()

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Feed type updated successfully:', data)
      return { data, error: null }
    } catch (error) {
      console.error('Error in updateFeedType:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to update feed type',
          details: error
        }
      }
    }
  },

  /**
   * Delete feed type (soft delete)
   */
  async deleteFeedType(id) {
    try {
      console.log('Deleting feed type:', id)
      const { error } = await supabase
        .from('feed_types')
        .delete()
        .eq('id', id)

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Feed type deleted successfully')
      return { error: null }
    } catch (error) {
      console.error('Error in deleteFeedType:', error)
      return { 
        error: {
          message: error.message || 'Failed to delete feed type',
          details: error
        }
      }
    }
  },
}
