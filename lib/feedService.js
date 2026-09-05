import { getConvexHttpClient, api } from './convexBridge'
import { withActiveLocation, getActiveLocationId } from './locationScope'

function rangeToDates(timeRange = '30d') {
  const days =
    timeRange === '7d' ? 7 : timeRange === '90d' ? 90 : timeRange === '1y' ? 365 : 30
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - days)
  return {
    dateFrom: start.toISOString().split('T')[0],
    dateTo: end.toISOString().split('T')[0],
  }
}

export const feedService = {
  async getAllPurchases({ allLocations = false } = {}) {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(
        api.feed.listPurchases,
        allLocations ? {} : withActiveLocation(),
      )
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  async getStockLevels({ allLocations = false } = {}) {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(
        api.inventory.listStockLevels,
        allLocations ? {} : withActiveLocation({}),
      )
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  async getInventoryLots({ allLocations = false } = {}) {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(
        api.inventory.listLots,
        allLocations ? {} : withActiveLocation(),
      )
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  async createPurchase(purchaseData) {
    try {
      const client = getConvexHttpClient()
      const qty = purchaseData.quantity ?? purchaseData.quantityKg
      const bags = purchaseData.bags
      const supplierId =
        purchaseData.supplier_id || purchaseData.supplierId
      if (!supplierId) {
        throw new Error('Supplier is required')
      }
      const id = await client.mutation(api.feed.createPurchase, {
        feedTypeId: purchaseData.feed_type_id || purchaseData.feedTypeId,
        quantity: qty != null && qty !== '' ? Number(qty) : undefined,
        bags: bags != null && bags !== '' ? Number(bags) : undefined,
        pricePerKg: Number(purchaseData.price_per_kg ?? purchaseData.pricePerKg),
        purchaseDate: purchaseData.purchase_date || purchaseData.purchaseDate,
        supplierId,
        batchNumber: purchaseData.batch_number || purchaseData.batchNumber || undefined,
        expiryDate: purchaseData.expiry_date || purchaseData.expiryDate || undefined,
        notes: purchaseData.notes || undefined,
        locationId:
          purchaseData.locationId ||
          purchaseData.location_id ||
          getActiveLocationId() ||
          undefined,
      })
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  async updatePurchase(id, purchaseData) {
    try {
      const client = getConvexHttpClient()
      const qty = purchaseData.quantity ?? purchaseData.quantityKg
      const bags = purchaseData.bags
      const supplierId =
        purchaseData.supplier_id || purchaseData.supplierId
      if (!supplierId) {
        throw new Error('Supplier is required')
      }
      await client.mutation(api.feed.updatePurchase, {
        id,
        quantity: qty != null && qty !== '' ? Number(qty) : undefined,
        bags: bags != null && bags !== '' ? Number(bags) : undefined,
        pricePerKg:
          purchaseData.price_per_kg != null || purchaseData.pricePerKg != null
            ? Number(purchaseData.price_per_kg ?? purchaseData.pricePerKg)
            : undefined,
        purchaseDate:
          purchaseData.purchase_date || purchaseData.purchaseDate || undefined,
        supplierId,
        batchNumber:
          purchaseData.batch_number ?? purchaseData.batchNumber ?? undefined,
        expiryDate:
          purchaseData.expiry_date ?? purchaseData.expiryDate ?? undefined,
        notes: purchaseData.notes ?? undefined,
      })
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  async deletePurchase(id, reason) {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.feed.voidPurchase, {
        id,
        reason: reason || undefined,
      })
      return { error: null }
    } catch (error) {
      return { error }
    }
  },

  async getFeedUsageStats(timeRange = '30d') {
    try {
      const client = getConvexHttpClient()
      const { dateFrom, dateTo } = rangeToDates(timeRange)
      const [rows, feedTypes, cages] = await Promise.all([
        client.query(api.feed.listUsage, withActiveLocation({ dateFrom, dateTo })),
        client.query(api.feed.listFeedTypes, {}),
        client.query(api.cages.list, withActiveLocation()),
      ])
      const feedNames = Object.fromEntries(
        (feedTypes || []).map((t) => [t.id || t._id, t.name]),
      )
      const cageNames = Object.fromEntries(
        (cages || []).map((c) => [c.id || c._id, c.name]),
      )
      const list = rows || []
      const byFeedType = {}
      const byCage = {}
      let totalUsage = 0
      for (const u of list) {
        const qty = Number(u.quantity || 0)
        totalUsage += qty
        const ftId = u.feed_type_id || u.feedTypeId
        const cageId = u.cage_id || u.cageId
        const ft = feedNames[ftId] || ftId || 'Unknown'
        byFeedType[ft] = (byFeedType[ft] || 0) + qty
        const cage = cageNames[cageId] || cageId || 'Unassigned'
        byCage[cage] = (byCage[cage] || 0) + qty
      }
      return {
        data: {
          totalUsage,
          byFeedType,
          byCage,
          rows: list,
        },
        error: null,
      }
    } catch (error) {
      return { data: null, error }
    }
  },

  async getFeedCostAnalysis(timeRange = '30d') {
    try {
      const client = getConvexHttpClient()
      const { dateFrom, dateTo } = rangeToDates(timeRange)
      const purchases = await client.query(api.feed.listPurchases, {
        dateFrom,
        dateTo,
      })
      let totalCost = 0
      let totalKg = 0
      for (const p of purchases || []) {
        const qty = Number(p.quantity || 0)
        const price = Number(p.price_per_kg ?? p.pricePerKg ?? 0)
        totalKg += qty
        totalCost += qty * price
      }
      return {
        data: {
          totalCost,
          totalKg,
          averageCostPerKg: totalKg > 0 ? totalCost / totalKg : 0,
          purchases: purchases || [],
        },
        error: null,
      }
    } catch (error) {
      return { data: null, error }
    }
  },

  async recordFeedUsage(usageData) {
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

  async createIssue(issueData) {
    try {
      const client = getConvexHttpClient()
      const qty = issueData.quantity ?? issueData.quantityKg
      const id = await client.mutation(api.feed.createIssue, {
        feedTypeId: issueData.feed_type_id || issueData.feedTypeId,
        cageId: issueData.cage_id || issueData.cageId || undefined,
        quantity: qty != null && qty !== '' ? Number(qty) : undefined,
        bags:
          issueData.bags != null && issueData.bags !== ''
            ? Number(issueData.bags)
            : undefined,
        usageDate: issueData.usage_date || issueData.usageDate,
        notes: issueData.notes || undefined,
        allowNegative: issueData.allowNegative,
        overrideReason: issueData.overrideReason,
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
      const normalized = (data || []).map((a) => ({
        ...a,
        name: a.name || a.feed_type_name || a.feedTypeName || 'Feed',
        currentStock: a.currentStock ?? a.current_stock ?? 0,
        minimumStock: a.minimumStock ?? a.minimum_stock ?? 0,
      }))
      return { data: normalized, error: null }
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
      const args = {
        name: String(form.name || '').trim(),
        currentStock: Number(form.current_stock ?? form.currentStock ?? 0),
        minimumStock: Number(form.minimum_stock ?? form.minimumStock ?? 0),
        pricePerKg: Number(form.price_per_kg ?? form.pricePerKg ?? 0),
        bagSizeKg: Number(form.bag_size_kg ?? form.bagSizeKg ?? 20),
        active: form.active !== false,
      }
      const description = form.description
      if (description) args.description = description
      const supplierId = form.supplier_id || form.supplierId
      if (supplierId) args.supplierId = supplierId

      const id = await client.mutation(api.feed.createFeedType, args)
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
          minimumStock:
            form.minimum_stock != null || form.minimumStock != null
              ? Number(form.minimum_stock ?? form.minimumStock)
              : undefined,
          pricePerKg:
            form.price_per_kg != null || form.pricePerKg != null
              ? Number(form.price_per_kg ?? form.pricePerKg)
              : undefined,
          bagSizeKg:
            form.bag_size_kg != null || form.bagSizeKg != null
              ? Number(form.bag_size_kg ?? form.bagSizeKg)
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
