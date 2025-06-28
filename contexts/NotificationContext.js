import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'

const NotificationContext = createContext()

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const { showToast } = useToast()

  useEffect(() => {
    // Load initial notifications
    loadNotifications()

    // Subscribe to real-time notifications
    const subscription = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications'
      }, (payload) => {
        handleNotificationChange(payload)
      })
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const loadNotifications = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        setNotifications([])
        setUnreadCount(0)
        return
      }

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
        if (error.code === '42P01') {
          // Table doesn't exist yet, this is expected
          console.log('Notifications table not created yet')
          setNotifications([])
          setUnreadCount(0)
          return
        }
        throw error
      }

      setNotifications(data || [])
      setUnreadCount((data || []).filter(n => !n.read).length)
    } catch (error) {
      console.error('Error loading notifications:', error)
      showToast('error', 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }

  const handleNotificationChange = async (payload) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) return

      // Only process notifications for the current user
      if (payload.new?.user_id !== user.id) return

      if (payload.eventType === 'INSERT') {
        const newNotification = payload.new
        setNotifications(prev => [newNotification, ...prev])
        setUnreadCount(prev => prev + 1)
        
        // Show toast for new notification
        showToast('info', newNotification.message)
      } else if (payload.eventType === 'UPDATE') {
        setNotifications(prev =>
          prev.map(n => n.id === payload.new.id ? payload.new : n)
        )
        if (payload.new.read) {
          setUnreadCount(prev => Math.max(0, prev - 1))
        }
      } else if (payload.eventType === 'DELETE') {
        setNotifications(prev =>
          prev.filter(n => n.id !== payload.old.id)
        )
        if (!payload.old.read) {
          setUnreadCount(prev => Math.max(0, prev - 1))
        }
      }
    } catch (error) {
      console.error('Error handling notification change:', error)
    }
  }

  const markAsRead = async (id) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) return

      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('user_id', user.id)
      
      if (error) throw error

      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, read: true } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Error marking notification as read:', error)
      showToast('error', 'Failed to mark notification as read')
    }
  }

  const markAllAsRead = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) return

      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false)
      
      if (error) throw error

      setNotifications(prev =>
        prev.map(n => ({ ...n, read: true }))
      )
      setUnreadCount(0)
    } catch (error) {
      console.error('Error marking all notifications as read:', error)
      showToast('error', 'Failed to mark all notifications as read')
    }
  }

  const deleteNotification = async (id) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) return

      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)
      
      if (error) throw error

      setNotifications(prev =>
        prev.filter(n => n.id !== id)
      )
      setUnreadCount(prev =>
        notifications.find(n => n.id === id)?.read ? prev : Math.max(0, prev - 1)
      )
    } catch (error) {
      console.error('Error deleting notification:', error)
      showToast('error', 'Failed to delete notification')
    }
  }

  const value = {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refreshNotifications: loadNotifications
  }

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}

export const useNotifications = () => {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
} 