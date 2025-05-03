// lib/stockingService.js
import { supabase } from './supabase'

const stockingService = {
  /**
   * Get all stocking records with cage information
   */
  getAllStockings: async () => {
    try {
      const { data, error } = await supabase
        .from('stocking_history')
        .select(
          `
          *,
          cage:cage_id (
            id,
            name
          )
        `,
        )
        .order('stocking_date', { ascending: false })

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Error fetching stocking records:', error)
      return { data: null, error }
    }
  },

  /**
   * Get active stockings for potential top-up
   */
  getActiveStockings: async () => {
    try {
      const { data, error } = await supabase
        .from('stocking_history')
        .select(
          `
          id,
          batch_number,
          stocking_date,
          fish_count,
          initial_abw,
          initial_biomass,
          cage_id,
          cage:cage_id (
            id,
            name
          )
        `,
        )
        .eq('status', 'approved')
        .is('deleted_at', null)
        .order('stocking_date', { ascending: false })

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Error fetching active stockings:', error)
      return { data: null, error }
    }
  },

  /**
   * Get specific stocking by ID
   */
  getStockingById: async (id) => {
    try {
      const { data, error } = await supabase
        .from('stocking_history')
        .select(
          `
          *,
          cage:cage_id (
            id,
            name
          ),
          topups:topup_history(*)
        `,
        )
        .eq('id', id)
        .single()

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Error fetching stocking details:', error)
      return { data: null, error }
    }
  },

  /**
   * Create a new stocking record
   */
  createStocking: async (stockingData) => {
    try {
      // Prepare the data
      const data = {
        company_id: stockingData.company_id,
        cage_id: stockingData.cage_id,
        batch_number: stockingData.batch_number,
        stocking_date: stockingData.stocking_date,
        fish_count: parseInt(stockingData.fish_count),
        initial_abw: parseFloat(stockingData.initial_abw),
        source_location: stockingData.source_location,
        source_cage: stockingData.source_cage,
        transfer_supervisor: stockingData.transfer_supervisor,
        sampling_supervisor: stockingData.sampling_supervisor,
        status: 'pending_approval', // Requires approval by default
        notes: stockingData.notes,
        created_by: stockingData.created_by,
      }

      // Create stocking
      const { data: result, error } = await supabase
        .from('stocking_history')
        .insert([data])
        .select()

      if (error) throw error

      // Update cage status
      const { error: updateError } = await supabase
        .from('cages')
        .update({ status: 'active' })
        .eq('id', stockingData.cage_id)

      if (updateError) throw updateError

      return { data: result[0], error: null }
    } catch (error) {
      console.error('Error creating stocking:', error)
      return { data: null, error }
    }
  },

  /**
   * Create a top-up record for an existing stocking
   */
  createTopUp: async (topupData) => {
    try {
      // Get the existing stocking information first
      const {
        data: stocking,
        error: stockingError,
      } = await stockingService.getStockingById(topupData.stocking_id)

      if (stockingError) throw stockingError
      if (!stocking) throw new Error('Stocking record not found')

      // Ensure the cage is still active
      const { data: cage, error: cageError } = await supabase
        .from('cages')
        .select('status')
        .eq('id', stocking.cage_id)
        .single()

      if (cageError) throw cageError
      if (cage.status !== 'active')
        throw new Error('Cannot top up a cage that is not active')

      // Prepare the top-up data
      const data = {
        company_id: topupData.company_id,
        stocking_id: topupData.stocking_id,
        topup_date: topupData.topup_date,
        fish_count: parseInt(topupData.fish_count),
        abw: parseFloat(topupData.abw),
        source_location: topupData.source_location,
        transfer_supervisor: topupData.transfer_supervisor,
        status: 'pending_approval', // Requires approval by default
        notes: topupData.notes,
        created_by: topupData.created_by,
      }

      // Create top-up record
      const { data: result, error } = await supabase
        .from('topup_history')
        .insert([data])
        .select()

      if (error) throw error

      return { data: result[0], error: null }
    } catch (error) {
      console.error('Error creating top-up:', error)
      return { data: null, error }
    }
  },

  /**
   * Approve a stocking or top-up record
   */
  approveRecord: async (recordType, recordId, approvedBy) => {
    try {
      const table =
        recordType === 'stocking' ? 'stocking_history' : 'topup_history'

      // Update record status
      const { data, error } = await supabase
        .from(table)
        .update({
          status: 'approved',
          approved_by: approvedBy,
          approved_at: new Date().toISOString(),
        })
        .eq('id', recordId)
        .select()

      if (error) throw error

      // For top-ups, we need to update the estimated counts
      if (recordType === 'topup' && data.length > 0) {
        const topup = data[0]

        // Get the latest biweekly record to update biomass estimation
        const {
          data: latestBiweekly,
          error: biweeklyError,
        } = await supabase
          .from('biweekly_records')
          .select('*')
          .eq('stocking_id', topup.stocking_id)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (biweeklyError) throw biweeklyError

        // If we have a biweekly record, update its estimated_biomass
        // This is a simplified approach - in a real system, you'd want to recalculate based on new fish count and ABW
        if (latestBiweekly) {
          const updatedBiomass =
            latestBiweekly.estimated_biomass +
            (topup.fish_count * topup.abw) / 1000

          const { error: updateError } = await supabase
            .from('biweekly_records')
            .update({ estimated_biomass: updatedBiomass })
            .eq('id', latestBiweekly.id)

          if (updateError) throw updateError
        }
      }

      return { data: data[0], error: null }
    } catch (error) {
      console.error(`Error approving ${recordType}:`, error)
      return { data: null, error }
    }
  },

  /**
   * Reject a stocking or top-up record
   */
  rejectRecord: async (recordType, recordId, rejectedBy, reason) => {
    try {
      const table =
        recordType === 'stocking' ? 'stocking_history' : 'topup_history'

      // Update record status
      const { data, error } = await supabase
        .from(table)
        .update({
          status: 'rejected',
          approved_by: rejectedBy, // Using the same field to track who rejected
          approved_at: new Date().toISOString(),
          notes: reason, // Storing the rejection reason in notes
        })
        .eq('id', recordId)
        .select()

      if (error) throw error

      // If this was a stocking that got rejected, we should set the cage back to its previous status
      if (recordType === 'stocking' && data.length > 0) {
        const stocking = data[0]

        const { error: updateError } = await supabase
          .from('cages')
          .update({ status: 'empty' }) // Or could be 'fallow' depending on your business logic
          .eq('id', stocking.cage_id)

        if (updateError) throw updateError
      }

      return { data: data[0], error: null }
    } catch (error) {
      console.error(`Error rejecting ${recordType}:`, error)
      return { data: null, error }
    }
  },

  /**
   * Get pending approvals for stockings and top-ups
   */
  getPendingApprovals: async () => {
    try {
      // Get pending stocking approvals
      const { data: stockingApprovals, error: stockingError } = await supabase
        .from('stocking_history')
        .select(
          `
          id,
          batch_number,
          stocking_date,
          fish_count,
          initial_abw,
          initial_biomass,
          cage_id,
          created_at,
          created_by,
          cage:cage_id (name)
        `,
        )
        .eq('status', 'pending_approval')
        .is('deleted_at', null)

      if (stockingError) throw stockingError

      // Get pending top-up approvals
      const { data: topupApprovals, error: topupError } = await supabase
        .from('topup_history')
        .select(
          `
          id,
          stocking_id,
          topup_date,
          fish_count,
          abw,
          biomass,
          created_at,
          created_by,
          stocking:stocking_id (
            batch_number,
            cage_id,
            cage:cage_id (name)
          )
        `,
        )
        .eq('status', 'pending_approval')

      if (topupError) throw topupError

      // Format the data for the UI
      const stockings = stockingApprovals.map((s) => ({
        type: 'stocking',
        id: s.id,
        date: s.stocking_date,
        batchNumber: s.batch_number,
        cageName: s.cage?.name || 'Unknown',
        cageId: s.cage_id,
        count: s.fish_count,
        abw: s.initial_abw,
        biomass: s.initial_biomass,
        createdAt: s.created_at,
        createdBy: s.created_by,
      }))

      const topups = topupApprovals.map((t) => ({
        type: 'topup',
        id: t.id,
        date: t.topup_date,
        batchNumber: t.stocking?.batch_number || 'Unknown',
        cageName: t.stocking?.cage?.name || 'Unknown',
        cageId: t.stocking?.cage_id,
        count: t.fish_count,
        abw: t.abw,
        biomass: t.biomass,
        createdAt: t.created_at,
        createdBy: t.created_by,
      }))

      return {
        data: {
          stockings,
          topups,
          all: [...stockings, ...topups].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
          ),
        },
        error: null,
      }
    } catch (error) {
      console.error('Error fetching pending approvals:', error)
      return { data: null, error }
    }
  },
}

export default stockingService
