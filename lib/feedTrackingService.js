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
      const qty = usageData.quantity ?? usageData.quantityKg
      const id = await client.mutation(api.feed.createUsage, {
        feedTypeId: usageData.feed_type_id || usageData.feedTypeId,
        cageId: usageData.cage_id || usageData.cageId || undefined,
        quantity: qty != null && qty !== '' ? Number(qty) : undefined,
        bags:
          usageData.bags != null && usageData.bags !== ''
            ? Number(usageData.bags)
            : undefined,
        usageDate: usageData.usage_date || usageData.usageDate,
        notes: usageData.notes || undefined,
        allowNegative: usageData.allowNegative,
        overrideReason: usageData.overrideReason,
      })
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  /** Alias used by older call sites — usage only, not purchases. */
  recordFeedUsage: async (usageData) => feedTrackingService.recordUsage(usageData),
}

export { feedTrackingService }
export default feedTrackingService
