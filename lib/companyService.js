// companyService.js - Implementation
import { supabase } from './supabase'

const companyService = {
  // Get company details
  getCompanyDetails: async (companyId) => {
    try {
      // If companyId is not provided, get the user's company
      if (!companyId) {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) throw new Error('User not authenticated')

        // Get user's profile to find company ID
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', user.id)
          .single()

        if (profileError) throw profileError

        companyId = profile.company_id
      }

      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching company details:', error)
      return { data: null, error }
    }
  },

  // Update company details
  updateCompany: async (companyId, companyData) => {
    try {
      const { data, error } = await supabase
        .from('companies')
        .update(companyData)
        .eq('id', companyId)
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error updating company:', error)
      return { data: null, error }
    }
  },

  // Upload company logo
  uploadLogo: async (companyId, file) => {
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${companyId}-logo-${Date.now()}.${fileExt}`
      const filePath = `company_logos/${fileName}`

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('company_assets')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from('company_assets').getPublicUrl(filePath)

      // Update company with new logo URL
      const { data, error } = await supabase
        .from('companies')
        .update({ logo_url: publicUrl })
        .eq('id', companyId)
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error uploading logo:', error)
      return { data: null, error }
    }
  },
}

export default companyService
