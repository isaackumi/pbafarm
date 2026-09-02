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
      await client.mutation(api.feed.updateFeedType, {
        id,
        patch: {
          name: form.name,
          description: form.description,
          pricePerKg: form.price_per_kg != null ? Number(form.price_per_kg) : form.pricePerKg,
          minimumStock: form.minimum_stock != null ? Number(form.minimum_stock) : form.minimumStock,
          currentStock: form.current_stock != null ? Number(form.current_stock) : form.currentStock,
          supplierId: form.supplier_id || form.supplierId,
          active: form.active,
        },
      })
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
    const id = await client.mutation(api.feed.createFeedType, {
      name: form.name,
      description: form.description,
      currentStock: Number(form.current_stock ?? form.currentStock ?? 0),
      minimumStock: Number(form.minimum_stock ?? form.minimumStock ?? 0),
      pricePerKg: Number(form.price_per_kg ?? form.pricePerKg ?? 0),
      bagSizeKg:
        form.bag_size_kg != null || form.bagSizeKg != null
          ? Number(form.bag_size_kg ?? form.bagSizeKg)
          : undefined,
      supplierId: form.supplier_id || form.supplierId || undefined,
      active: form.active !== false,
    })
    return { data: { id }, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

export { feedTypeService }
export default feedTypeService
