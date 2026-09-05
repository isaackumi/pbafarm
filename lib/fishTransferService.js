import { getConvexHttpClient, api } from './convexBridge'

const fishTransferService = {
  list: async (filters = {}) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.fishTransfers.listFishTransfers, filters)
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },

  create: async (payload) => {
    try {
      const client = getConvexHttpClient()
      const id = await client.mutation(api.fishTransfers.createFishTransfer, payload)
      return { data: id, error: null }
    } catch (error) {
      return { data: null, error }
    }
  },

  approve: async (id) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.fishTransfers.approveFishTransfer, { id })
      return { error: null }
    } catch (error) {
      return { error }
    }
  },

  reject: async (id, reason) => {
    try {
      const client = getConvexHttpClient()
      await client.mutation(api.fishTransfers.rejectFishTransfer, {
        id,
        reason,
      })
      return { error: null }
    } catch (error) {
      return { error }
    }
  },
}

export default fishTransferService
