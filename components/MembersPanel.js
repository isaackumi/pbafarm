import { useState } from 'react'
import { useLocation } from '../contexts/LocationContext'
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
  const setSites = useMutation(api.memberships.setSites)
  const roles = useQuery(api.roles.list, {})
  const { locations } = useLocation()
  const [sitesFor, setSitesFor] = useState(null)
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
                    value={m.roleId ? `custom:${m.roleId}` : m.roleKey}
                    disabled={isMe || busy === key}
                    onChange={(e) => {
                      const value = e.target.value
                      run(key, () =>
                        value.startsWith('custom:')
                          ? setRole({ userId: m.userId, roleId: value.slice(7) })
                          : setRole({ userId: m.userId, roleKey: value }),
                      )
                    }}
                    className="w-40"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                    {(roles?.custom || []).map((r) => (
                      <option key={r.id} value={`custom:${r.id}`}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === key}
                    onClick={() =>
                      setSitesFor({
                        userId: m.userId,
                        label: m.name || m.email,
                        allLocations: m.allLocations,
                        locationIds: m.allLocations ? [] : m.locationIds,
                      })
                    }
                  >
                    {m.allLocations ? 'All sites' : `${m.locationIds.length} site${m.locationIds.length === 1 ? '' : 's'}`}
                  </Button>
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
        {sitesFor && (
          <div className="mt-4 rounded-xl border border-foam-deep p-4 space-y-3">
            <p className="text-sm font-semibold text-chart-ink">Sites for {sitesFor.label}</p>
            <label className="flex items-center gap-3 min-h-11 text-sm text-chart-ink cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-lake"
                checked={sitesFor.allLocations}
                onChange={(e) => setSitesFor((s) => ({ ...s, allLocations: e.target.checked }))}
              />
              Every site, including new ones
            </label>
            {!sitesFor.allLocations && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {(locations || []).map((loc) => {
                  const id = loc.id || loc._id
                  return (
                    <label key={id} className="flex items-center gap-3 min-h-11 text-sm text-chart-ink cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-lake"
                        checked={sitesFor.locationIds.includes(id)}
                        onChange={() =>
                          setSitesFor((s) => ({
                            ...s,
                            locationIds: s.locationIds.includes(id)
                              ? s.locationIds.filter((x) => x !== id)
                              : [...s.locationIds, id],
                          }))
                        }
                      />
                      {loc.name}
                    </label>
                  )
                })}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy === sitesFor.userId}
                onClick={() =>
                  run(sitesFor.userId, async () => {
                    await setSites({
                      userId: sitesFor.userId,
                      allLocations: sitesFor.allLocations,
                      ...(sitesFor.allLocations ? {} : { locationIds: sitesFor.locationIds }),
                    })
                    setSitesFor(null)
                  })
                }
              >
                Save sites
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSitesFor(null)}>
                Cancel
              </Button>
            </div>
          </div>
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
