import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { feedService } from '../../lib/feedService'

export const fetchFeedData = createAsyncThunk('feed/fetchFeedData', async (_, { rejectWithValue }) => {
  try {
    const [purchasesResponse, usageStatsResponse] = await Promise.all([
      feedService.getAllPurchases(),
      feedService.getFeedUsageStats(),
    ])
    if (purchasesResponse.error) throw purchasesResponse.error
    if (usageStatsResponse.error) throw usageStatsResponse.error
    return {
      purchases: purchasesResponse.data,
      usageStats: usageStatsResponse.data,
    }
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

export const fetchFeedTypes = createAsyncThunk('feed/fetchFeedTypes', async (_, { rejectWithValue }) => {
  try {
    const response = await feedService.getAllFeedTypes()
    if (response.error) throw response.error
    return response.data
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

export const createFeedType = createAsyncThunk('feed/createFeedType', async (form, { rejectWithValue, dispatch }) => {
  try {
    const response = await feedService.createFeedType(form)
    if (response.error) throw response.error
    dispatch(fetchFeedTypes())
    return response.data
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

export const updateFeedType = createAsyncThunk(
  'feed/updateFeedType',
  async ({ id, updates }, { rejectWithValue, dispatch }) => {
    try {
      const response = await feedService.updateFeedType(id, updates)
      if (response.error) throw response.error
      dispatch(fetchFeedTypes())
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

export const deleteFeedType = createAsyncThunk('feed/deleteFeedType', async (id, { rejectWithValue, dispatch }) => {
  try {
    const response = await feedService.deleteFeedType(id)
    if (response.error) throw response.error
    dispatch(fetchFeedTypes())
    return id
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

export const fetchLowStockAlerts = createAsyncThunk('feed/fetchLowStockAlerts', async (_, { rejectWithValue }) => {
  try {
    const response = await feedService.getLowStockAlerts()
    if (response.error) throw response.error
    return response.data
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

export const recordFeedUsage = createAsyncThunk('feed/recordFeedUsage', async (usageData, { rejectWithValue }) => {
  try {
    const response = await feedService.recordFeedUsage(usageData)
    if (response.error) throw response.error
    return response.data
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

const initialState = {
  purchases: [],
  feedTypes: [],
  usageStats: null,
  lowStockAlerts: [],
  loading: false,
  error: null,
}

const feedSlice = createSlice({
  name: 'feed',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    clearFeedError: (state) => {
      state.error = null
    },
    resetFeedData: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchFeedData.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchFeedData.fulfilled, (state, action) => {
        state.loading = false
        state.purchases = action.payload.purchases
        state.usageStats = action.payload.usageStats
      })
      .addCase(fetchFeedData.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      .addCase(fetchFeedTypes.pending, (state) => {
        state.loading = true
      })
      .addCase(fetchFeedTypes.fulfilled, (state, action) => {
        state.loading = false
        state.feedTypes = action.payload || []
      })
      .addCase(fetchFeedTypes.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      .addCase(fetchLowStockAlerts.fulfilled, (state, action) => {
        state.lowStockAlerts = action.payload
      })
  },
})

export const { clearError, clearFeedError, resetFeedData } = feedSlice.actions
export default feedSlice.reducer
