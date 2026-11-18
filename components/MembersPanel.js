import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { errorMessage } from '../lib/errorMessage'
import { Button, FormCard, Select } from './ui'

export const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'field_staff', label: 'Field staff' },
  { value: 'viewer', label: 'Viewer' },
]

const STATUS_TONE = {
  active: 'text-kelp',
  suspended: 'text-signal',
}

/**
 * Organization members and open invites (ORG-002). Roles and suspension are
 * per organization: suspending someone here does not touch their access to
 * other organizations.
 */
export default function MembersPanel() {
  const { user: me } = useAuth()
  const members = useQuery(api.memberships.listMembers, {})
  const invites = useQuery(api.memberships.listInvites, {})
  const setRole = useMutation(api.memberships.setRole)
  const suspend = useMutation(api.memberships.suspend)
  const reactivate = useMutation(api.memberships.reactivate)
  const remove = useMutation(api.memberships.remove)
  const revokeInvite = useMutation(api.memberships.revokeInvite)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const run = async (key, fn) => {
    setBusy(key)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err, 'Could not update the member'))
    } finally {
      setBusy(null)
    }
  }

  const myId = me?._id || me?.id

  return (
    <div className="space-y-6">
      <FormCard
        title="Members and roles"
        subtitle="Roles apply to this organization only. Suspending or removing someone leaves their other organizations alone."
      >
        {error && (
          <div role="alert" className="mb-3 rounded-lg bg-signal/10 text-signal border border-signal/20 px-3 py-2 text-sm">
            {error}
          </div>
        )}
        {members === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <ul className="divide-y divide-foam-deep">
            {members.map((m) => {
              const isMe = m.userId === myId
              const key = m.userId
              return (
                <li key={key} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium text-chart-ink truncate">{m.name || m.email}</p>
                    <p className="text-muted font-data truncate">{m.email}</p>
                  </div>
                  <span className={`text-sm font-medium ${STATUS_TONE[m.status] || 'text-muted'}`}>
                    {m.status === 'active' ? 'Active' : 'Suspended'}
                  </span>
                  <Select
                    aria-label={`Role for ${m.name || m.email}`}
                    value={m.roleKey}
                    disabled={isMe || busy === key}
                    onChange={(e) =>
                      run(key, () => setRole({ userId: m.userId, roleKey: e.target.value }))
                    }
                    className="w-40"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                  {!isMe && (
                    <div className="flex gap-2">
                      {m.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === key}
                          onClick={() => run(key, () => suspend({ userId: m.userId }))}
                        >
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === key}
                          onClick={() => run(key, () => reactivate({ userId: m.userId }))}
                        >
                          Reactivate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === key}
                        onClick={() => {
                          if (window.confirm(`Remove ${m.email} from this organization?`)) {
                            run(key, () => remove({ userId: m.userId }))
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </FormCard>

      <FormCard title="Open invites" subtitle="Links that have not been used yet.">
        {invites === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-muted">No open invites.</p>
        ) : (
          <ul className="divide-y divide-foam-deep">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-data text-chart-ink">{i.email}</p>
                  <p className="text-muted">
                    {ROLE_OPTIONS.find((r) => r.value === i.roleKey)?.label || i.roleKey}
                    {' · '}
                    {i.state === 'expired'
                      ? 'Expired'
                      : i.expiresAt
                        ? `Expires ${new Date(i.expiresAt).toLocaleDateString()}`
                        : 'No link yet (older invite)'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === i.id}
                  onClick={() => run(i.id, () => revokeInvite({ inviteId: i.id }))}
                >
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
        )}
      </FormCard>
    </div>
  )
}
