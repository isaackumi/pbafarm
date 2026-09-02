import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { harvestRecordService } from '../../lib/databaseService'

// Async thunks
export const fetchHarvestRecords = createAsyncThunk(
  'harvest/fetchHarvestRecords',
  async (_, { rejectWithValue }) => {
    try {
      const response = await harvestRecordService.getAllHarvestRecords()
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const createHarvestRecord = createAsyncThunk(
  'harvest/createHarvestRecord',
  async (recordData, { rejectWithValue }) => {
    try {
      const response = await harvestRecordService.createHarvestRecord(recordData)
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

const initialState = {
  records: [],
  loading: false,
  error: null
}

const harvestSlice = createSlice({
  name: 'harvest',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    resetHarvestRecords: (state) => {
      return initialState
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchHarvestRecords.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchHarvestRecords.fulfilled, (state, action) => {
        state.loading = false
        state.records = action.payload
        state.error = null
      })
      .addCase(fetchHarvestRecords.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      .addCase(createHarvestRecord.fulfilled, (state, action) => {
        state.records = [action.payload, ...state.records]
      })
  }
})

export const { clearError, resetHarvestRecords } = harvestSlice.actions

export const selectHarvestRecords = (state) => state.harvest.records
export const selectHarvestLoading = (state) => state.harvest.loading
export const selectHarvestError = (state) => state.harvest.error

export default harvestSlice.reducer