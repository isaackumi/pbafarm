// Role helpers aligned with Convex users.role: user | admin | super_admin
import { getConvexHttpClient, api } from './convexBridge'

const RANK = { user: 1, admin: 2, super_admin: 3 }

function roleAtLeast(actual, needed) {
  return (RANK[actual] || 0) >= (RANK[needed] || 0)
}

const permissionService = {
  async getCurrentUser() {
    const client = getConvexHttpClient()
    return await client.query(api.users.current, {})
  },

  async hasRole(role) {
    const user = await permissionService.getCurrentUser()
    if (!user) return false
    return roleAtLeast(user.role || 'user', role)
  },

  async isAdmin() {
    return permissionService.hasRole('admin')
  },

  /** Capability map kept small on purpose — expand only when UI needs it. */
  async can(action) {
    const user = await permissionService.getCurrentUser()
    if (!user) return false
    const role = user.role || 'user'
    const caps = {
      'users.manage': roleAtLeast(role, 'admin'),
      'company.settings': roleAtLeast(role, 'admin'),
      'ai.toggle': roleAtLeast(role, 'admin'),
      'stock.override': roleAtLeast(role, 'admin'),
      'stock.adjust': roleAtLeast(role, 'admin'),
      'feed.issue': true,
      'feed.purchase': true,
      'daily.write': true,
    }
    return caps[action] === true
  },
}

export default permissionService
