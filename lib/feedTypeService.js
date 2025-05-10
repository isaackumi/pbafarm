// lib/feedTypeService.js (simplified implementation)
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
}

export default feedTypeService
