import React, { useState, useEffect } from 'react'
import userService from '../lib/userService'
import { useAuth } from '../contexts/AuthContext'
import { Button, Field, Input, Select, FormCard } from './ui'

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
  const [invite, setInvite] = useState({ email: '', name: '', role: 'user' })
  const [inviting, setInviting] = useState(false)

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

  const handleInvite = async (e) => {
    e.preventDefault()
    setInviting(true)
    setError('')
    try {
      const { data, error: inviteError } = await userService.inviteUser(invite)
      if (inviteError) throw inviteError
      setInvite({ email: '', name: '', role: 'user' })
      await loadUsers()
      if (data?.status === 'pending_signup') {
        setError('')
        alert(data.message)
      }
    } catch (err) {
      setError(err.message || 'Invite failed')
    } finally {
      setInviting(false)
    }
  }

  const toggleActive = async (user) => {
    const id = user._id || user.id
    try {
      setSavingId(id)
      if (user.active === false) {
        await userService.reactivateUser(id)
      } else {
        await userService.deactivateUser(id)
      }
      await loadUsers()
    } catch (err) {
      setError(err.message || 'Failed to update user')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return <div className="p-4 text-chart-ink">Loading users…</div>
  }

  return (
    <div className="space-y-6">
      <FormCard title="Invite user" subtitle="Existing accounts are assigned immediately. New emails must sign up to join.">
        <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <Field label="Email" required>
            <Input
              type="email"
              required
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <Input
              value={invite.name}
              onChange={(e) => setInvite({ ...invite, name: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select
              value={invite.role}
              onChange={(e) => setInvite({ ...invite, role: e.target.value })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <Button type="submit" disabled={inviting}>
            {inviting ? 'Inviting…' : 'Invite'}
          </Button>
        </form>
      </FormCard>

      {error && (
        <div className="rounded-xl bg-signal/10 text-signal px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="page-card border border-zinc-200/90 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-foam">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-chart-ink">Name</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-chart-ink">Email</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-chart-ink">Role</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-chart-ink">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-chart-ink">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No users found for this company.
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const id = user._id || user.id
                  const isMe = id === (me?._id || me?.id)
                  return (
                    <tr key={id} className="border-t border-zinc-100">
                      <td className="px-4 py-3">{user.name || '—'}</td>
                      <td className="px-4 py-3 font-data text-sm">{user.email}</td>
                      <td className="px-4 py-3">
                        <select
                          value={user.role || 'user'}
                          disabled={savingId === id || isMe}
                          onChange={(e) => handleRoleChange(id, e.target.value)}
                          className="border border-zinc-200 rounded-xl px-3 py-1.5 text-sm bg-white"
                        >
                          {ROLES.filter(
                            (r) =>
                              r.value !== 'super_admin' || hasRole?.('super_admin'),
                          ).map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {user.active === false ? (
                          <span className="text-signal font-medium">Inactive</span>
                        ) : (
                          <span className="text-kelp font-medium">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!isMe && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={savingId === id}
                            onClick={() => toggleActive(user)}
                          >
                            {user.active === false ? 'Reactivate' : 'Deactivate'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default UserManagement
