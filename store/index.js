import { configureStore } from '@reduxjs/toolkit'
import { persistStore, persistReducer } from 'redux-persist'
import createWebStorage from 'redux-persist/lib/storage/createWebStorage'
import { combineReducers } from 'redux'
import biweeklyReducer from './slices/biweeklySlice'
import cagesReducer from './slices/cagesSlice'
import authReducer from './slices/authSlice'
import dashboardReducer from './slices/dashboardSlice'
import feedReducer from './slices/feedSlice'
import dailyReducer from './slices/dailySlice'
import notificationsReducer from './slices/notificationsSlice'

// Create a storage object that works in both client and server environments
const createNoopStorage = () => {
  return {
    getItem(_key) {
      return Promise.resolve(null)
    },
    setItem(_key, value) {
      return Promise.resolve(value)
    },
    removeItem(_key) {
      return Promise.resolve()
    },
  }
}

const storage = typeof window !== 'undefined'
  ? createWebStorage('local')
  : createNoopStorage()

const persistConfig = {
  key: 'root',
  storage,
  whitelist: ['auth', 'cages', 'biweekly', 'dashboard', 'feed']
}

const rootReducer = combineReducers({
  auth: authReducer,
  cages: cagesReducer,
  biweekly: biweeklyReducer,
  dashboard: dashboardReducer,
  feed: feedReducer,
  notifications: notificationsReducer
})

const persistedReducer = persistReducer(persistConfig, rootReducer)

// Create store with middleware
export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE']
      },
      immutableCheck: {
        // Disable immutable state middleware in development to improve performance
        ignoredPaths: ['cages', 'biweekly', 'dashboard', 'feed', 'notifications']
      }
    })
})

export const persistor = persistStore(store) 