// lib/auditLogService.js - Convex version
import { getConvexHttpClient, api } from './convexBridge'

const auditLogService = {
  getAuditLogs: async (filters = {}) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.audit.list, filters)
      return { data, error: null }
    } catch (error) {
      console.error('Error getting audit logs:', error)
      return { data: [], error }
    }
  },

  getSummary: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.audit.getSummary, {})
      return { data, error: null }
    } catch (error) {
      console.error('Error getting audit summary:', error)
      return { data: null, error }
    }
  },

  getLogsByUser: async (userId, limit = 100) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.audit.getByUser, { userId, limit })
      return { data, error: null }
    } catch (error) {
      console.error('Error getting logs by user:', error)
      return { data: [], error }
    }
  },

  getLogsByTable: async (tableName, recordId, limit = 100) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.audit.getByTable, {
        tableName,
        recordId,
        limit,
      })
      return { data, error: null }
    } catch (error) {
      console.error('Error getting logs by table:', error)
      return { data: [], error }
    }
  },

  getRecentActivity: async (limit = 50) => {
    return auditLogService.getAuditLogs({ limit })
  },
}

export default auditLogService
