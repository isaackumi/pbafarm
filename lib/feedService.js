// lib/feedService.js
import { supabase } from './supabase'

export const feedService = {
  /**
   * Get all feed purchases
   */
  async getAllPurchases() {
    try {
      const { data, error } = await supabase
        .from('feed_purchases')
        .select(`
          *,
          feed_types (
            id,
            name,
            current_stock
          ),
          suppliers (
            id,
            name
          )
        `)
        .order('purchase_date', { ascending: false })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching purchases:', error)
      return { data: null, error }
    }
  },

  /**
   * Get feed purchases by date range
   */
  async getPurchasesByDateRange(startDate, endDate) {
    try {
      const { data, error } = await supabase
        .from('feed_purchases')
        .select(`
          *,
          feed_types (
            id,
            name,
            current_stock
          ),
          suppliers (
            id,
            name
          )
        `)
        .gte('purchase_date', startDate)
        .lte('purchase_date', endDate)
        .order('purchase_date', { ascending: false })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching purchases by date range:', error)
      return { data: null, error }
    }
  },

  /**
   * Create new feed purchase
   */
  async createPurchase(purchaseData) {
    try {
      const { data, error } = await supabase
        .from('feed_purchases')
        .insert([purchaseData])
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error creating purchase:', error)
      return { data: null, error }
    }
  },

  /**
   * Update feed purchase
   */
  async updatePurchase(id, updates) {
    try {
      const { data, error } = await supabase
        .from('feed_purchases')
        .update(updates)
        .eq('id', id)
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error updating purchase:', error)
      return { data: null, error }
    }
  },

  /**
   * Delete feed purchase
   */
  async deletePurchase(id) {
    try {
      const { error } = await supabase
        .from('feed_purchases')
        .delete()
        .eq('id', id)

      if (error) throw error
      return { error: null }
    } catch (error) {
      console.error('Error deleting purchase:', error)
      return { error }
    }
  },

  /**
   * Get feed usage statistics
   */
  async getFeedUsageStats(timeRange = '30d') {
    try {
      const endDate = new Date()
      const startDate = new Date()
      
      switch (timeRange) {
        case '7d':
          startDate.setDate(startDate.getDate() - 7)
          break
        case '30d':
          startDate.setDate(startDate.getDate() - 30)
          break
        case '90d':
          startDate.setDate(startDate.getDate() - 90)
          break
        case '1y':
          startDate.setFullYear(startDate.getFullYear() - 1)
          break
        default:
          startDate.setDate(startDate.getDate() - 30)
      }

      const { data, error } = await supabase
        .from('feed_usage')
        .select(`
          *,
          feed_types (
            id,
            name
          ),
          cages (
            id,
            name
          )
        `)
        .gte('usage_date', startDate.toISOString().split('T')[0])
        .lte('usage_date', endDate.toISOString().split('T')[0])
        .order('usage_date', { ascending: true })

      if (error) throw error

      // Process data for statistics
      const stats = {
        totalUsage: 0,
        byFeedType: {},
        byCage: {},
        dailyUsage: {},
      }

      data.forEach(record => {
        const feedType = record.feed_types.name
        const cage = record.cages.name
        const date = record.usage_date

        // Total usage
        stats.totalUsage += record.quantity

        // Usage by feed type
        if (!stats.byFeedType[feedType]) {
          stats.byFeedType[feedType] = 0
        }
        stats.byFeedType[feedType] += record.quantity

        // Usage by cage
        if (!stats.byCage[cage]) {
          stats.byCage[cage] = 0
        }
        stats.byCage[cage] += record.quantity

        // Daily usage
        if (!stats.dailyUsage[date]) {
          stats.dailyUsage[date] = 0
        }
        stats.dailyUsage[date] += record.quantity
      })

      return { data: stats, error: null }
    } catch (error) {
      console.error('Error fetching feed usage stats:', error)
      return { data: null, error }
    }
  },

  /**
   * Get low stock alerts
   */
  async getLowStockAlerts() {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select('*')
        .lt('current_stock', 'minimum_stock')
        .eq('active', true)

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching low stock alerts:', error)
      return { data: null, error }
    }
  },

  /**
   * Record feed usage
   */
  async recordFeedUsage(usageData) {
    try {
      const { data, error } = await supabase
        .from('feed_usage')
        .insert([usageData])
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error recording feed usage:', error)
      return { data: null, error }
    }
  },

  /**
   * Get feed usage by cage
   */
  async getFeedUsageByCage(cageId, startDate, endDate) {
    try {
      const { data, error } = await supabase
        .from('feed_usage')
        .select(`
          *,
          feed_types (
            id,
            name
          )
        `)
        .eq('cage_id', cageId)
        .gte('usage_date', startDate)
        .lte('usage_date', endDate)
        .order('usage_date', { ascending: true })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching feed usage by cage:', error)
      return { data: null, error }
    }
  },

  /**
   * Get feed cost analysis
   */
  async getFeedCostAnalysis(timeRange = '30d') {
    try {
      const endDate = new Date()
      const startDate = new Date()
      
      switch (timeRange) {
        case '7d':
          startDate.setDate(startDate.getDate() - 7)
          break
        case '30d':
          startDate.setDate(startDate.getDate() - 30)
          break
        case '90d':
          startDate.setDate(startDate.getDate() - 90)
          break
        case '1y':
          startDate.setFullYear(startDate.getFullYear() - 1)
          break
        default:
          startDate.setDate(startDate.getDate() - 30)
      }

      const { data, error } = await supabase
        .from('feed_purchases')
        .select(`
          *,
          feed_types (
            id,
            name
          )
        `)
        .gte('purchase_date', startDate.toISOString().split('T')[0])
        .lte('purchase_date', endDate.toISOString().split('T')[0])
        .order('purchase_date', { ascending: true })

      if (error) throw error

      // Process data for cost analysis
      const analysis = {
        totalCost: 0,
        totalQuantity: 0,
        averageCostPerKg: 0,
        byFeedType: {},
        monthlyCosts: {},
      }

      data.forEach(purchase => {
        const feedType = purchase.feed_types.name
        const month = purchase.purchase_date.substring(0, 7) // YYYY-MM
        const cost = purchase.quantity * purchase.price_per_kg

        // Total cost and quantity
        analysis.totalCost += cost
        analysis.totalQuantity += purchase.quantity

        // Cost by feed type
        if (!analysis.byFeedType[feedType]) {
          analysis.byFeedType[feedType] = {
            totalCost: 0,
            totalQuantity: 0,
            averageCostPerKg: 0,
          }
        }
        analysis.byFeedType[feedType].totalCost += cost
        analysis.byFeedType[feedType].totalQuantity += purchase.quantity

        // Monthly costs
        if (!analysis.monthlyCosts[month]) {
          analysis.monthlyCosts[month] = 0
        }
        analysis.monthlyCosts[month] += cost
      })

      // Calculate averages
      analysis.averageCostPerKg = analysis.totalQuantity > 0 
        ? analysis.totalCost / analysis.totalQuantity 
        : 0

      Object.keys(analysis.byFeedType).forEach(feedType => {
        const type = analysis.byFeedType[feedType]
        type.averageCostPerKg = type.totalQuantity > 0 
          ? type.totalCost / type.totalQuantity 
          : 0
      })

      return { data: analysis, error: null }
    } catch (error) {
      console.error('Error fetching feed cost analysis:', error)
      return { data: null, error }
    }
  }
} 