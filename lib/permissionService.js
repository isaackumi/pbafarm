// lib/permissionService.js - Convex version
import { getConvexHttpClient, api } from './convexBridge'

const permissionService = {
  // Check if user has permission
  hasPermission: async (userId, permission) => {
    try {
      const client = getConvexHttpClient()
      const user = await client.query(api.users.get, { id: userId })
      
      if (!user) return false
      
      // Basic role-based permissions
      const rolePermissions = {
        admin: ['*'], // Admin has all permissions
        manager: [
          'cage.read', 'cage.create', 'cage.update', 'cage.delete',
          'daily.read', 'daily.create', 'daily.update', 'daily.delete',
          'biweekly.read', 'biweekly.create', 'biweekly.update', 'biweekly.delete',
          'harvest.read', 'harvest.create', 'harvest.update', 'harvest.delete',
          'stocking.read', 'stocking.create', 'stocking.update', 'stocking.approve',
          'feed.read', 'feed.create', 'feed.update', 'feed.delete',
          'reports.read', 'reports.generate',
          'users.read', 'users.create', 'users.update'
        ],
        operator: [
          'cage.read',
          'daily.read', 'daily.create', 'daily.update',
          'biweekly.read', 'biweekly.create', 'biweekly.update',
          'harvest.read', 'harvest.create',
          'stocking.read', 'stocking.create',
          'feed.read', 'feed.create',
          'reports.read'
        ],
        viewer: [
          'cage.read',
          'daily.read',
          'biweekly.read',
          'harvest.read',
          'stocking.read',
          'feed.read',
          'reports.read'
        ]
      }
      
      const userPermissions = rolePermissions[user.role] || []
      return userPermissions.includes('*') || userPermissions.includes(permission)
    } catch (error) {
      console.error('Error checking permission:', error)
      return false
    }
  },

  // Check if current user has permission
  currentUserHasPermission: async (permission) => {
    try {
      const client = getConvexHttpClient()
      const user = await client.query(api.users.current, {})
      return user ? await permissionService.hasPermission(user._id, permission) : false
    } catch (error) {
      console.error('Error checking current user permission:', error)
      return false
    }
  },

  // Check if user has role
  hasRole: async (userId, role) => {
    try {
      const client = getConvexHttpClient()
      const user = await client.query(api.users.get, { id: userId })
      return user && user.role === role
    } catch (error) {
      console.error('Error checking role:', error)
      return false
    }
  },

  // Check if current user has role
  currentUserHasRole: async (role) => {
    try {
      const client = getConvexHttpClient()
      const user = await client.query(api.users.current, {})
      return user && user.role === role
    } catch (error) {
      console.error('Error checking current user role:', error)
      return false
    }
  },

  // Check if user is admin
  isAdmin: async (userId) => {
    return await permissionService.hasRole(userId, 'admin')
  },

  // Check if current user is admin
  currentUserIsAdmin: async () => {
    return await permissionService.currentUserHasRole('admin')
  },

  // Get user permissions
  getUserPermissions: async (userId) => {
    try {
      const client = getConvexHttpClient()
      const user = await client.query(api.users.get, { id: userId })
      
      if (!user) return []
      
      const rolePermissions = {
        admin: ['*'],
        manager: [
          'cage.*', 'daily.*', 'biweekly.*', 'harvest.*', 'stocking.*', 
          'feed.*', 'reports.*', 'users.read', 'users.create', 'users.update'
        ],
        operator: [
          'cage.read', 'daily.*', 'biweekly.*', 'harvest.create',
          'stocking.create', 'feed.create', 'reports.read'
        ],
        viewer: [
          'cage.read', 'daily.read', 'biweekly.read', 'harvest.read',
          'stocking.read', 'feed.read', 'reports.read'
        ]
      }
      
      return rolePermissions[user.role] || []
    } catch (error) {
      console.error('Error getting user permissions:', error)
      return []
    }
  },
}

export default permissionService