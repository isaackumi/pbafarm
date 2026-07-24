// lib/auditLogService.js - Convex version
import { getConvexHttpClient, api } from './convexBridge'

const auditLogService = {
  // Get audit logs
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

  // Get audit log by ID
  getAuditLog: async (logId) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.audit.get, { id: logId })
      return { data, error: null }
    } catch (error) {
      console.error('Error getting audit log:', error)
      return { data: null, error }
    }
  },

  // Create audit log entry
  createAuditLog: async (logData) => {
    try {
      const client = getConvexHttpClient()
      const patch = {}
      
      // Map snake_case to camelCase
      const fieldMap = {
        user_id: 'userId',
        action: 'action',
        resource_type: 'resourceType',
        resource_id: 'resourceId',
        details: 'details',
        ip_address: 'ipAddress',
        user_agent: 'userAgent'
      }

      for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
        if (logData[snakeKey] !== undefined) {
          patch[camelKey] = logData[snakeKey]
        }
        if (logData[camelKey] !== undefined) {
          patch[camelKey] = logData[camelKey]
        }
      }

      const id = await client.mutation(api.audit.create, patch)
      const data = await client.query(api.audit.get, { id })
      return { data, error: null }
    } catch (error) {
      console.error('Error creating audit log:', error)
      return { data: null, error }
    }
  },

  // Get logs by user
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

  // Get logs by resource
  getLogsByResource: async (resourceType, resourceId) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.audit.getByResource, { resourceType, resourceId })
      return { data, error: null }
    } catch (error) {
      console.error('Error getting logs by resource:', error)
      return { data: [], error }
    }
  },

  // Get recent activity
  getRecentActivity: async (limit = 50) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.audit.getRecent, { limit })
      return { data, error: null }
    } catch (error) {
      console.error('Error getting recent activity:', error)
      return { data: [], error }
    }
  },
}

export default auditLogService