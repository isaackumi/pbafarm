import React, { createContext, useContext, useState, useEffect } from 'react'
import notificationService from '../lib/notificationService'
import { useToast } from '../components/Toast'
import { useAuth } from './AuthContext'

const NotificationContext = createContext()

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const { showToast } = useToast()
  const { user } = useAuth()

  useEffect(() => {
    if (user) {
      loadNotifications()
    } else {
      setNotifications([])
      setUnreadCount(0)
      setLoading(false)
    }
  }, [user])

  const loadNotifications = async () => {
    try {
      setLoading(true)
      
      if (!user) {
        setNotifications([])
        setUnreadCount(0)
        return
      }

      const { data, error } = await notificationService.getNotifications(user.id, 50)

      if (error) {
        console.error('Error loading notifications:', error)
        showToast('error', 'Failed to load notifications')
        setNotifications([])
        setUnreadCount(0)
        return
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


  const markAsRead = async (id) => {
    try {
      if (!user) return

      const { error } = await notificationService.markAsRead(id)
      
      if (error) {
        console.error('Error marking notification as read:', error)
        showToast('error', 'Failed to mark notification as read')
        return
      }

      setNotifications(prev =>
        prev.map(n => n._id === id ? { ...n, read: true } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Error marking notification as read:', error)
      showToast('error', 'Failed to mark notification as read')
    }
  }

  const markAllAsRead = async () => {
    try {
      if (!user) return

      const { error } = await notificationService.markAllAsRead(user._id)
      
      if (error) {
        console.error('Error marking all notifications as read:', error)
        showToast('error', 'Failed to mark all notifications as read')
        return
      }

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
      if (!user) return

      const { error } = await notificationService.deleteNotification(id)
      
      if (error) {
        console.error('Error deleting notification:', error)
        showToast('error', 'Failed to delete notification')
        return
      }

      setNotifications(prev =>
        prev.filter(n => n._id !== id)
      )
      setUnreadCount(prev =>
        notifications.find(n => n._id === id)?.read ? prev : Math.max(0, prev - 1)
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