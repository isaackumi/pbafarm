import { supabase } from './supabase'

const notificationService = {
  /**
   * Get notifications for a user
   */
  getNotifications: async (userId, limit = 50) => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching notifications:', error)
      return { data: null, error }
    }
  },

  /**
   * Create a new notification
   */
  createNotification: async (notificationData) => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .insert([{
          ...notificationData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error creating notification:', error)
      return { data: null, error }
    }
  },

  /**
   * Mark a notification as read
   */
  markAsRead: async (notificationId) => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId)
        .select()

      if (error) throw error
      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error marking notification as read:', error)
      return { data: null, error }
    }
  },

  /**
   * Mark all notifications as read for a user
   */
  markAllAsRead: async (userId) => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false)
        .select()

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error marking all notifications as read:', error)
      return { data: null, error }
    }
  },

  /**
   * Delete a notification
   */
  deleteNotification: async (notificationId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId)

      if (error) throw error
      return { error: null }
    } catch (error) {
      console.error('Error deleting notification:', error)
      return { error }
    }
  },

  /**
   * Delete all notifications for a user
   */
  deleteAllNotifications: async (userId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', userId)

      if (error) throw error
      return { error: null }
    } catch (error) {
      console.error('Error deleting all notifications:', error)
      return { error }
    }
  },

  /**
   * Get unread notification count for a user
   */
  getUnreadCount: async (userId) => {
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false)

      if (error) throw error
      return { count, error: null }
    } catch (error) {
      console.error('Error getting unread count:', error)
      return { count: 0, error }
    }
  }
}

export default notificationService 