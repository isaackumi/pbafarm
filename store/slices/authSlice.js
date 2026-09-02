import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { getConvexHttpClient, api } from '../../lib/convexBridge'

// Async thunks - AuthContext now handles auth, these are no-ops/thin wrappers
export const fetchUser = createAsyncThunk(
  'auth/fetchUser',
  async () => {
    try {
      const client = getConvexHttpClient()
      const user = await client.query(api.users.current, {})
      return user
    } catch (error) {
      // Return null if not authenticated
      return null
    }
  }
)

export const signIn = createAsyncThunk(
  'auth/signIn',
  async ({ email, password }) => {
    // AuthContext handles sign in now - this is just for compatibility
    throw new Error('Use AuthContext for sign in')
  }
)

export const signOut = createAsyncThunk(
  'auth/signOut',
  async () => {
    // AuthContext handles sign out now - this is just for compatibility
    throw new Error('Use AuthContext for sign out')
  }
)

const initialState = {
  user: null,
  loading: false,
  error: null
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    resetState: (state) => {
      return initialState
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch user
      .addCase(fetchUser.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchUser.fulfilled, (state, action) => {
        state.loading = false
        state.user = action.payload
      })
      .addCase(fetchUser.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
      })
      // Sign in
      .addCase(signIn.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(signIn.fulfilled, (state, action) => {
        state.loading = false
        state.user = action.payload.user
      })
      .addCase(signIn.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
      })
      // Sign out
      .addCase(signOut.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(signOut.fulfilled, (state) => {
        state.loading = false
        state.user = null
      })
      .addCase(signOut.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message
      })
  }
})

export const { clearError, resetState } = authSlice.actions
export default authSlice.reducer 