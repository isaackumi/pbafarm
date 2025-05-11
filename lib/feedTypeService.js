// lib/feedTypeService.js (enhanced version)
import { supabase } from './supabase'

const feedTypeService = {
  /**
   * Get all feed types
   */
  getAllFeedTypes: async () => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select('*')
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching feed types:', error)
      return { data: null, error }
    }
  },

  /**
   * Get only active feed types
   */
  getActiveFeedTypes: async () => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select('*')
        .eq('active', true)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching active feed types:', error)
      return { data: null, error }
    }
  },

  /**
   * Get feed type by id
   */
  getFeedTypeById: async (id) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching feed type:', error)
      return { data: null, error }
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
  createFeedType: async (feedTypeData) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .insert([feedTypeData])
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error creating feed type:', error)
      return { data: null, error }
    }
  },

  /**
   * Update feed type
   */
  updateFeedType: async (id, feedTypeData) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .update(feedTypeData)
        .eq('id', id)
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error updating feed type:', error)
      return { data: null, error }
    }
  },

  /**
   * Delete feed type (soft delete)
   */
  deleteFeedType: async (id) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .update({ deleted_at: new Date(), active: false })
        .eq('id', id)
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error deleting feed type:', error)
      return { data: null, error }
    }
  },
}

export default feedTypeService
