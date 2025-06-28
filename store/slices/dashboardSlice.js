import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { supabase } from '../../lib/supabase'

// Async thunks
export const fetchDashboardStats = createAsyncThunk(
  'dashboard/fetchStats',
  async () => {
    try {
      // Fetch active cages
      const { data: activeCages, error: cagesError } = await supabase
        .from('cages')
        .select('*')
        .eq('status', 'active')

      if (cagesError) throw cagesError

      // Fetch recent biweekly records with sampling data
      const { data: recentRecords, error: recordsError } = await supabase
        .from('biweekly_records')
        .select(`
          *,
          biweekly_sampling (
            id,
            sampling_number,
            fish_count,
            total_weight,
            average_body_weight
          )
        `)
        .order('date', { ascending: false })
        .limit(5)

      if (recordsError) throw recordsError

      // Fetch feed inventory
      const { data: feedInventory, error: feedError } = await supabase
        .from('feed_types')
        .select('*')
        .eq('active', true)

      if (feedError) throw feedError

      // Calculate statistics
      const statistics = {
        totalFish: activeCages.reduce((sum, cage) => sum + (cage.initial_count || 0), 0),
        totalBiomass: activeCages.reduce((sum, cage) => sum + (cage.initial_biomass || 0), 0),
        activeCageCount: activeCages.length,
        lowStockFeeds: feedInventory.filter(feed => feed.current_stock < feed.minimum_stock).length
      }

      return {
        activeCages,
        recentRecords,
        feedInventory,
        statistics
      }
    } catch (error) {
      console.error('Error fetching dashboard stats:', error)
      throw error
    }
  }
)

const initialState = {
  activeCages: [],
  recentRecords: [],
  feedInventory: [],
  statistics: {
    totalFish: 0,
    totalBiomass: 0,
    activeCageCount: 0,
    lowStockFeeds: 0
  },
  loading: false,
  error: null
}

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    resetState: (state) => {
      return initialState
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDashboardStats.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchDashboardStats.fulfilled, (state, action) => {
        state.loading = false
        state.activeCages = action.payload.activeCages
        state.recentRecords = action.payload.recentRecords
        state.feedInventory = action.payload.feedInventory
        state.statistics = action.payload.statistics
      })
      .addCase(fetchDashboardStats.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
      })
  }
})

export const { clearError, resetState } = dashboardSlice.actions
export default dashboardSlice.reducer 