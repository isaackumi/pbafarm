// lib/permissionService.js
import { supabase } from './supabase'

const permissionService = {
  /**
   * Get all available permissions
   */
  getAllPermissions: async () => {
    try {
      const { data, error } = await supabase
        .from('permissions')
        .select('*')
        .order('code')

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Error fetching permissions:', error)
      return { data: null, error }
    }
  },

  /**
   * Get all roles
   */
  getAllRoles: async () => {
    try {
      const { data, error } = await supabase
        .from('roles')
        .select('*')
        .order('name')

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Error fetching roles:', error)
      return { data: null, error }
    }
  },

  /**
   * Get role with its permissions
   * @param {string} roleId - The role ID
   */
  getRoleWithPermissions: async (roleId) => {
    try {
      const { data, error } = await supabase
        .from('roles')
        .select(
          `
          *,
          role_permissions (
            permission:permission_id (
              id,
              code,
              description
            )
          )
        `,
        )
        .eq('id', roleId)
        .single()

      if (error) throw error

      // Format permissions for easier use
      const permissions = data.role_permissions.map((rp) => rp.permission)

      return {
        data: {
          ...data,
          permissions,
        },
        error: null,
      }
    } catch (error) {
      console.error('Error fetching role with permissions:', error)
      return { data: null, error }
    }
  },

  /**
   * Get user roles and permissions
   * @param {string} userId - The user ID
   */
  getUserRolesAndPermissions: async (userId) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select(
          `
          role:role_id (
            id,
            name,
            description,
            role_permissions (
              permission:permission_id (
                id,
                code,
                description
              )
            )
          ),
          company:company_id (
            id,
            name,
            abbreviation
          )
        `,
        )
        .eq('user_id', userId)

      if (error) throw error

      // Format data for easier use
      const rolesWithPermissions = data.map((ur) => {
        const permissions = ur.role.role_permissions.map((rp) => rp.permission)
        return {
          role: {
            id: ur.role.id,
            name: ur.role.name,
            description: ur.role.description,
          },
          permissions,
          company: ur.company,
        }
      })

      // Extract all unique permission codes
      const allPermissionCodes = new Set()
      rolesWithPermissions.forEach((rwp) => {
        rwp.permissions.forEach((p) => {
          allPermissionCodes.add(p.code)
        })
      })

      return {
        data: {
          roles: rolesWithPermissions,
          permissionCodes: Array.from(allPermissionCodes),
        },
        error: null,
      }
    } catch (error) {
      console.error('Error fetching user roles and permissions:', error)
      return { data: null, error }
    }
  },

  /**
   * Assign role to a user
   * @param {string} userId - The user ID
   * @param {string} roleId - The role ID
   * @param {string} companyId - The company ID
   * @param {string} assignedBy - The ID of the user assigning the role
   */
  assignRoleToUser: async (userId, roleId, companyId, assignedBy) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .insert([
          {
            user_id: userId,
            role_id: roleId,
            company_id: companyId,
            assigned_by: assignedBy,
            assigned_at: new Date().toISOString(),
          },
        ])
        .select()

      if (error) throw error

      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error assigning role to user:', error)
      return { data: null, error }
    }
  },

  /**
   * Remove role from a user
   * @param {string} userId - The user ID
   * @param {string} roleId - The role ID
   * @param {string} companyId - The company ID
   */
  removeRoleFromUser: async (userId, roleId, companyId) => {
    try {
      const { data, error } = await supabase.from('user_roles').delete().match({
        user_id: userId,
        role_id: roleId,
        company_id: companyId,
      })

      if (error) throw error

      return { success: true, error: null }
    } catch (error) {
      console.error('Error removing role from user:', error)
      return { success: false, error }
    }
  },

  /**
   * Update role permissions
   * @param {string} roleId - The role ID
   * @param {string[]} permissionIds - Array of permission IDs to assign
   */
  updateRolePermissions: async (roleId, permissionIds) => {
    try {
      // First, remove all existing permissions for this role
      const { error: deleteError } = await supabase
        .from('role_permissions')
        .delete()
        .eq('role_id', roleId)

      if (deleteError) throw deleteError

      // Then add new permissions
      if (permissionIds.length > 0) {
        const permissionsToInsert = permissionIds.map((permissionId) => ({
          role_id: roleId,
          permission_id: permissionId,
        }))

        const { error: insertError } = await supabase
          .from('role_permissions')
          .insert(permissionsToInsert)

        if (insertError) throw insertError
      }

      return { success: true, error: null }
    } catch (error) {
      console.error('Error updating role permissions:', error)
      return { success: false, error }
    }
  },

  /**
   * Create a new role
   * @param {Object} roleData - The role data
   */
  createRole: async (roleData) => {
    try {
      const { data, error } = await supabase
        .from('roles')
        .insert([
          {
            name: roleData.name,
            description: roleData.description,
          },
        ])
        .select()

      if (error) throw error

      // If permissions are provided, assign them to the role
      if (roleData.permissionIds && roleData.permissionIds.length > 0) {
        await permissionService.updateRolePermissions(
          data[0].id,
          roleData.permissionIds,
        )
      }

      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error creating role:', error)
      return { data: null, error }
    }
  },

  /**
   * Check if a user has a specific permission
   * This is a client-side check using cached permissions
   * @param {string[]} userPermissions - Array of user permission codes
   * @param {string} requiredPermission - The permission code to check
   */
  hasPermission: (userPermissions, requiredPermission) => {
    if (!userPermissions || !requiredPermission) return false
    return userPermissions.includes(requiredPermission)
  },

  /**
   * Group permissions by category
   * Assumes permission codes follow pattern: 'category.action'
   * @param {Array} permissions - List of permission objects
   */
  groupPermissionsByCategory: (permissions) => {
    const grouped = {}

    permissions.forEach((permission) => {
      const [category] = permission.code.split('.')

      if (!grouped[category]) {
        grouped[category] = []
      }

      grouped[category].push(permission)
    })

    return grouped
  },
}

export default permissionService
