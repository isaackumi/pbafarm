// lib/userService.js
import { supabase } from './supabase'

const userService = {
  // Get users by company ID (for company management)
  getUsersByCompany: async (companyId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          `
          id,
          email,
          full_name,
          role,
          created_at,
          last_sign_in_at
        `,
        )
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Error fetching company users:', error)
      return { data: null, error }
    }
  },

  // Create a new user for a specific company
  createUser: async (userData, companyId) => {
    try {
      // Create user in auth
      const {
        data: authData,
        error: authError,
      } = await supabase.auth.admin.createUser({
        email: userData.email,
        password: userData.password,
        email_confirm: true, // Auto-confirm email for admin-created users
        user_metadata: {
          full_name: userData.full_name,
        },
      })

      if (authError) throw authError

      // Update profile with company ID and role
      const { data, error } = await supabase
        .from('profiles')
        .update({
          company_id: companyId,
          role: userData.role || 'user',
        })
        .eq('id', authData.user.id)
        .select()

      if (error) throw error

      // Assign appropriate role permissions
      await assignUserRole(authData.user.id, userData.role, companyId)

      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error creating user:', error)
      return { data: null, error }
    }
  },

  // Update user details (role, etc.)
  updateUser: async (userId, userData) => {
    try {
      // Update profile data
      const { data, error } = await supabase
        .from('profiles')
        .update({
          full_name: userData.full_name,
          role: userData.role,
        })
        .eq('id', userId)
        .select()

      if (error) throw error

      // Update role assignments if role changed
      if (userData.role) {
        await updateUserRole(userId, userData.role, data[0].company_id)
      }

      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error updating user:', error)
      return { data: null, error }
    }
  },

  // Deactivate user (safer than deletion)
  deactivateUser: async (userId) => {
    try {
      // Disable user login
      const {
        error: authError,
      } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: { active: false },
      })

      if (authError) throw authError

      // Update profile
      const { data, error } = await supabase
        .from('profiles')
        .update({ active: false })
        .eq('id', userId)
        .select()

      if (error) throw error

      return { data: data[0], error: null }
    } catch (error) {
      console.error('Error deactivating user:', error)
      return { data: null, error }
    }
  },
}

// Helper function to assign user role
async function assignUserRole(userId, roleName, companyId) {
  try {
    // Get role ID
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('name', roleName)
      .single()

    if (roleError) throw roleError

    // Assign role to user
    const { error } = await supabase.from('user_roles').insert([
      {
        user_id: userId,
        role_id: roleData.id,
        company_id: companyId,
      },
    ])

    if (error) throw error

    return true
  } catch (error) {
    console.error('Error assigning user role:', error)
    throw error
  }
}

// Helper function to update user role
async function updateUserRole(userId, roleName, companyId) {
  try {
    // Get role ID
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('name', roleName)
      .single()

    if (roleError) throw roleError

    // Remove existing roles
    const { error: deleteError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', companyId)

    if (deleteError) throw deleteError

    // Assign new role
    const { error } = await supabase.from('user_roles').insert([
      {
        user_id: userId,
        role_id: roleData.id,
        company_id: companyId,
      },
    ])

    if (error) throw error

    return true
  } catch (error) {
    console.error('Error updating user role:', error)
    throw error
  }
}

export default userService
