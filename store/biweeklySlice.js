import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { supabase } from '../lib/supabase'

// Load initial state from localStorage
const loadState = () => {
  try {
    const serializedState = localStorage.getItem('biweeklyState')
    if (serializedState === null) {
      return {
        records: [],
        loading: false,
        error: null
      }
    }
    return JSON.parse(serializedState)
  } catch (err) {
    return {
      records: [],
      loading: false,
      error: null
    }
  }
}

// Save state to localStorage
const saveState = (state) => {
  try {
    const serializedState = JSON.stringify(state)
    localStorage.setItem('biweeklyState', serializedState)
  } catch (err) {
    console.error('Error saving state to localStorage:', err)
  }
}

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

const initialState = loadState()

const biweeklySlice = createSlice({
  name: 'biweekly',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
      saveState(state)
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch records
      .addCase(fetchBiweeklyRecords.pending, (state) => {
        state.loading = true
        state.error = null
        saveState(state)
      })
      .addCase(fetchBiweeklyRecords.fulfilled, (state, action) => {
        state.loading = false
        state.records = action.payload
        saveState(state)
      })
      .addCase(fetchBiweeklyRecords.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
        saveState(state)
      })
      // Create record
      .addCase(createBiweeklyRecord.pending, (state) => {
        state.loading = true
        state.error = null
        saveState(state)
      })
      .addCase(createBiweeklyRecord.fulfilled, (state, action) => {
        state.loading = false
        state.records.unshift(action.payload.record)
        saveState(state)
      })
      .addCase(createBiweeklyRecord.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
        saveState(state)
      })
  }
})

export const { clearError } = biweeklySlice.actions
export default biweeklySlice.reducer 