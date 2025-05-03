// lib/auditLogService.js
import { supabase } from './supabase'

const auditLogService = {
  /**
   * Get audit logs with optional filtering
   * @param {Object} options - Filter options
   * @param {string} options.userId - Filter by user ID
   * @param {string} options.companyId - Filter by company ID
   * @param {string} options.actionType - Filter by action type
   * @param {string} options.tableName - Filter by table name
   * @param {string} options.recordId - Filter by record ID
   * @param {Date} options.fromDate - Filter from date
   * @param {Date} options.toDate - Filter to date
   * @param {number} options.limit - Limit results
   * @param {number} options.offset - Offset for pagination
   */
  getAuditLogs: async (options = {}) => {
    try {
      let query = supabase
        .from('audit_logs')
        .select(
          `
          *,
          user:user_id (
            id,
            email,
            full_name
          )
        `,
        )
        .order('timestamp', { ascending: false })

      // Apply filters
      if (options.userId) {
        query = query.eq('user_id', options.userId)
      }

      if (options.companyId) {
        query = query.eq('company_id', options.companyId)
      }

      if (options.actionType) {
        query = query.eq('action_type', options.actionType)
      }

      if (options.tableName) {
        query = query.eq('table_name', options.tableName)
      }

      if (options.recordId) {
        query = query.eq('record_id', options.recordId)
      }

      if (options.fromDate) {
        query = query.gte('timestamp', options.fromDate.toISOString())
      }

      if (options.toDate) {
        query = query.lte('timestamp', options.toDate.toISOString())
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit)
      }

      if (options.offset) {
        query = query.range(
          options.offset,
          options.offset + (options.limit || 10) - 1,
        )
      }

      const { data, error, count } = await query

      if (error) throw error

      return { data, count, error: null }
    } catch (error) {
      console.error('Error fetching audit logs:', error)
      return { data: null, count: 0, error }
    }
  },

  /**
   * Get audit log details by ID
   * @param {string} id - The audit log ID
   */
  getAuditLogById: async (id) => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select(
          `
          *,
          user:user_id (
            id,
            email,
            full_name
          )
        `,
        )
        .eq('id', id)
        .single()

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Error fetching audit log details:', error)
      return { data: null, error }
    }
  },

  /**
   * Get audit log actions for a specific record
   * @param {string} tableName - The table name
   * @param {string} recordId - The record ID
   */
  getRecordHistory: async (tableName, recordId) => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select(
          `
          id,
          timestamp,
          action_type,
          previous_values,
          new_values,
          user:user_id (
            id,
            email,
            full_name
          )
        `,
        )
        .eq('table_name', tableName)
        .eq('record_id', recordId)
        .order('timestamp', { ascending: false })

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Error fetching record history:', error)
      return { data: null, error }
    }
  },

  /**
   * Create a manual audit log entry
   * This can be used for events that don't trigger database triggers
   * @param {Object} logData - The log data
   */
  createAuditLog: async (logData) => {
    try {
      // Get current user if not provided
      if (!logData.user_id) {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        logData.user_id = user?.id
      }

      // Add timestamp if not provided
      if (!logData.timestamp) {
        logData.timestamp = new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('audit_logs')
        .insert([logData])
        .select()

      if (error) throw error

      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error creating audit log:', error)
      return { data: null, error }
    }
  },

  /**
   * Get audit statistics by action type
   * For dashboard charts and summaries
   * @param {string} companyId - Filter by company ID
   * @param {number} days - Number of days to include
   */
  getActionTypeStats: async (companyId, days = 30) => {
    try {
      // Calculate date range
      const endDate = new Date()
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      // Build query
      let query = supabase
        .from('audit_logs')
        .select('action_type, count', { count: 'exact' })
        .gte('timestamp', startDate.toISOString())
        .lte('timestamp', endDate.toISOString())
        .eq('company_id', companyId)
        .group('action_type')

      const { data, error } = await query

      if (error) throw error

      // Format for chart display
      const formattedData = (data || []).map((item) => ({
        action:
          item.action_type.charAt(0).toUpperCase() + item.action_type.slice(1),
        count: parseInt(item.count, 10),
      }))

      return { data: formattedData, error: null }
    } catch (error) {
      console.error('Error fetching audit stats:', error)
      return { data: null, error }
    }
  },

  /**
   * Get recent activity for the dashboard
   * @param {string} companyId - Filter by company ID
   * @param {number} limit - Number of activities to return
   */
  getRecentActivity: async (companyId, limit = 5) => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select(
          `
          id,
          timestamp,
          action_type,
          table_name,
          record_id,
          user:user_id (
            id,
            email,
            full_name
          )
        `,
        )
        .eq('company_id', companyId)
        .order('timestamp', { ascending: false })
        .limit(limit)

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Error fetching recent activity:', error)
      return { data: null, error }
    }
  },

  /**
   * Calculate total changes per day
   * For timeline charts in dashboard
   * @param {string} companyId - Filter by company ID
   * @param {number} days - Number of days to include
   */
  getChangesTimeline: async (companyId, days = 14) => {
    try {
      // Calculate date range
      const endDate = new Date()
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      // Get all audit logs in date range
      const { data, error } = await supabase
        .from('audit_logs')
        .select('timestamp')
        .eq('company_id', companyId)
        .gte('timestamp', startDate.toISOString())
        .lte('timestamp', endDate.toISOString())
        .order('timestamp', { ascending: true })

      if (error) throw error

      // Group by day
      const dailyCounts = {}

      // Initialize all days to ensure we have entries for days with no activity
      for (let i = 0; i <= days; i++) {
        const date = new Date(startDate)
        date.setDate(date.getDate() + i)
        const dateString = date.toISOString().split('T')[0]
        dailyCounts[dateString] = 0
      }

      // Count activities per day
      data.forEach((log) => {
        const dateString = new Date(log.timestamp).toISOString().split('T')[0]
        dailyCounts[dateString] = (dailyCounts[dateString] || 0) + 1
      })

      // Format for chart display
      const timelineData = Object.entries(dailyCounts).map(([date, count]) => ({
        date,
        changes: count,
      }))

      return { data: timelineData, error: null }
    } catch (error) {
      console.error('Error calculating changes timeline:', error)
      return { data: null, error }
    }
  },

  /**
   * Get user activity distribution
   * For dashboard user activity charts
   * @param {string} companyId - Filter by company ID
   * @param {number} limit - Number of top users to include
   */
  getUserActivityDistribution: async (companyId, limit = 5) => {
    try {
      // Group by user and count activities
      const { data, error } = await supabase
        .from('audit_logs')
        .select(
          `
          user_id,
          user:user_id (
            email,
            full_name
          ),
          count
        `,
        )
        .eq('company_id', companyId)
        .group('user_id, user(email, full_name)')
        .order('count', { ascending: false })
        .limit(limit)

      if (error) throw error

      // Format for chart display
      const formattedData = (data || []).map((item) => ({
        user: item.user?.full_name || item.user?.email || 'Unknown',
        activities: parseInt(item.count, 10),
      }))

      return { data: formattedData, error: null }
    } catch (error) {
      console.error('Error fetching user activity distribution:', error)
      return { data: null, error }
    }
  },
}

export default auditLogService
