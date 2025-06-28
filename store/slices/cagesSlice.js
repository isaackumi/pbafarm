import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { createSelector } from '@reduxjs/toolkit'
import cageService from '../../lib/cageService'

// Async thunks
export const fetchCages = createAsyncThunk(
  'cages/fetchCages',
  async ({ page = 1, pageSize = 50 }, { rejectWithValue }) => {
    try {
      const response = await cageService.getAllCages(page, pageSize)
      if (response.error) throw response.error
      return response
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const fetchActiveCages = createAsyncThunk(
  'cages/fetchActiveCages',
  async (_, { rejectWithValue }) => {
    try {
      const response = await cageService.getActiveCages()
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const fetchHarvestReadyCages = createAsyncThunk(
  'cages/fetchHarvestReadyCages',
  async (_, { rejectWithValue }) => {
    try {
      const response = await cageService.getActiveCages()
      if (response.error) throw response.error
      // Filter cages that are ready for harvest based on growth metrics
      const harvestReadyCages = response.data.filter(cage => {
        const daysOfCulture = cage.stocking_date ? 
          Math.floor((new Date() - new Date(cage.stocking_date)) / (1000 * 60 * 60 * 24)) : 0
        return daysOfCulture >= 180 && cage.growth_rate >= 80 // Example criteria
      })
      return harvestReadyCages
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const fetchMaintenanceCages = createAsyncThunk(
  'cages/fetchMaintenanceCages',
  async (_, { rejectWithValue }) => {
    try {
      const response = await cageService.getActiveCages()
      if (response.error) throw response.error
      // Filter cages that need maintenance
      const maintenanceCages = response.data.filter(cage => {
        if (!cage.last_maintenance_date) return true
        const daysSinceMaintenance = Math.floor(
          (new Date() - new Date(cage.last_maintenance_date)) / (1000 * 60 * 60 * 24)
        )
        return daysSinceMaintenance >= 30 // Example: maintenance needed every 30 days
      })
      return maintenanceCages
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const updateCageMetrics = createAsyncThunk(
  'cages/updateCageMetrics',
  async ({ cageId, metrics }, { rejectWithValue }) => {
    try {
      const response = await cageService.updateCageMetrics(cageId, metrics)
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const calculateGrowthMetrics = createAsyncThunk(
  'cages/calculateGrowthMetrics',
  async (cageId, { rejectWithValue }) => {
    try {
      const response = await cageService.calculateGrowthMetrics(cageId)
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

const initialState = {
  cages: [],
  activeCages: [],
  harvestReadyCages: [],
  maintenanceCages: [],
  currentPage: 1,
  totalPages: 1,
  totalCount: 0,
  loading: false,
  error: null,
  analytics: {
    totalCages: 0,
    activeCages: 0,
    harvestReadyCages: 0,
    maintenanceCages: 0,
    averageGrowthRate: 0,
    averageMortalityRate: 0
  }
}

const cagesSlice = createSlice({
  name: 'cages',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    setCurrentPage: (state, action) => {
      state.currentPage = action.payload
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch all cages
      .addCase(fetchCages.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchCages.fulfilled, (state, action) => {
        state.loading = false
        state.cages = action.payload.data
        state.totalPages = action.payload.totalPages
        state.totalCount = action.payload.totalCount
        state.error = null
      })
      .addCase(fetchCages.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      // Fetch active cages
      .addCase(fetchActiveCages.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchActiveCages.fulfilled, (state, action) => {
        state.loading = false
        state.activeCages = action.payload
        state.analytics.activeCages = action.payload.length
        state.error = null
      })
      .addCase(fetchActiveCages.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      // Fetch harvest ready cages
      .addCase(fetchHarvestReadyCages.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchHarvestReadyCages.fulfilled, (state, action) => {
        state.loading = false
        state.harvestReadyCages = action.payload
        state.analytics.harvestReadyCages = action.payload.length
        state.error = null
      })
      .addCase(fetchHarvestReadyCages.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      // Fetch maintenance cages
      .addCase(fetchMaintenanceCages.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchMaintenanceCages.fulfilled, (state, action) => {
        state.loading = false
        state.maintenanceCages = action.payload
        state.analytics.maintenanceCages = action.payload.length
        state.error = null
      })
      .addCase(fetchMaintenanceCages.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      // Update cage metrics
      .addCase(updateCageMetrics.fulfilled, (state, action) => {
        const updatedCage = action.payload
        // Update in all relevant arrays
        state.cages = state.cages.map(cage => 
          cage.id === updatedCage.id ? updatedCage : cage
        )
        state.activeCages = state.activeCages.map(cage => 
          cage.id === updatedCage.id ? updatedCage : cage
        )
        state.harvestReadyCages = state.harvestReadyCages.map(cage => 
          cage.id === updatedCage.id ? updatedCage : cage
        )
        state.maintenanceCages = state.maintenanceCages.map(cage => 
          cage.id === updatedCage.id ? updatedCage : cage
        )
      })
      // Calculate growth metrics
      .addCase(calculateGrowthMetrics.fulfilled, (state, action) => {
        const updatedCage = action.payload
        // Update in all relevant arrays
        state.cages = state.cages.map(cage => 
          cage.id === updatedCage.id ? updatedCage : cage
        )
        state.activeCages = state.activeCages.map(cage => 
          cage.id === updatedCage.id ? updatedCage : cage
        )
        state.harvestReadyCages = state.harvestReadyCages.map(cage => 
          cage.id === updatedCage.id ? updatedCage : cage
        )
        state.maintenanceCages = state.maintenanceCages.map(cage => 
          cage.id === updatedCage.id ? updatedCage : cage
        )
        // Update analytics
        const activeCages = state.activeCages
        if (activeCages.length > 0) {
          state.analytics.averageGrowthRate = activeCages.reduce(
            (sum, cage) => sum + (parseFloat(cage.growth_rate) || 0), 0
          ) / activeCages.length
          state.analytics.averageMortalityRate = activeCages.reduce(
            (sum, cage) => sum + (parseFloat(cage.mortality_rate) || 0), 0
          ) / activeCages.length
        }
      })
  }
})

export const { clearError, setCurrentPage } = cagesSlice.actions

// Selectors
export const selectCages = (state) => state.cages.cages
export const selectActiveCages = (state) => state.cages.activeCages
export const selectHarvestReadyCages = (state) => state.cages.harvestReadyCages
export const selectMaintenanceCages = (state) => state.cages.maintenanceCages
export const selectCagesLoading = (state) => state.cages.loading
export const selectCagesError = (state) => state.cages.error

// Memoized selector for pagination
export const selectCagesPagination = createSelector(
  [(state) => state.cages.currentPage, 
   (state) => state.cages.totalPages,
   (state) => state.cages.totalCount],
  (currentPage, totalPages, totalCount) => ({
    currentPage,
    totalPages,
    totalCount
  })
)

export const selectCagesAnalytics = (state) => state.cages.analytics

export default cagesSlice.reducer 