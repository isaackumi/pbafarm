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

  // Upload company logo via Convex storage
  uploadLogo: async (companyId, file) => {
    try {
      const client = getConvexHttpClient()
      const uploadUrl = await client.mutation(
        api.companies.generateLogoUploadUrl,
        {},
      )
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      const { storageId } = await res.json()
      if (!storageId) throw new Error('Upload failed')
      await client.mutation(api.companies.setLogo, { storageId })
      const data = await companyService.getCompanyDetails(companyId)
      return { data: data.data, error: null }
    } catch (error) {
      console.error('Error uploading logo:', error)
      return { data: null, error }
    }
  },

  deleteLogo: async () => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.companies.clearLogo, {})
      return { data: true, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  getSettingsDraft: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.companies.getSettingsDraft, {})
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  saveSettingsDraft: async (draft) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.companies.saveSettingsDraft, { draft })
      return { data: true, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  publishSettings: async (draft) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.mutation(api.companies.publishSettings, {
        draft,
      })
      return { data, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  // List all companies (super_admin)
  getAllCompanies: async (status) => {
    try {
      const client = getConvexHttpClient()
      const args = status ? { status } : {}
      const data = await client.query(api.companies.list, args)
      return { data: data || [], error: null }
    } catch (error) {
      console.error('Error listing companies:', error)
      return { data: null, error }
    }
  },

  // Soft-remove company (super_admin) — marks rejected; does not wipe tenant data
  deleteCompany: async (companyId, reason) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.companies.remove, {
        companyId,
        reason: reason || 'Removed by admin',
      })
      return { data: true, error: null }
    } catch (error) {
      console.error('Error removing company:', error)
      return { data: null, error }
    }
  },

  // Register a new company
  registerCompany: async (companyData) => {
    try {
      const client = getConvexHttpClient()
      const name = (companyData.name || '').trim()
      let code = (
        companyData.code ||
        companyData.abbreviation ||
        ''
      )
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '')
      if (!code && name) {
        code = name
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 8)
      }

      const id = await client.mutation(api.companies.register, {
        name,
        code,
        address:
          companyData.address?.trim() || undefined,
        contactEmail:
          (
            companyData.contactEmail ||
            companyData.contact_email ||
            companyData.email ||
            ''
          ).trim() || undefined,
        contactPhone:
          (
            companyData.contactPhone ||
            companyData.contact_phone ||
            companyData.phone ||
            ''
          ).trim() || undefined,
        abbreviation:
          (
            companyData.abbreviation ||
            companyData.registrationNumber ||
            companyData.registration_number ||
            ''
          ).trim() || undefined,
      })
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