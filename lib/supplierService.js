import { supabase } from './supabase'

export const supplierService = {
  async getAllSuppliers() {
    try {
      console.log('Fetching all suppliers...')
      const { data, error } = await supabase
        .from('feed_suppliers')
        .select('*')
        .order('name')

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Suppliers fetched successfully:', data?.length || 0)
      return { data, error: null }
    } catch (error) {
      console.error('Error in getAllSuppliers:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to fetch suppliers',
          details: error
        }
      }
    }
  },

  async getActiveSuppliers() {
    try {
      console.log('Fetching active suppliers...')
      const { data, error } = await supabase
        .from('feed_suppliers')
        .select('*')
        .eq('active', true)
        .order('name')

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Active suppliers fetched successfully:', data?.length || 0)
      return { data, error: null }
    } catch (error) {
      console.error('Error in getActiveSuppliers:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to fetch active suppliers',
          details: error
        }
      }
    }
  },

  async createSupplier(supplierData) {
    try {
      console.log('Creating new supplier:', supplierData)
      const { data, error } = await supabase
        .from('feed_suppliers')
        .insert([supplierData])
        .select()

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Supplier created successfully:', data)
      return { data, error: null }
    } catch (error) {
      console.error('Error in createSupplier:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to create supplier',
          details: error
        }
      }
    }
  },

  async updateSupplier(id, updates) {
    try {
      console.log('Updating supplier:', { id, updates })
      const { data, error } = await supabase
        .from('feed_suppliers')
        .update(updates)
        .eq('id', id)
        .select()

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Supplier updated successfully:', data)
      return { data, error: null }
    } catch (error) {
      console.error('Error in updateSupplier:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to update supplier',
          details: error
        }
      }
    }
  },

  async deleteSupplier(id) {
    try {
      console.log('Deleting supplier:', id)
      const { error } = await supabase
        .from('feed_suppliers')
        .delete()
        .eq('id', id)

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Supplier deleted successfully')
      return { error: null }
    } catch (error) {
      console.error('Error in deleteSupplier:', error)
      return { 
        error: {
          message: error.message || 'Failed to delete supplier',
          details: error
        }
      }
    }
  },

  async getSupplierById(id) {
    try {
      console.log('Fetching supplier by ID:', id)
      const { data, error } = await supabase
        .from('feed_suppliers')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      console.log('Supplier fetched successfully:', data)
      return { data, error: null }
    } catch (error) {
      console.error('Error in getSupplierById:', error)
      return { 
        data: null, 
        error: {
          message: error.message || 'Failed to fetch supplier',
          details: error
        }
      }
    }
  }
} 