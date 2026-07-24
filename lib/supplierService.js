import { getConvexHttpClient, api } from './convexBridge'

const supplierService = {
  getAllSuppliers: async () => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.feed.listSuppliers, {})
      return { data, error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  createSupplier: async (supplierData) => {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(api.feed.createSupplier, {
        name: supplierData.name,
        abbreviation: supplierData.abbreviation,
        contactInfo:
          supplierData.contact_info ||
          supplierData.contactInfo ||
          [supplierData.contact_person, supplierData.phone, supplierData.email]
            .filter(Boolean)
            .join(' | ') ||
          undefined,
        website: supplierData.website,
      })
      return { data: { id, name: supplierData.name }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  updateSupplier: async (id, supplierData) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.feed.updateSupplier, {
        id,
        patch: {
          name: supplierData.name,
          abbreviation: supplierData.abbreviation,
          contactInfo: supplierData.contact_info || supplierData.contactInfo,
          website: supplierData.website,
        },
      })
      return { data: { id }, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  deleteSupplier: async (id) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.feed.softDeleteSupplier, { id })
      return { error: null }
    } catch (error) {
      return { error }
    }
  },
}

export { supplierService }
export default supplierService
