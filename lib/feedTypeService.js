// lib/feedTypeService.js
import { supabase } from './supabase'

const feedTypeService = {
  /**
   * Get all feed types for the current company
   */
  getAllFeedTypes: async () => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select(
          `
          id,
          name,
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
  getActiveFeedTypes: async () => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select(
          `
          id,
          name,
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
        .eq('active', true)
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
  createFeedType: async (feedTypeData) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .insert([
          {
            supplier_id: feedTypeData.supplier_id,
            company_id: feedTypeData.company_id,
            pellet_size: feedTypeData.pellet_size,
            protein_percentage: feedTypeData.protein_percentage,
            price_per_kg: feedTypeData.price_per_kg,
            active: feedTypeData.active || true,
          },
        ])
        .select()

      if (error) throw error
      return { data, error: null }
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
          supplier_id: feedTypeData.supplier_id,
          pellet_size: feedTypeData.pellet_size,
          protein_percentage: feedTypeData.protein_percentage,
          price_per_kg: feedTypeData.price_per_kg,
          active: feedTypeData.active,
        })
        .eq('id', id)
        .select()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error updating feed type:', error)
      return { data: null, error }
    }
  },

  /**
   * Update feed type status (active/inactive)
   */
  updateFeedTypeStatus: async (id, active) => {
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .update({ active })
        .eq('id', id)
        .select()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error updating feed type status:', error)
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
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error deleting feed type:', error)
      return { data: null, error }
    }
  },

  /**
   * Get feed suppliers
   */
  getFeedSuppliers: async () => {
    try {
      const { data, error } = await supabase
        .from('feed_suppliers')
        .select('*')
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
  createFeedSupplier: async (supplierData) => {
    try {
      const { data, error } = await supabase
        .from('feed_suppliers')
        .insert([
          {
            name: supplierData.name,
            abbreviation: supplierData.abbreviation,
            company_id: supplierData.company_id,
            contact_info: supplierData.contact_info,
            website: supplierData.website,
          },
        ])
        .select()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error creating feed supplier:', error)
      return { data: null, error }
    }
  },

  /**
   * Get the last used feed type for a specific cage
   * This helps with auto-selecting the feed type in daily entries
   */
  getLastUsedFeedType: async (cage_id) => {
    try {
      const { data, error } = await supabase
        .from('daily_records')
        .select(
          `
          feed_type_id,
          feed_types (
            id,
            name,
            pellet_size,
            protein_percentage,
            supplier:supplier_id (abbreviation)
          )
        `,
        )
        .eq('cage_id', cage_id)
        .order('date', { ascending: false })
        .limit(1)

      if (error) throw error

      // Return the feed type if found
      if (data && data.length > 0 && data[0].feed_types) {
        return data[0].feed_types
      }

      return null
    } catch (error) {
      console.error('Error fetching last used feed type:', error)
      return null
    }
  },

  /**
   * Get feed inventory levels
   */
  getFeedInventory: async (feed_type_id = null) => {
    try {
      let query = supabase.from('feed_inventory').select(`
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
        `)

      // Filter by feed type if provided
      if (feed_type_id) {
        query = query.eq('feed_type_id', feed_type_id)
      }

      const { data, error } = await query.order('expiry_date')

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching feed inventory:', error)
      return { data: null, error }
    }
  },

  /**
   * Add inventory transaction
   */
  addInventoryTransaction: async (transactionData) => {
    try {
      // First add transaction record
      const {
        data: transactionResult,
        error: transactionError,
      } = await supabase
        .from('feed_inventory_transactions')
        .insert([
          {
            feed_type_id: transactionData.feed_type_id,
            company_id: transactionData.company_id,
            transaction_type: transactionData.transaction_type,
            quantity_kg: transactionData.quantity_kg,
            transaction_date:
              transactionData.transaction_date || new Date().toISOString(),
            reference_id: transactionData.reference_id,
            notes: transactionData.notes,
          },
        ])
        .select()

      if (transactionError) throw transactionError

      // Then update inventory
      if (transactionData.transaction_type === 'purchase') {
        // Check if inventory record exists
        const {
          data: existingInventory,
          error: checkError,
        } = await supabase
          .from('feed_inventory')
          .select('id, quantity_kg')
          .eq('feed_type_id', transactionData.feed_type_id)
          .maybeSingle()

        if (checkError) throw checkError

        if (existingInventory) {
          // Update existing inventory
          const { error: updateError } = await supabase
            .from('feed_inventory')
            .update({
              quantity_kg:
                existingInventory.quantity_kg + transactionData.quantity_kg,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingInventory.id)

          if (updateError) throw updateError
        } else {
          // Create new inventory record
          const { error: insertError } = await supabase
            .from('feed_inventory')
            .insert([
              {
                feed_type_id: transactionData.feed_type_id,
                company_id: transactionData.company_id,
                quantity_kg: transactionData.quantity_kg,
                batch_number: transactionData.batch_number,
                expiry_date: transactionData.expiry_date,
                location: transactionData.location,
              },
            ])

          if (insertError) throw insertError
        }
      } else if (transactionData.transaction_type === 'usage') {
        // Update inventory for usage (subtract)
        const {
          data: existingInventory,
          error: checkError,
        } = await supabase
          .from('feed_inventory')
          .select('id, quantity_kg')
          .eq('feed_type_id', transactionData.feed_type_id)
          .single()

        if (checkError) throw checkError

        const { error: updateError } = await supabase
          .from('feed_inventory')
          .update({
            quantity_kg: Math.max(
              0,
              existingInventory.quantity_kg - transactionData.quantity_kg,
            ),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingInventory.id)

        if (updateError) throw updateError
      }

      return { data: transactionResult, error: null }
    } catch (error) {
      console.error('Error adding inventory transaction:', error)
      return { data: null, error }
    }
  },
}

export default feedTypeService
