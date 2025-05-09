// lib/feedTypeService.js
import { supabase } from './supabase'
import { useAuth } from '../contexts/AuthContext'

const feedTypeService = {
  /**
   * Get all feed types for the current company
   */
  getAllFeedTypes: async (companyId) => {
    try {
      // If no companyId is provided, get it from the user's profile
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
        .from('feed_types')
        .select(
          `
          id,
          name,
          company_id,
          pellet_size,
          protein_percentage,
          price_per_kg,
          active,
          created_at,
          supplier:supplier_id (
            id,
            name,
            abbreviation
          )
        `,
        )
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching feed types:', error)
      return { data: null, error }
    }
  },

  /**
   * Get only active feed types
   */
  getActiveFeedTypes: async (companyId) => {
    try {
      // If no companyId is provided, get it from the user's profile
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
        .from('feed_types')
        .select(
          `
          id,
          name,
          company_id,
          pellet_size,
          protein_percentage,
          price_per_kg,
          active,
          created_at,
          supplier:supplier_id (
            id,
            name,
            abbreviation
          )
        `,
        )
        .eq('company_id', companyId)
        .eq('active', true)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching active feed types:', error)
      return { data: null, error }
    }
  },

  /**
   * Get a specific feed type by ID
   */
  getFeedTypeById: async (id) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select(
          `
          id,
          name,
          company_id,
          pellet_size,
          protein_percentage,
          price_per_kg,
          active,
          created_at,
          supplier:supplier_id (
            id,
            name,
            abbreviation
          )
        `,
        )
        .eq('id', id)
        .single()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching feed type:', error)
      return { data: null, error }
    }
  },

  /**
   * Create a new feed type
   */
  createFeedType: async (feedTypeData, companyId) => {
    try {
      // If no companyId is provided, get it from the user's profile
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
        .from('feed_types')
        .insert([
          {
            ...feedTypeData,
            company_id: companyId,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ])
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error creating feed type:', error)
      return { data: null, error }
    }
  },

  /**
   * Update an existing feed type
   */
  updateFeedType: async (id, feedTypeData) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .update({
          ...feedTypeData,
          updated_at: new Date(),
        })
        .eq('id', id)
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error updating feed type:', error)
      return { data: null, error }
    }
  },

  /**
   * Delete a feed type (soft delete)
   */
  deleteFeedType: async (id) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .update({
          deleted_at: new Date(),
          active: false,
        })
        .eq('id', id)
        .select()

      if (error) throw error
      return { success: true, data: data[0], error: null }
    } catch (error) {
      console.error('Error deleting feed type:', error)
      return { success: false, data: null, error }
    }
  },

  /**
   * Get feed suppliers for the current company
   */
  getFeedSuppliers: async (companyId) => {
    try {
      // If no companyId is provided, get it from the user's profile
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
        .from('feed_suppliers')
        .select('*')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('name')

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching feed suppliers:', error)
      return { data: null, error }
    }
  },

  /**
   * Create a new feed supplier
   */
  createFeedSupplier: async (supplierData, companyId) => {
    try {
      // If no companyId is provided, get it from the user's profile
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
        .from('feed_suppliers')
        .insert([
          {
            ...supplierData,
            company_id: companyId,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ])
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error creating feed supplier:', error)
      return { data: null, error }
    }
  },

  /**
   * Get the last used feed type for a specific cage
   */
  getLastUsedFeedType: async (cageId) => {
    try {
      // Call the database function
      const { data, error } = await supabase.rpc('get_last_used_feed_type', {
        cage_id_param: cageId,
      })

      if (error) throw error

      // If no data, return null
      if (!data || data.length === 0) return null

      return data[0]
    } catch (error) {
      console.error('Error fetching last used feed type:', error)
      return null
    }
  },

  /**
   * Add inventory transaction
   */
  addInventoryTransaction: async (transactionData, companyId) => {
    try {
      // If no companyId is provided, get it from the user's profile
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

      // First add transaction record
      const {
        data: transactionResult,
        error: transactionError,
      } = await supabase
        .from('feed_inventory_transactions')
        .insert([
          {
            feed_type_id: transactionData.feed_type_id,
            company_id: companyId,
            transaction_type: transactionData.transaction_type,
            quantity_kg: transactionData.quantity_kg,
            transaction_date:
              transactionData.transaction_date || new Date().toISOString(),
            reference_id: transactionData.reference_id,
            notes: transactionData.notes,
            created_by: transactionData.created_by,
          },
        ])
        .select()

      if (transactionError) throw transactionError

      // Based on transaction type, update inventory
      if (transactionData.transaction_type === 'purchase') {
        // Check if inventory exists
        const {
          data: existingInventory,
          error: inventoryError,
        } = await supabase
          .from('feed_inventory')
          .select('id, quantity_kg')
          .eq('feed_type_id', transactionData.feed_type_id)
          .eq('company_id', companyId)
          .maybeSingle()

        if (inventoryError) throw inventoryError

        if (existingInventory) {
          // Update existing inventory
          const newQuantity =
            existingInventory.quantity_kg +
            parseFloat(transactionData.quantity_kg)

          const { error: updateError } = await supabase
            .from('feed_inventory')
            .update({
              quantity_kg: newQuantity,
              updated_at: new Date(),
            })
            .eq('id', existingInventory.id)

          if (updateError) throw updateError
        } else {
          // Create new inventory record
          const { error: createError } = await supabase
            .from('feed_inventory')
            .insert([
              {
                feed_type_id: transactionData.feed_type_id,
                company_id: companyId,
                quantity_kg: parseFloat(transactionData.quantity_kg),
                batch_number: transactionData.batch_number,
                expiry_date: transactionData.expiry_date,
                location: transactionData.location,
              },
            ])

          if (createError) throw createError
        }
      } else if (transactionData.transaction_type === 'usage') {
        // Update inventory for usage
        const { data: inventory, error: inventoryError } = await supabase
          .from('feed_inventory')
          .select('id, quantity_kg')
          .eq('feed_type_id', transactionData.feed_type_id)
          .eq('company_id', companyId)
          .single()

        if (inventoryError) throw inventoryError

        // Calculate new quantity, ensure it doesn't go below 0
        const newQuantity = Math.max(
          0,
          inventory.quantity_kg - parseFloat(transactionData.quantity_kg),
        )

        const { error: updateError } = await supabase
          .from('feed_inventory')
          .update({
            quantity_kg: newQuantity,
            updated_at: new Date(),
          })
          .eq('id', inventory.id)

        if (updateError) throw updateError
      }

      return { data: transactionResult[0], error: null }
    } catch (error) {
      console.error('Error adding inventory transaction:', error)
      return { data: null, error }
    }
  },

  /**
   * Get feed inventory
   */
  getFeedInventory: async (companyId) => {
    try {
      // If no companyId is provided, get it from the user's profile
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
        .from('feed_inventory')
        .select(
          `
          id,
          feed_type_id,
          quantity_kg,
          batch_number,
          expiry_date,
          location,
          created_at,
          feed_type:feed_type_id (
            id,
            name,
            pellet_size,
            protein_percentage,
            supplier:supplier_id (
              id,
              name,
              abbreviation
            )
          )
        `,
        )
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching feed inventory:', error)
      return { data: null, error }
    }
  },
}

export default feedTypeService
