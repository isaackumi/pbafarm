import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { analyticsService } from '../../lib/databaseService'

// Async thunks using Convex services
export const fetchDashboardData = createAsyncThunk(
  'dashboard/fetchDashboardData',
  async (_, { rejectWithValue }) => {
    try {
      const [summaryStats, harvestReadiness, statusDistribution] = await Promise.all([
        analyticsService.getCageSummaryStats(),
        analyticsService.getHarvestReadiness(),
        analyticsService.getStatusDistribution()
      ])

      if (summaryStats.error) throw summaryStats.error
      if (harvestReadiness.error) throw harvestReadiness.error
      if (statusDistribution.error) throw statusDistribution.error

      return {
        summaryStats: summaryStats.data,
        harvestReadiness: harvestReadiness.data,
        statusDistribution: statusDistribution.data
      }
    } catch (error) {
      return rejectWithValue(error.message || 'Failed to fetch dashboard data')
    }
  }
)

const initialState = {
  summaryStats: null,
  harvestReadiness: null,
  statusDistribution: null,
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
    resetDashboard: (state) => {
      return initialState
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDashboardData.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchDashboardData.fulfilled, (state, action) => {
        state.loading = false
        state.summaryStats = action.payload.summaryStats
        state.harvestReadiness = action.payload.harvestReadiness
        state.statusDistribution = action.payload.statusDistribution
        state.error = null
      })
      .addCase(fetchDashboardData.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
  }
})

export const { clearError, resetDashboard } = dashboardSlice.actions

// Selectors
export const selectSummaryStats = (state) => state.dashboard.summaryStats
export const selectHarvestReadiness = (state) => state.dashboard.harvestReadiness
export const selectStatusDistribution = (state) => state.dashboard.statusDistribution
export const selectDashboardLoading = (state) => state.dashboard.loading
export const selectDashboardError = (state) => state.dashboard.error

export default dashboardSlice.reducer