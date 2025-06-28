import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { supabase } from '../../lib/supabase'

// Fetch all harvest records
export const fetchHarvestRecords = createAsyncThunk(
  'harvest/fetchHarvestRecords',
  async () => {
    const { data, error } = await supabase
      .from('harvest_records')
      .select('*')
      .order('harvest_date', { ascending: false })
    if (error) throw error
    return data
  }
)

// Create a new harvest record
export const createHarvestRecord = createAsyncThunk(
  'harvest/createHarvestRecord',
  async (record) => {
    const { data, error } = await supabase
      .from('harvest_records')
      .insert([record])
      .single()
    if (error) throw error
    return data
  }
)

// Update a harvest record
export const updateHarvestRecord = createAsyncThunk(
  'harvest/updateHarvestRecord',
  async ({ id, updates }) => {
    const { data, error } = await supabase
      .from('harvest_records')
      .update(updates)
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  }
)

// Delete a harvest record
export const deleteHarvestRecord = createAsyncThunk(
  'harvest/deleteHarvestRecord',
  async (id) => {
    const { error } = await supabase
      .from('harvest_records')
      .delete()
      .eq('id', id)
    if (error) throw error
    return id
  }
)

const initialState = {
  harvestRecords: [],
  loading: false,
  error: null,
}

const harvestSlice = createSlice({
  name: 'harvest',
  initialState,
  reducers: {
    clearHarvestError: (state) => {
      state.error = null
    },
    resetHarvestState: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchHarvestRecords.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchHarvestRecords.fulfilled, (state, action) => {
        state.loading = false
        state.harvestRecords = action.payload
      })
      .addCase(fetchHarvestRecords.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
      })
      .addCase(createHarvestRecord.fulfilled, (state, action) => {
        state.harvestRecords.unshift(action.payload)
      })
      .addCase(updateHarvestRecord.fulfilled, (state, action) => {
        const idx = state.harvestRecords.findIndex(r => r.id === action.payload.id)
        if (idx !== -1) state.harvestRecords[idx] = action.payload
      })
      .addCase(deleteHarvestRecord.fulfilled, (state, action) => {
        state.harvestRecords = state.harvestRecords.filter(r => r.id !== action.payload)
      })
  },
})

export const { clearHarvestError, resetHarvestState } = harvestSlice.actions
export default harvestSlice.reducer 