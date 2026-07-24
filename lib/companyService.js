// companyService.js - Convex Implementation
import { getConvexHttpClient, api } from './convexBridge'

const companyService = {
  // Get company details
  getCompanyDetails: async (companyId) => {
    try {
      const client = getConvexHttpClient()
      
      // If companyId is not provided, get the current user's company
      if (!companyId) {
        const currentUser = await client.query(api.users.current, {})
        if (!currentUser) throw new Error('User not authenticated')
        companyId = currentUser.companyId
      }

      const data = await client.query(api.companies.get, { id: companyId })
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching company details:', error)
      return { data: null, error }
    }
  },

  // Update company details
  updateCompany: async (companyId, companyData) => {
    try {
      const client = getConvexHttpClient()
      const patch = {}
      
      // Map snake_case to camelCase
      const fieldMap = {
        name: 'name',
        address: 'address',
        phone: 'phone',
        email: 'email',
        registration_number: 'registrationNumber',
        logo_url: 'logoUrl',
        status: 'status',
        settings: 'settings'
      }

      for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
        if (companyData[snakeKey] !== undefined) {
          patch[camelKey] = companyData[snakeKey]
        }
        if (companyData[camelKey] !== undefined) {
          patch[camelKey] = companyData[camelKey]
        }
      }

      await client.mutation(api.companies.update, { id: companyId, patch })
      const data = await client.query(api.companies.get, { id: companyId })
      return { data, error: null }
    } catch (error) {
      console.error('Error updating company:', error)
      return { data: null, error }
    }
  },

  // Upload company logo (simplified - just update URL)
  uploadLogo: async (companyId, logoUrl) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.companies.update, { 
        id: companyId, 
        patch: { logoUrl } 
      })
      const data = await client.query(api.companies.get, { id: companyId })
      return { data, error: null }
    } catch (error) {
      console.error('Error uploading logo:', error)
      return { data: null, error }
    }
  },

  // Register a new company
  registerCompany: async (companyData) => {
    try {
      const client = getConvexHttpClient()
      const patch = {}
      
      // Map snake_case to camelCase
      const fieldMap = {
        name: 'name',
        address: 'address',
        phone: 'phone',
        email: 'email',
        registration_number: 'registrationNumber'
      }

      for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
        if (companyData[snakeKey] !== undefined) {
          patch[camelKey] = companyData[snakeKey]
        }
        if (companyData[camelKey] !== undefined) {
          patch[camelKey] = companyData[camelKey]
        }
      }

      const id = await client.mutation(api.companies.register, patch)
      const data = await client.query(api.companies.get, { id })
      return { data, error: null }
    } catch (error) {
      console.error('Error registering company:', error)
      return { data: null, error }
    }
  },

  // List pending company registrations (admin only)
  listPendingRegistrations: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.companies.listPending, {})
      return { data, error: null }
    } catch (error) {
      console.error('Error listing pending registrations:', error)
      return { data: null, error }
    }
  },

  // Approve company registration (admin only)
  approveRegistration: async (companyId) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.companies.approve, { id: companyId })
      const data = await client.query(api.companies.get, { id: companyId })
      return { data, error: null }
    } catch (error) {
      console.error('Error approving registration:', error)
      return { data: null, error }
    }
  },

  // Reject company registration (admin only)
  rejectRegistration: async (companyId, reason) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.companies.reject, { id: companyId, reason })
      const data = await client.query(api.companies.get, { id: companyId })
      return { data, error: null }
    } catch (error) {
      console.error('Error rejecting registration:', error)
      return { data: null, error }
    }
  },
}

export default companyService