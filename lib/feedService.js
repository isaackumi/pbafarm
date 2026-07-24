import { getConvexHttpClient, api } from './convexBridge'

export const feedService = {
  async getAllPurchases() {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listPurchases, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  async createPurchase(purchaseData) {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(api.feed.createPurchase, {
        feedTypeId: purchaseData.feed_type_id || purchaseData.feedTypeId,
        quantity: Number(purchaseData.quantity),
        pricePerKg: Number(purchaseData.price_per_kg ?? purchaseData.pricePerKg),
        purchaseDate: purchaseData.purchase_date || purchaseData.purchaseDate,
        supplierId: purchaseData.supplier_id || purchaseData.supplierId,
        batchNumber: purchaseData.batch_number || purchaseData.batchNumber,
        expiryDate: purchaseData.expiry_date || purchaseData.expiryDate,
        notes: purchaseData.notes,
      })
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  async getFeedUsageStats() {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listUsage, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  async recordFeedUsage(usageData) {
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

  async getLowStockAlerts() {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.inventory.listAlerts, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  async getAllFeedTypes() {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listFeedTypes, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  async createFeedType(form) {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(api.feed.createFeedType, {
        name: form.name,
        description: form.description,
        currentStock: Number(form.current_stock ?? form.currentStock ?? 0),
        minimumStock: Number(form.minimum_stock ?? form.minimumStock ?? 0),
        pricePerKg: Number(form.price_per_kg ?? form.pricePerKg ?? 0),
        supplierId: form.supplier_id || form.supplierId || undefined,
        active: form.active !== false,
      })
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  async updateFeedType(id, form) {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.feed.updateFeedType, {
        id,
        patch: {
          name: form.name,
          description: form.description,
          currentStock:
            form.current_stock != null || form.currentStock != null
              ? Number(form.current_stock ?? form.currentStock)
              : undefined,
          minimumStock:
            form.minimum_stock != null || form.minimumStock != null
              ? Number(form.minimum_stock ?? form.minimumStock)
              : undefined,
          pricePerKg:
            form.price_per_kg != null || form.pricePerKg != null
              ? Number(form.price_per_kg ?? form.pricePerKg)
              : undefined,
          supplierId: form.supplier_id || form.supplierId,
          active: form.active,
        },
      })
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  async deleteFeedType(id) {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.feed.softDeleteFeedType, { id })
      return { error: null }
    } catch (error) {
      return { error }
    }
  },
}

export default feedService
