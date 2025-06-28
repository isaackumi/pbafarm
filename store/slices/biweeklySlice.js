import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { supabase } from '../../lib/supabase'

// Async thunks
export const fetchBiweeklyRecords = createAsyncThunk(
  'biweekly/fetchRecords',
  async (cageId) => {
    const { data, error } = await supabase
      .from('biweekly_records')
      .select(`
        *,
        samplings (*)
      `)
      .eq('cage_id', cageId)
      .order('date', { ascending: false })

    if (error) throw error
    return data
  }
)

export const createBiweeklyRecord = createAsyncThunk(
  'biweekly/createRecord',
  async ({ cageId, record, samplings }) => {
    // Start a transaction
    const { data: recordData, error: recordError } = await supabase
      .from('biweekly_records')
      .insert([record])
      .select()
      .single()

    if (recordError) throw recordError

    // Add the record_id to each sampling
    const samplingsWithRecordId = samplings.map(sampling => ({
      ...sampling,
      biweekly_record_id: recordData.id
    }))

    const { data: samplingData, error: samplingError } = await supabase
      .from('samplings')
      .insert(samplingsWithRecordId)
      .select()

    if (samplingError) throw samplingError

    return { record: recordData, samplings: samplingData }
  }
)

const initialState = {
  records: [],
  loading: false,
  error: null,
  success: false
}

const biweeklySlice = createSlice({
  name: 'biweekly',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    clearSuccess: (state) => {
      state.success = false
    },
    resetState: (state) => {
      return initialState
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch records
      .addCase(fetchBiweeklyRecords.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchBiweeklyRecords.fulfilled, (state, action) => {
        state.loading = false
        state.records = action.payload
      })
      .addCase(fetchBiweeklyRecords.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
      })
      // Create record
      .addCase(createBiweeklyRecord.pending, (state) => {
        state.loading = true
        state.error = null
        state.success = false
      })
      .addCase(createBiweeklyRecord.fulfilled, (state, action) => {
        state.loading = false
        state.records.unshift(action.payload.record)
        state.success = true
      })
      .addCase(createBiweeklyRecord.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
        state.success = false
      })
  }
})

export const { clearError, clearSuccess, resetState } = biweeklySlice.actions
export default biweeklySlice.reducer 