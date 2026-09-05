import { getConvexHttpClient, api } from './convexBridge'

const feedTypeService = {
  getAllFeedTypes: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listFeedTypes, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  getActiveFeedTypes: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listFeedTypes, {})
      return { data: (data || []).filter((t) => t.active !== false), error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  getFeedTypeById: async (id) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listFeedTypes, {})
      return { data: (data || []).find((t) => t.id === id || t._id === id) || null, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  createFeedType: async (form) => feedServiceCreate(form),
  updateFeedType: async (id, form) => {
    try {
      const client = getConvexHttpClient()
      const patch = {}
      if (form.name != null) patch.name = form.name
      if (form.description !== undefined) patch.description = form.description || undefined
      if (form.price_per_kg != null || form.pricePerKg != null) {
        patch.pricePerKg = Number(form.price_per_kg ?? form.pricePerKg)
      }
      if (form.minimum_stock != null || form.minimumStock != null) {
        patch.minimumStock = Number(form.minimum_stock ?? form.minimumStock)
      }
      if (form.bag_size_kg != null || form.bagSizeKg != null) {
        patch.bagSizeKg = Number(form.bag_size_kg ?? form.bagSizeKg)
      }
      if (form.supplier_id || form.supplierId) {
        patch.supplierId = form.supplier_id || form.supplierId
      }
      if (form.active !== undefined) patch.active = form.active !== false

      await client.mutation(api.feed.updateFeedType, { id, patch })
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  deleteFeedType: async (id) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.feed.softDeleteFeedType, { id })
      return { error: null }
    } catch (error) {
      return { error }
    }
  },
}

async function feedServiceCreate(form) {
  try {
    const client = getConvexHttpClient()
    const args = {
      name: String(form.name || '').trim(),
      currentStock: Number(form.current_stock ?? form.currentStock ?? 0),
      minimumStock: Number(form.minimum_stock ?? form.minimumStock ?? 0),
      pricePerKg: Number(form.price_per_kg ?? form.pricePerKg ?? 0),
      bagSizeKg: Number(form.bag_size_kg ?? form.bagSizeKg ?? 25),
      active: form.active !== false,
    }
    if (form.description) args.description = form.description
    const supplierId = form.supplier_id || form.supplierId
    if (supplierId) args.supplierId = supplierId

    const id = await client.mutation(api.feed.createFeedType, args)
    return { data: { id }, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

export { feedTypeService }
export default feedTypeService
