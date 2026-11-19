import React, { useState, useEffect } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import { Button, Field, Input, Select, FormCard, LoadingState } from './ui'
import { errorMessage } from '../lib/errorMessage'

const ROLES = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
]

const EMPTY_CREATE = {
  email: '',
  name: '',
  role: 'user',
  password: '',
}

/** Mobile number for phone sign-in and verification codes (SEC-006). */
function PhoneCell({ user, disabled, onSaved, onError }) {
  const setPhone = useMutation(api.users.setPhone)
  const [value, setValue] = useState(user.phone || '')
  const [saving, setSaving] = useState(false)
  const id = user._id || user.id
  const dirty = (value || '') !== (user.phone || '')

  useEffect(() => {
    setValue(user.phone || '')
  }, [user.phone])

  const save = async () => {
    setSaving(true)
    try {
      const result = await setPhone({ id, phone: value.trim() ? value : null })
      setValue(result?.phone || '')
      await onSaved?.()
    } catch (err) {
      onError(errorMessage(err, 'Could not save the phone number'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={`Mobile number for ${user.name || user.email}`}
        type="tel"
        inputMode="tel"
        placeholder="024 412 3456"
        value={value}
        disabled={disabled || saving}
        onChange={(e) => setValue(e.target.value)}
        className="min-w-[10rem]"
      />
      {dirty && (
        <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      )}
    </div>
  )
}

const UserManagement = () => {
  const { user: me, hasRole } = useAuth()
  const createWithPassword = useAction(api.userAccounts.createWithPassword)
  const usersResult = useQuery(api.users.list, {})
  const users = usersResult || []
  const loading = usersResult === undefined
  const updateUser = useMutation(api.users.update)
  const deactivateUser = useMutation(api.users.deactivate)
  const reactivateUser = useMutation(api.users.reactivate)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [form, setForm] = useState(EMPTY_CREATE)
  const [creating, setCreating] = useState(false)
  const joinRequests = useQuery(api.users.listJoinRequests, {})
  const approveJoin = useMutation(api.users.approveJoinRequest)
  const declineJoin = useMutation(api.users.declineJoinRequest)
  const inviteByEmail = useMutation(api.users.invite)
  const [invite, setInvite] = useState({ email: '', roleKey: 'manager' })
  const [inviteLink, setInviteLink] = useState('')
  const [inviting, setInviting] = useState(false)
  const [decidingId, setDecidingId] = useState(null)

  const handleInvite = async (e) => {
    e.preventDefault()
    setInviting(true)
    setError('')
    setSuccess('')
    try {
      const data = await inviteByEmail({ email: invite.email, roleKey: invite.roleKey })
      setInvite({ email: '', roleKey: 'manager' })
      setInviteLink(data?.inviteUrl || '')
      setSuccess(data?.message || 'Invite sent.')
    } catch (err) {
      setError(err.message || 'Failed to invite')
    } finally {
      setInviting(false)
    }
  }

  const decideJoin = async (request, approve) => {
    setDecidingId(request.id)
    setError('')
    setSuccess('')
    try {
      if (approve) {
        await approveJoin({ inviteId: request.id })
        setSuccess(`${request.email} joined the company.`)
      } else {
        await declineJoin({ inviteId: request.id })
        setSuccess(`Declined ${request.email}.`)
      }
    } catch (err) {
      setError(err.message || 'Failed to update the join request')
    } finally {
      setDecidingId(null)
    }
  }

  const handleRoleChange = async (userId, role) => {
    try {
      setSavingId(userId)
      setError('')
      await updateUser({ id: userId, patch: { role } })
    } catch (err) {
      console.error('Error updating user:', err)
      setError(err.message || 'Failed to update role')
    } finally {
      setSavingId(null)
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setCreating(true)
    setError('')
    setSuccess('')
    const emailForMessage = form.email
    try {
      if (!form.password || form.password.length < 6) {
        throw new Error('Temporary password must be at least 6 characters')
      }
      const data = await createWithPassword({
        email: form.email,
        name: form.name || undefined,
        role: form.role || 'user',
        password: form.password,
      })
      setForm(EMPTY_CREATE)
      setSuccess(
        data?.message ||
          `Created ${emailForMessage}. Share the temporary password securely — they must change it on first login.`,
      )
    } catch (err) {
      setError(err.message || 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  const toggleActive = async (user) => {
    const id = user._id || user.id
    try {
      setSavingId(id)
      if (user.active === false) {
        await reactivateUser({ id })
      } else {
        await deactivateUser({ id })
      }
    } catch (err) {
      setError(err.message || 'Failed to update user')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return <LoadingState label="Loading users…" />
  }

  return (
    <div className="space-y-6">
      <FormCard
        title="Add user"
        subtitle="Create a login with a temporary password. They must change it after signing in."
      >
        <form
          onSubmit={handleCreate}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
        >
          <Field label="Email" required>
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label="Role">
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <Field label="Temporary password" required hint="Min 6 characters">
            <Input
              type="text"
              required
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
              className="font-data tabular-nums"
            />
          </Field>
          <Button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create user'}
          </Button>
        </form>
      </FormCard>

      <FormCard
        title="Invite by email"
        subtitle="We email a link that works once and expires in 7 days. People who already use PBA Farm for another organization can be invited too."
      >
        <form
          onSubmit={handleInvite}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
        >
          <Field label="Email" required>
            <Input
              type="email"
              required
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label="Role">
            <Select
              value={invite.roleKey}
              onChange={(e) => setInvite({ ...invite, roleKey: e.target.value })}
            >
              <option value="manager">Manager</option>
              <option value="field_staff">Field staff</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <Button type="submit" disabled={inviting}>
            {inviting ? 'Sending…' : 'Send invite'}
          </Button>
        </form>
        {inviteLink && (
          <div className="mt-4 space-y-1.5">
            <p className="text-sm text-muted">
              Or share this link directly. It only works for the invited email.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={inviteLink} className="font-data text-sm" aria-label="Invite link" />
              <Button
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(inviteLink)}
              >
                Copy
              </Button>
            </div>
          </div>
        )}
      </FormCard>

      <FormCard
        title="Pending join requests"
        subtitle="People who signed in with an invited email and asked to join. Approve only people you expect."
      >
        {joinRequests === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : joinRequests.length === 0 ? (
          <p className="text-sm text-muted">No pending requests.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {joinRequests.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="text-sm">
                  <p className="font-medium text-chart-ink">
                    {request.name || request.email}
                  </p>
                  <p className="text-muted">
                    <span className="font-data">{request.email}</span> · as{' '}
                    {request.role === 'admin' ? 'Admin' : 'User'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={decidingId === request.id}
                    onClick={() => decideJoin(request, true)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={decidingId === request.id}
                    onClick={() => decideJoin(request, false)}
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </FormCard>

      {success && (
        <div role="status" className="rounded-lg bg-kelp/10 text-kelp border border-kelp/20 px-4 py-3 text-sm">
          {success}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg bg-signal/10 text-signal border border-signal/20 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="page-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-foam">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">Mobile</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No users found for this company.
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const id = user._id || user.id
                  const isMe = id === (me?._id || me?.id)
                  // Only a super_admin can change a super_admin account (backend).
                  const locked =
                    (user.role || 'user') === 'super_admin' && !hasRole?.('super_admin')
                  return (
                    <tr key={id} className="border-t border-foam-deep hover:bg-foam">
                      <td className="px-4 py-3 text-sm text-chart-ink">{user.name || '—'}</td>
                      <td className="px-4 py-3 font-data text-sm text-chart-ink">{user.email}</td>
                      <td className="px-4 py-3">
                        <PhoneCell
                          user={user}
                          disabled={locked}
                          onError={setError}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          aria-label={`Role for ${user.name || user.email}`}
                          value={user.role || 'user'}
                          disabled={savingId === id || isMe || locked}
                          onChange={(e) => handleRoleChange(id, e.target.value)}
                          className="min-w-[9rem]"
                        >
                          {ROLES.filter(
                            (r) =>
                              r.value !== 'super_admin' ||
                              hasRole?.('super_admin') ||
                              locked,
                          ).map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {user.active === false ? (
                          <span className="text-signal font-medium">Inactive</span>
                        ) : user.mustChangePassword ? (
                          <span className="text-amber-700 dark:text-amber-300 font-medium">Must change password</span>
                        ) : (
                          <span className="text-kelp font-medium">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!isMe && !locked && (
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
