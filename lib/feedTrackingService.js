import { getConvexHttpClient, api } from './convexBridge'

const feedTrackingService = {
  getAllUsage: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listUsage, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  getUsageByCage: async (cageId) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listUsage, { cageId })
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  recordUsage: async (usageData) => {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(api.feed.createUsage, {
        feedTypeId: usageData.feed_type_id || usageData.feedTypeId,
        cageId: usageData.cage_id || usageData.cageId,
        quantity: Number(usageData.quantity),
        usageDate: usageData.usage_date || usageData.usageDate,
        notes: usageData.notes,
      })
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },
}

export { feedTrackingService }
export default feedTrackingService
