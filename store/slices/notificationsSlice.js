import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import notificationService from '../../lib/notificationService'

// Async thunks
export const fetchNotifications = createAsyncThunk(
  'notifications/fetchNotifications',
  async (userId, { rejectWithValue }) => {
    try {
      const response = await notificationService.getNotifications(userId)
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const markNotificationAsRead = createAsyncThunk(
  'notifications/markAsRead',
  async (notificationId, { rejectWithValue }) => {
    try {
      const response = await notificationService.markAsRead(notificationId)
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const markAllNotificationsAsRead = createAsyncThunk(
  'notifications/markAllAsRead',
  async (userId, { rejectWithValue }) => {
    try {
      const response = await notificationService.markAllAsRead(userId)
      if (response.error) throw response.error
      return response.data
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const deleteNotification = createAsyncThunk(
  'notifications/deleteNotification',
  async (notificationId, { rejectWithValue }) => {
    try {
      const response = await notificationService.deleteNotification(notificationId)
      if (response.error) throw response.error
      return notificationId
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const deleteAllNotifications = createAsyncThunk(
  'notifications/deleteAllNotifications',
  async (userId, { rejectWithValue }) => {
    try {
      const response = await notificationService.deleteAllNotifications(userId)
      if (response.error) throw response.error
      return []
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const getUnreadCount = createAsyncThunk(
  'notifications/getUnreadCount',
  async (userId, { rejectWithValue }) => {
    try {
      const response = await notificationService.getUnreadCount(userId)
      if (response.error) throw response.error
      return response.count
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

const initialState = {
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: null
}

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    addNotification: (state, action) => {
      state.notifications.unshift(action.payload)
      state.unreadCount += 1
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch notifications
      .addCase(fetchNotifications.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchNotifications.fulfilled, (state, action) => {
        state.loading = false
        state.notifications = action.payload
        state.error = null
      })
      .addCase(fetchNotifications.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload
      })
      // Mark as read
      .addCase(markNotificationAsRead.fulfilled, (state, action) => {
        const index = state.notifications.findIndex(n => n.id === action.payload.id)
        if (index !== -1) {
          state.notifications[index] = action.payload
          state.unreadCount = Math.max(0, state.unreadCount - 1)
        }
      })
      // Mark all as read
      .addCase(markAllNotificationsAsRead.fulfilled, (state, action) => {
        state.notifications = state.notifications.map(notification => ({
          ...notification,
          read: true
        }))
        state.unreadCount = 0
      })
      // Delete notification
      .addCase(deleteNotification.fulfilled, (state, action) => {
        state.notifications = state.notifications.filter(n => n.id !== action.payload)
        if (state.notifications.length === 0) {
          state.unreadCount = 0
        }
      })
      // Delete all notifications
      .addCase(deleteAllNotifications.fulfilled, (state) => {
        state.notifications = []
        state.unreadCount = 0
      })
      // Get unread count
      .addCase(getUnreadCount.fulfilled, (state, action) => {
        state.unreadCount = action.payload
      })
  }
})

export const { clearError, addNotification } = notificationsSlice.actions

// Selectors
export const selectNotifications = (state) => state.notifications.notifications
export const selectUnreadCount = (state) => state.notifications.unreadCount
export const selectNotificationsLoading = (state) => state.notifications.loading
export const selectNotificationsError = (state) => state.notifications.error

export default notificationsSlice.reducer 