import { getConvexHttpClient, api } from './convexBridge'

const notificationService = {
  getNotifications: async (_userId, _limit = 50) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.notifications.listForCurrentUser, {})
      return { data: data || [], error: null }
    } catch (error) {
      console.error('Error getting notifications:', error)
      return { data: [], error }
    }
  },

  getUnreadCount: async (_userId) => {
    try {
      const client = getConvexHttpClient()
      const count = await client.query(api.notifications.getUnreadCount, {})
      return { data: count ?? 0, error: null }
    } catch (error) {
      console.error('Error getting unread count:', error)
      return { data: 0, error }
    }
  },

  markAsRead: async (notificationId) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.notifications.markRead, { id: notificationId })
      return { error: null }
    } catch (error) {
      console.error('Error marking notification as read:', error)
      return { error }
    }
  },

  markAllAsRead: async (_userId) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.notifications.markAllRead, {})
      return { error: null }
    } catch (error) {
      console.error('Error marking all notifications as read:', error)
      return { error }
    }
  },

  createNotification: async (notificationData) => {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(api.notifications.create, {
        userId: notificationData.user_id || notificationData.userId,
        title: notificationData.title,
        message: notificationData.message,
        type: notificationData.type,
        link: notificationData.link,
      })
      return { data: { id }, error: null }
    } catch (error) {
      console.error('Error creating notification:', error)
      return { data: null, error }
    }
  },

  deleteNotification: async (notificationId) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.notifications.deleteNotification, {
        id: notificationId,
      })
      return { error: null }
    } catch (error) {
      console.error('Error deleting notification:', error)
      return { error }
    }
  },
}

export default notificationService
