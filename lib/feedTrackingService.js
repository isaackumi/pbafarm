import { supabase } from './supabase'

export const feedTrackingService = {
  /**
   * Record feed usage across the application
   */
  async recordFeedUsage(usageData) {
    try {
      const { data, error } = await supabase
        .from('feed_usage')
        .insert([{
          feed_type_id: usageData.feed_type_id,
          cage_id: usageData.cage_id,
          quantity: usageData.quantity,
          usage_date: usageData.usage_date || new Date().toISOString(),
          notes: usageData.notes,
          recorded_by: usageData.recorded_by
        }])
        .select()

      if (error) throw error

      // Update feed type stock
      await this.updateFeedStock(usageData.feed_type_id, -usageData.quantity)

      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error recording feed usage:', error)
      return { data: null, error }
    }
  },

  /**
   * Update feed stock levels
   */
  async updateFeedStock(feedTypeId, quantityChange) {
    try {
      const { data: feedType, error: fetchError } = await supabase
        .from('feed_types')
        .select('current_stock')
        .eq('id', feedTypeId)
        .single()

      if (fetchError) throw fetchError

      const newStock = feedType.current_stock + quantityChange
      if (newStock < 0) {
        throw new Error('Insufficient stock')
      }

      const { error: updateError } = await supabase
        .from('feed_types')
        .update({ current_stock: newStock })
        .eq('id', feedTypeId)

      if (updateError) throw updateError

      return { error: null }
    } catch (error) {
      console.error('Error updating feed stock:', error)
      return { error }
    }
  },

  /**
   * Get feed usage statistics
   */
  async getFeedUsageStats(timeRange = '30d') {
    try {
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
      }

      const { data, error } = await supabase
        .from('feed_usage')
        .select(`
          *,
          feed_types (
            id,
            name,
            price_per_kg
          ),
          cages (
            id,
            name
          )
        `)
        .gte('usage_date', startDate.toISOString())
        .order('usage_date', { ascending: false })

      if (error) throw error

      // Process data for statistics
      const stats = {
        totalUsage: 0,
        totalCost: 0,
        usageByCage: {},
        usageByFeedType: {},
        dailyUsage: {},
        fcrByCage: {}
      }

      data.forEach(record => {
        const feedType = record.feed_types
        const cage = record.cages
        const cost = record.quantity * feedType.price_per_kg

        // Update totals
        stats.totalUsage += record.quantity
        stats.totalCost += cost

        // Update cage usage
        if (!stats.usageByCage[cage.name]) {
          stats.usageByCage[cage.name] = {
            quantity: 0,
            cost: 0
          }
        }
        stats.usageByCage[cage.name].quantity += record.quantity
        stats.usageByCage[cage.name].cost += cost

        // Update feed type usage
        if (!stats.usageByFeedType[feedType.name]) {
          stats.usageByFeedType[feedType.name] = {
            quantity: 0,
            cost: 0
          }
        }
        stats.usageByFeedType[feedType.name].quantity += record.quantity
        stats.usageByFeedType[feedType.name].cost += cost

        // Update daily usage
        const date = new Date(record.usage_date).toLocaleDateString()
        if (!stats.dailyUsage[date]) {
          stats.dailyUsage[date] = {
            quantity: 0,
            cost: 0
          }
        }
        stats.dailyUsage[date].quantity += record.quantity
        stats.dailyUsage[date].cost += cost
      })

      return { data: stats, error: null }
    } catch (error) {
      console.error('Error getting feed usage stats:', error)
      return { data: null, error }
    }
  },

  /**
   * Get current feed stock levels
   */
  async getCurrentStockLevels() {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select(`
          *,
          feed_suppliers (
            name
          )
        `)
        .eq('active', true)
        .order('name')

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Error getting stock levels:', error)
      return { data: null, error }
    }
  },

  /**
   * Get low stock alerts
   */
  async getLowStockAlerts() {
    try {
      // First get all active feed types
      const { data, error } = await supabase
        .from('feed_types')
        .select(`
          *,
          feed_suppliers (
            name
          )
        `)
        .eq('active', true)
        .order('name')

      if (error) throw error

      // Filter for low stock items in JavaScript
      const lowStockItems = data.filter(feed => 
        feed.current_stock <= (feed.minimum_stock * 1.2)
      )

      return { data: lowStockItems, error: null }
    } catch (error) {
      console.error('Error getting low stock alerts:', error)
      return { data: null, error }
    }
  },

  /**
   * Get feed cost analysis
   */
  async getFeedCostAnalysis(timeRange = '30d') {
    try {
      const { data: usageStats, error: usageError } = await this.getFeedUsageStats(timeRange)
      if (usageError) throw usageError

      const { data: stockLevels, error: stockError } = await this.getCurrentStockLevels()
      if (stockError) throw stockError

      const analysis = {
        totalCost: usageStats.totalCost,
        averageCostPerKg: usageStats.totalUsage > 0 ? usageStats.totalCost / usageStats.totalUsage : 0,
        costByFeedType: usageStats.usageByFeedType,
        currentStockValue: stockLevels.reduce((total, feed) => total + (feed.current_stock * feed.price_per_kg), 0),
        costTrends: Object.entries(usageStats.dailyUsage).map(([date, data]) => ({
          date,
          cost: data.cost,
          quantity: data.quantity
        }))
      }

      return { data: analysis, error: null }
    } catch (error) {
      console.error('Error getting feed cost analysis:', error)
      return { data: null, error }
    }
  }
} 