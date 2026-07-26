// companyService.js - Convex Implementation
import { getConvexHttpClient, api } from './convexBridge'

const companyService = {
  // Get company details
  getCompanyDetails: async (companyId) => {
    try {
      const client = getConvexHttpClient()

      if (!companyId) {
        const data = await client.query(api.companies.getCurrentCompany, {})
        return { data, error: null }
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

      if (companyData.name !== undefined) patch.name = companyData.name
      if (companyData.address !== undefined) patch.address = companyData.address
      if (
        companyData.contact_email !== undefined ||
        companyData.contactEmail !== undefined
      ) {
        patch.contactEmail =
          companyData.contact_email ?? companyData.contactEmail
      }
      if (
        companyData.ai_assistant_enabled !== undefined ||
        companyData.aiAssistantEnabled !== undefined
      ) {
        patch.aiAssistantEnabled =
          companyData.ai_assistant_enabled ?? companyData.aiAssistantEnabled
      }
      if (companyData.settings?.ai_assistant_enabled !== undefined) {
        patch.aiAssistantEnabled = companyData.settings.ai_assistant_enabled
      }
      if (companyData.settings?.aiAssistantEnabled !== undefined) {
        patch.aiAssistantEnabled = companyData.settings.aiAssistantEnabled
      }

      await client.mutation(api.companies.updateSettings, {
        id: companyId,
        patch,
      })
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
      // Logo storage not wired on Convex yet — keep API shape stable
      const data = await companyService.getCompanyDetails(companyId)
      return { data: data.data, error: null }
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

  // Approve company registration (super_admin) — promote userId to company admin
  approveRegistration: async (companyId, userId) => {
    try {
      const client = getConvexHttpClient()
      const args = { companyId }
      if (userId) args.userId = userId
      await client.mutation(api.companies.approve, args)
      const data = await client.query(api.companies.get, { id: companyId })
      return { data, error: null }
    } catch (error) {
      console.error('Error approving registration:', error)
      return { data: null, error }
    }
  },

  // Reject company registration (super_admin)
  rejectRegistration: async (companyId, reason) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.companies.reject, { companyId, reason })
      const data = await client.query(api.companies.get, { id: companyId })
      return { data, error: null }
    } catch (error) {
      console.error('Error rejecting registration:', error)
      return { data: null, error }
    }
  },
}

export default companyService