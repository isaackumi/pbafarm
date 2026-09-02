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

      // active is handled via deactivate/reactivate
      if (patch.active === false) {
        await client.mutation(api.users.deactivate, { id: userId })
        delete patch.active
      } else if (patch.active === true) {
        await client.mutation(api.users.reactivate, { id: userId })
        delete patch.active
      }

      if (Object.keys(patch).length) {
        await client.mutation(api.users.update, { id: userId, patch })
      }
      const data = await client.query(api.users.get, { id: userId })
      return { data, error: null }
    } catch (error) {
      console.error('Error updating user:', error)
      return { data: null, error }
    }
  },

  inviteUser: async ({ email, name, role }) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.mutation(api.users.invite, {
        email,
        name,
        role: role || 'user',
      })
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  createUserWithPassword: async ({ email, name, role, password }) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.action(api.userAccounts.createWithPassword, {
        email,
        name,
        role: role || 'user',
        password,
      })
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  changePassword: async ({ currentPassword, newPassword }) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.action(api.userAccounts.changePassword, {
        currentPassword,
        newPassword,
      })
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  deactivateUser: async (userId) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.users.deactivate, { id: userId })
      return { data: true, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  reactivateUser: async (userId) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.users.reactivate, { id: userId })
      return { data: true, error: null }
    } catch (error) {
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