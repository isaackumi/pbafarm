// lib/userService.js - Convex version
import { getConvexHttpClient, api } from './convexBridge'

const userService = {
  // Get current user
  getCurrentUser: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.users.current, {})
      return { data, error: null }
    } catch (error) {
      console.error('Error getting current user:', error)
      return { data: null, error }
    }
  },

  // Get user by ID
  getUserById: async (userId) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.users.get, { id: userId })
      return { data, error: null }
    } catch (error) {
      console.error('Error getting user by ID:', error)
      return { data: null, error }
    }
  },

  // List users in company
  listUsers: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.users.list, {})
      return { data, error: null }
    } catch (error) {
      console.error('Error listing users:', error)
      return { data: [], error }
    }
  },

  // Update user profile
  updateUser: async (userId, updates) => {
    try {
      const client = getConvexHttpClient()
      const patch = {}
      
      // Map snake_case to camelCase
      const fieldMap = {
        name: 'name',
        email: 'email',
        role: 'role',
        phone: 'phone',
        active: 'active'
      }

      for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
        if (updates[snakeKey] !== undefined) {
          patch[camelKey] = updates[snakeKey]
        }
        if (updates[camelKey] !== undefined) {
          patch[camelKey] = updates[camelKey]
        }
      }

      await client.mutation(api.users.update, { id: userId, patch })
      const data = await client.query(api.users.get, { id: userId })
      return { data, error: null }
    } catch (error) {
      console.error('Error updating user:', error)
      return { data: null, error }
    }
  },

  // Check if user has role
  hasRole: async (userId, role) => {
    try {
      const { data: user } = await userService.getUserById(userId)
      return user && user.role === role
    } catch (error) {
      return false
    }
  },

  // Check if current user has role
  currentUserHasRole: async (role) => {
    try {
      const { data: user } = await userService.getCurrentUser()
      return user && user.role === role
    } catch (error) {
      return false
    }
  },
}

export default userService