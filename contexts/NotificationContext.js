import React, { createContext, useCallback, useContext, useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useToast } from '../components/Toast'
import { useAuth } from './AuthContext'

const NotificationContext = createContext()

/** Reactive: Convex pushes new notifications and read-state changes as they happen. */
export function NotificationProvider({ children }) {
  const { showToast } = useToast()
  const { user: authUser, canUseApp } = useAuth()
  // Tenant data only once access is confirmed (password changed, company approved).
  const enabled = Boolean(canUseApp && authUser)
  const list = useQuery(api.notifications.listForCurrentUser, enabled ? { limit: 20 } : 'skip')
  const unread = useQuery(api.notifications.getUnreadCount, enabled ? {} : 'skip')
  const markRead = useMutation(api.notifications.markRead)
  const markAllRead = useMutation(api.notifications.markAllRead)
  const remove = useMutation(api.notifications.deleteNotification)

  const run = useCallback(
    async (fn, failure) => {
      if (!enabled) return
      try {
        await fn()
      } catch (error) {
        console.error(failure, error)
        showToast('error', failure)
      }
    },
    [enabled, showToast],
  )

  const value = useMemo(
    () => ({
      notifications: enabled ? list ?? [] : [],
      unreadCount: enabled ? unread ?? 0 : 0,
      loading: enabled && list === undefined,
      markAsRead: (id) => run(() => markRead({ id }), 'Failed to mark notification as read'),
      markAllAsRead: () => run(() => markAllRead({}), 'Failed to mark all notifications as read'),
      deleteNotification: (id) => run(() => remove({ id }), 'Failed to delete notification'),
      // Kept for callers of the old API; the query is live.
      refreshNotifications: () => {},
    }),
    [enabled, list, unread, run, markRead, markAllRead, remove],
  )

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export const useNotifications = () => {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
}
