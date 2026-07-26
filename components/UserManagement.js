import React, { useState, useEffect } from 'react'
import userService from '../lib/userService'
import { useAuth } from '../contexts/AuthContext'

const ROLES = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
]

const UserManagement = () => {
  const { user: me, hasRole } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      setLoading(true)
      setError('')
      const response = await userService.listUsers()
      if (response.error) throw response.error
      setUsers(response.data || [])
    } catch (err) {
      console.error('Error loading users:', err)
      setError(err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleRoleChange = async (userId, role) => {
    try {
      setSavingId(userId)
      setError('')
      const { error: updateError } = await userService.updateUser(userId, { role })
      if (updateError) throw updateError
      await loadUsers()
    } catch (err) {
      console.error('Error updating user:', err)
      setError(err.message || 'Failed to update role')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return <div className="p-4 text-chart-ink">Loading users…</div>
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-chart-ink">User Management</h2>
          <p className="text-sm text-muted mt-1">
            Roles: user (ops), admin (company), super_admin (platform).
            New accounts sign up themselves; admins assign roles here.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 text-red-800 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="page-card border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-foam">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-chart-ink">Name</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-chart-ink">Email</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-chart-ink">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted">
                    No users found for this company.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user._id || user.id} className="border-t border-gray-100">
                    <td className="px-4 py-3">{user.name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-sm">{user.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role || 'user'}
                        disabled={
                          savingId === (user._id || user.id) ||
                          (user._id || user.id) === (me?._id || me?.id)
                        }
                        onChange={(e) =>
                          handleRoleChange(user._id || user.id, e.target.value)
                        }
                        className="border border-input-border rounded-md px-3 py-1.5 text-sm focus:ring-lagoon-800 focus:border-lagoon-800"
                      >
                        {ROLES.filter((r) =>
                          r.value !== 'super_admin' || hasRole?.('super_admin'),
                        ).map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default UserManagement
