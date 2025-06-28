import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { supabase } from '../../lib/supabase'

// Fetch all daily records
export const fetchDailyRecords = createAsyncThunk(
  'daily/fetchDailyRecords',
  async () => {
    const { data, error } = await supabase
      .from('daily_records')
      .select('*')
      .order('date', { ascending: false })
    if (error) throw error
    return data
  }
)

// Create a new daily record
export const createDailyRecord = createAsyncThunk(
  'daily/createDailyRecord',
  async (record) => {
    const { data, error } = await supabase
      .from('daily_records')
      .insert([record])
      .single()
    if (error) throw error
    return data
  }
)

// Update a daily record
export const updateDailyRecord = createAsyncThunk(
  'daily/updateDailyRecord',
  async ({ id, updates }) => {
    const { data, error } = await supabase
      .from('daily_records')
      .update(updates)
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  }
)

// Delete a daily record
export const deleteDailyRecord = createAsyncThunk(
  'daily/deleteDailyRecord',
  async (id) => {
    const { error } = await supabase
      .from('daily_records')
      .delete()
      .eq('id', id)
    if (error) throw error
    return id
  }
)

const initialState = {
  dailyRecords: [],
  loading: false,
  error: null,
}

const dailySlice = createSlice({
  name: 'daily',
  initialState,
  reducers: {
    clearDailyError: (state) => {
      state.error = null
    },
    resetDailyState: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDailyRecords.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchDailyRecords.fulfilled, (state, action) => {
        state.loading = false
        state.dailyRecords = action.payload
      })
      .addCase(fetchDailyRecords.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
      })
      .addCase(createDailyRecord.fulfilled, (state, action) => {
        state.dailyRecords.unshift(action.payload)
      })
      .addCase(updateDailyRecord.fulfilled, (state, action) => {
        const idx = state.dailyRecords.findIndex(r => r.id === action.payload.id)
        if (idx !== -1) state.dailyRecords[idx] = action.payload
      })
      .addCase(deleteDailyRecord.fulfilled, (state, action) => {
        state.dailyRecords = state.dailyRecords.filter(r => r.id !== action.payload)
      })
  },
})

export const { clearDailyError, resetDailyState } = dailySlice.actions
export default dailySlice.reducer 