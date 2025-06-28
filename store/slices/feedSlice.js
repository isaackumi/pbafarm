import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { supabase } from '../../lib/supabase'

// Fetch all feed types
export const fetchFeedTypes = createAsyncThunk(
  'feed/fetchFeedTypes',
  async () => {
    const { data, error } = await supabase
      .from('feed_types')
      .select('*')
      .order('name', { ascending: true })
    if (error) throw error
    return data
  }
)

// Create a new feed type
export const createFeedType = createAsyncThunk(
  'feed/createFeedType',
  async (feedType) => {
    const { data, error } = await supabase
      .from('feed_types')
      .insert([feedType])
      .single()
    if (error) throw error
    return data
  }
)

// Update a feed type
export const updateFeedType = createAsyncThunk(
  'feed/updateFeedType',
  async ({ id, updates }) => {
    const { data, error } = await supabase
      .from('feed_types')
      .update(updates)
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  }
)

// Delete a feed type
export const deleteFeedType = createAsyncThunk(
  'feed/deleteFeedType',
  async (id) => {
    const { error } = await supabase
      .from('feed_types')
      .delete()
      .eq('id', id)
    if (error) throw error
    return id
  }
)

const initialState = {
  feedTypes: [],
  loading: false,
  error: null,
}

const feedSlice = createSlice({
  name: 'feed',
  initialState,
  reducers: {
    clearFeedError: (state) => {
      state.error = null
    },
    resetFeedState: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchFeedTypes.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchFeedTypes.fulfilled, (state, action) => {
        state.loading = false
        state.feedTypes = action.payload
      })
      .addCase(fetchFeedTypes.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
      })
      .addCase(createFeedType.fulfilled, (state, action) => {
        state.feedTypes.push(action.payload)
      })
      .addCase(updateFeedType.fulfilled, (state, action) => {
        const idx = state.feedTypes.findIndex(f => f.id === action.payload.id)
        if (idx !== -1) state.feedTypes[idx] = action.payload
      })
      .addCase(deleteFeedType.fulfilled, (state, action) => {
        state.feedTypes = state.feedTypes.filter(f => f.id !== action.payload)
      })
  },
})

export const { clearFeedError, resetFeedState } = feedSlice.actions
export default feedSlice.reducer 