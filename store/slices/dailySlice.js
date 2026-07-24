import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { dailyRecordService } from '../../lib/databaseService'

// Async thunks
export const fetchDailyRecords = createAsyncThunk(
  'daily/fetchDailyRecords',
  async ({ cageId }, { rejectWithValue }) => {
    try {
      const response = await dailyRecordService.getDailyRecords(cageId)
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const createDailyRecord = createAsyncThunk(
  'daily/createDailyRecord',
  async (recordData, { rejectWithValue }) => {
    try {
      const response = await dailyRecordService.createDailyRecord(recordData)
      if (response.error) throw response.error
      return response.data[0]
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

const dailySlice = createSlice({
  name: 'daily',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    resetDailyRecords: (state) => {
      return initialState
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDailyRecords.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchDailyRecords.fulfilled, (state, action) => {
        state.loading = false
        state.records = action.payload
        state.error = null
      })
      .addCase(fetchDailyRecords.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      .addCase(createDailyRecord.fulfilled, (state, action) => {
        state.records = [action.payload, ...state.records]
      })
  }
})

export const { clearError, resetDailyRecords } = dailySlice.actions

export const selectDailyRecords = (state) => state.daily.records
export const selectDailyLoading = (state) => state.daily.loading
export const selectDailyError = (state) => state.daily.error

export default dailySlice.reducer