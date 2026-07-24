import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { biweeklyRecordService } from '../../lib/databaseService'

// Async thunks
export const fetchBiweeklyRecords = createAsyncThunk(
  'biweekly/fetchBiweeklyRecords',
  async ({ cageId }, { rejectWithValue }) => {
    try {
      const response = await biweeklyRecordService.getBiweeklyRecords(cageId)
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const createBiweeklyRecord = createAsyncThunk(
  'biweekly/createBiweeklyRecord',
  async (recordData, { rejectWithValue }) => {
    try {
      const response = await biweeklyRecordService.createBiweeklyRecord(recordData)
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

const biweeklySlice = createSlice({
  name: 'biweekly',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    resetBiweeklyRecords: (state) => {
      return initialState
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBiweeklyRecords.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchBiweeklyRecords.fulfilled, (state, action) => {
        state.loading = false
        state.records = action.payload
        state.error = null
      })
      .addCase(fetchBiweeklyRecords.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      .addCase(createBiweeklyRecord.fulfilled, (state, action) => {
        state.records = [action.payload, ...state.records]
      })
  }
})

export const { clearError, resetBiweeklyRecords } = biweeklySlice.actions

export const selectBiweeklyRecords = (state) => state.biweekly.records
export const selectBiweeklyLoading = (state) => state.biweekly.loading
export const selectBiweeklyError = (state) => state.biweekly.error

export default biweeklySlice.reducer