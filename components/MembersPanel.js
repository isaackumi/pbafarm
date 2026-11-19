import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, UserRound } from 'lucide-react'
import { useLocation } from '../contexts/LocationContext'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'
import { Avatar, CheckCell, GhostButton, GradientButton, Pill, Segmented, Table } from './ui'
import { CardNote, DangerRow, FIELD, InlineError, SettingsCard, SettingsRow } from './settings'

export const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'field_staff', label: 'Field staff' },
  { value: 'viewer', label: 'Viewer' },
]

const ROLE_TONE = { owner: 'pink', admin: 'pink', manager: 'cyan' }

/** Display name of a member's role: custom role name, else the template label. */
export function useRoleLabel() {
  const t = useT()
  const roles = useQuery(api.roles.list, {})
  return (roleKey, roleId) => {
    if (roleId) {
      const custom = (roles?.custom || []).find((r) => r.id === roleId)
      if (custom) return custom.name
    }
    return t.or(`settingsUi.team.role.${roleKey}`, roleKey)
  }
}

function useSiteNames() {
  const { locations } = useLocation()
  return useMemo(() => {
    const map = new Map()
    for (const loc of locations || []) map.set(loc.id || loc._id, loc.name)
    return map
  }, [locations])
}

/**
 * Paper 14 Settings Team (38C-0): role summary cards and the members table.
 * Pending invites join the table under the Invited tab. Roles and suspension
 * apply to this organization only (ORG-002).
 */
export default function MembersPanel() {
  const t = useT()
  const members = useQuery(api.memberships.listMembers, {})
  const invites = useQuery(api.memberships.listInvites, {})
  const revokeInvite = useMutation(api.memberships.revokeInvite)
  const roles = useQuery(api.roles.list, {})
  const roleLabel = useRoleLabel()
  const siteNames = useSiteNames()
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const counts = useMemo(() => {
    const c = {}
    for (const m of members || []) c[m.roleKey] = (c[m.roleKey] || 0) + 1
    return c
  }, [members])

  const sitesText = (m) => {
    if (m.allLocations) return t('settingsUi.team.allSites')
    const names = m.locationIds.map((id) => siteNames.get(id)).filter(Boolean)
    if (names.length === 0) return t('settingsUi.team.noSites')
    if (names.length <= 2) return names.join(', ')
    return t('settingsUi.team.siteCount', { count: names.length })
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const memberRows = (members || []).map((m) => ({ kind: 'member', id: m.userId, ...m }))
    const inviteRows = (invites || []).map((i) => ({
      kind: 'invite',
      id: i.id,
      name: null,
      email: i.email,
      roleKey: i.roleKey,
      roleId: null,
      status: i.state === 'expired' ? 'expired' : 'invited',
      expiresAt: i.expiresAt,
    }))
    const all =
      tab === 'active'
        ? memberRows.filter((m) => m.status === 'active')
        : tab === 'invited'
          ? inviteRows
          : [...memberRows, ...inviteRows]
    if (!q) return all
    return all.filter((r) => `${r.name || ''} ${r.email || ''}`.toLowerCase().includes(q))
  }, [members, invites, tab, search])

  const withdraw = async (row) => {
    setBusy(row.id)
    setError('')
    try {
      await revokeInvite({ inviteId: row.id })
    } catch (err) {
      setError(errorMessage(err, t('settingsUi.team.updateFailed')))
    } finally {
      setBusy(null)
    }
  }

  const STATUS = {
    active: { tone: 'green', label: t('settingsUi.team.status.active') },
    suspended: { tone: 'red', label: t('settingsUi.team.status.suspended') },
    invited: { tone: 'amber', label: t('settingsUi.team.status.invited') },
    expired: { tone: 'neutral', label: t('settingsUi.team.status.expired') },
  }

  const columns = [
    {
      key: 'name',
      header: t('settingsUi.team.col.name'),
      render: (r) =>
        r.kind === 'member' ? (
          <Link
            href={`/users?member=${r.userId}`}
            className="flex min-w-0 items-center gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          >
            <span className="truncate hover:underline">
              {r.name || r.email}
              {r.name && r.email ? ` · ${r.email}` : null}
            </span>
          </Link>
        ) : (
          <span className="block min-w-0 truncate">{r.email}</span>
        ),
    },
    {
      key: 'role',
      header: t('settingsUi.team.col.role'),
      width: 130,
      render: (r) => <Pill tone={ROLE_TONE[r.roleKey] || 'neutral'}>{roleLabel(r.roleKey, r.roleId)}</Pill>,
    },
    {
      key: 'sites',
      header: t('settingsUi.team.col.sites'),
      width: 150,
      render: (r) => (r.kind === 'member' ? sitesText(r) : '—'),
    },
    {
      key: 'status',
      header: t('settingsUi.team.col.status'),
      width: 190,
      align: 'right',
      render: (r) => {
        const s = STATUS[r.status] || STATUS.active
        return (
          <span className="inline-flex items-center justify-end gap-2">
            {r.kind === 'invite' && (
              <GhostButton size="sm" disabled={busy === r.id} onClick={() => withdraw(r)}>
                {t('settingsUi.team.withdraw')}
              </GhostButton>
            )}
            <Pill tone={s.tone}>{s.label}</Pill>
          </span>
        )
      },
    },
  ]

  const templates = roles?.templates || []

  return (
    <div className="flex flex-col gap-5">
      {templates.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label={t('settingsUi.team.rolesSummary')}>
          {templates.map((r) => (
            <li
              key={r.key}
              className="flex flex-col gap-[6px] rounded-card border border-line bg-surface px-[22px] py-5 shadow-[var(--shadow-card)]"
            >
              <span className="text-[14px] font-semibold leading-[18px] text-text">
                {t.or(`settingsUi.team.role.${r.key}`, r.name)}
              </span>
              <span className="text-[12px] leading-4 text-muted">
                {t.or(`settingsUi.team.roleBlurb.${r.key}`, '')}
                {' · '}
                {t('settingsUi.team.memberCount', { count: counts[r.key] || 0 })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <InlineError>{error}</InlineError>
      <Table
        title={t('settingsUi.team.members')}
        tabs={[
          { value: 'all', label: t('settingsUi.team.tab.all') },
          { value: 'active', label: t('settingsUi.team.tab.active') },
          { value: 'invited', label: t('settingsUi.team.tab.invited') },
        ]}
        tab={tab}
        onTabChange={setTab}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('settingsUi.team.search')}
        columns={columns}
        rows={members === undefined ? [] : rows}
        rowKey={(r) => `${r.kind}:${r.id}`}
        empty={members === undefined ? t('common.loading') : t('settingsUi.team.empty')}
      />
    </div>
  )
}

/**
 * Paper 23 Member access (5OB-0): profile, role, site scope and the
 * permissions that role grants. Save applies role and site changes together.
 */
export function MemberDetail({ userId, renderShell }) {
  const t = useT()
  const { user: me } = useAuth()
  const members = useQuery(api.memberships.listMembers, {})
  const roles = useQuery(api.roles.list, {})
  const setRole = useMutation(api.memberships.setRole)
  const suspend = useMutation(api.memberships.suspend)
  const reactivate = useMutation(api.memberships.reactivate)
  const remove = useMutation(api.memberships.remove)
  const setSites = useMutation(api.memberships.setSites)
  const { locations } = useLocation()
  const roleLabel = useRoleLabel()
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const member = (members || []).find((m) => m.userId === userId)
  const isMe = member && member.userId === (me?._id || me?.id)
  const roleValue = member ? (member.roleId ? `custom:${member.roleId}` : member.roleKey) : ''
  const state = draft || {
    role: roleValue,
    allLocations: member?.allLocations ?? true,
    locationIds: member && !member.allLocations ? member.locationIds : [],
  }
  const sitesDirty =
    member &&
    (state.allLocations !== member.allLocations ||
      (!state.allLocations &&
        (state.locationIds.length !== member.locationIds.length ||
          state.locationIds.some((id) => !member.locationIds.includes(id)))))
  const dirty = member && (state.role !== roleValue || sitesDirty)

  const permissionLabels = useMemo(() => {
    const map = new Map()
    for (const g of roles?.catalog || []) for (const p of g.permissions) map.set(p.key, p.label)
    return map
  }, [roles])

  const granted = useMemo(() => {
    if (!roles || !state.role) return []
    const perms = state.role.startsWith('custom:')
      ? roles.custom.find((r) => r.id === state.role.slice(7))?.permissions
      : roles.templates.find((r) => r.key === state.role)?.permissions
    return perms || []
  }, [roles, state.role])

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err, t('settingsUi.team.updateFailed')))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      if (state.role !== roleValue) {
        await (state.role.startsWith('custom:')
          ? setRole({ userId, roleId: state.role.slice(7) })
          : setRole({ userId, roleKey: state.role }))
      }
      if (sitesDirty) {
        await setSites({
          userId,
          allLocations: state.allLocations,
          ...(state.allLocations ? {} : { locationIds: state.locationIds }),
        })
      }
      setDraft(null)
    })

  const update = (patch) => setDraft({ ...state, ...patch })
  const label = member ? member.name || member.email : ''
  const currentRole = state.role.startsWith('custom:')
    ? roleLabel(null, state.role.slice(7))
    : roleLabel(state.role)

  const actions = member && !isMe && (
    <>
      <GradientButton icon={Check} disabled={!dirty || busy} onClick={save}>
        {t('settingsUi.team.save')}
      </GradientButton>
      <GradientButton
        reverse
        icon={UserRound}
        disabled={busy}
        onClick={() =>
          run(() => (member.status === 'active' ? suspend({ userId }) : reactivate({ userId })))
        }
      >
        {member.status === 'active' ? t('settingsUi.team.suspend') : t('settingsUi.team.reactivate')}
      </GradientButton>
    </>
  )

  let body
  if (members === undefined) {
    body = <SettingsCard><CardNote>{t('common.loading')}</CardNote></SettingsCard>
  } else if (!member) {
    body = (
      <SettingsCard title={t('settingsUi.team.notFound')}>
        <CardNote>
          <Link href="/users" className="text-pearl-cyan hover:underline">
            {t('settingsUi.team.backToMembers')}
          </Link>
        </CardNote>
      </SettingsCard>
    )
  } else {
    body = (
      <>
        <GhostButton size="sm" href="/users" icon={ArrowLeft} className="self-start">
          {t('settingsUi.team.backToMembers')}
        </GhostButton>
        <InlineError>{error}</InlineError>
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="flex flex-wrap items-center gap-[18px] rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px]">
              <Avatar name={label} size={56} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-[10px]">
                  <span className="text-[20px] font-semibold leading-6 text-text">{label}</span>
                  <Pill tone={member.status === 'active' ? 'green' : 'red'}>
                    {t(`settingsUi.team.status.${member.status === 'active' ? 'active' : 'suspended'}`)}
                  </Pill>
                </div>
                {member.email && <span className="truncate text-[13px] leading-4 text-muted">{member.email}</span>}
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <span className="text-[12px] leading-4 text-muted">{t('settingsUi.team.col.role')}</span>
                <span className="text-[14px] leading-[18px] text-text">{roleLabel(member.roleKey, member.roleId)}</span>
              </div>
            </section>

            <SettingsCard title={t('settingsUi.team.roleCard')}>
              <SettingsRow
                label={t('settingsUi.team.roleHere')}
                helper={isMe ? t('settingsUi.team.ownRole') : t('settingsUi.team.roleHelper')}
                htmlFor="member-role"
              >
                <select
                  id="member-role"
                  className={`${FIELD} w-48 py-2`}
                  value={state.role}
                  disabled={isMe || busy}
                  onChange={(e) => update({ role: e.target.value })}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {t.or(`settingsUi.team.role.${r.value}`, r.label)}
                    </option>
                  ))}
                  {(roles?.custom || []).map((r) => (
                    <option key={r.id} value={`custom:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard
              title={t('settingsUi.team.siteScope')}
              action={
                <Segmented
                  label={t('settingsUi.team.siteScope')}
                  value={state.allLocations ? 'all' : 'selected'}
                  onChange={(v) => update({ allLocations: v === 'all' })}
                  options={[
                    { value: 'all', label: t('settingsUi.team.allLocations') },
                    { value: 'selected', label: t('settingsUi.team.selected') },
                  ]}
                />
              }
            >
              {state.allLocations ? (
                <CardNote>{t('settingsUi.team.allLocationsHelper')}</CardNote>
              ) : (locations || []).length === 0 ? (
                <CardNote>{t('settingsUi.team.noLocations')}</CardNote>
              ) : (
                <ul className="flex flex-col gap-[14px]">
                  {(locations || []).map((loc) => {
                    const id = loc.id || loc._id
                    const on = state.locationIds.includes(id)
                    return (
                      <li key={id} className="flex items-center gap-[10px] rounded-input border border-line bg-bg px-[14px] py-3">
                        <CheckCell
                          checked={on}
                          label={loc.name}
                          onChange={() =>
                            update({
                              locationIds: on
                                ? state.locationIds.filter((x) => x !== id)
                                : [...state.locationIds, id],
                            })
                          }
                        />
                        <span className="text-[14px] leading-[18px] text-text">{loc.name}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </SettingsCard>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <SettingsCard
              title={t('settingsUi.team.effective')}
              meta={t('settingsUi.team.grantedCount', { count: granted.length })}
            >
              {granted.length === 0 ? (
                <CardNote>{t('settingsUi.team.noPermissions')}</CardNote>
              ) : (
                granted.map((key) => (
                  <SettingsRow key={key} label={permissionLabels.get(key) || key}>
                    <Pill>{currentRole}</Pill>
                  </SettingsRow>
                ))
              )}
            </SettingsCard>
            {!isMe && (
              <SettingsCard title={t('settingsUi.team.dangerTitle')}>
                <DangerRow label={t('settingsUi.team.remove')} helper={t('settingsUi.team.removeHelper')}>
                  <GhostButton
                    tone="danger"
                    disabled={busy}
                    style={{ borderColor: 'var(--pill-red-border)' }}
                    onClick={() => {
                      if (window.confirm(t('settingsUi.team.removeConfirm', { email: member.email || label }))) {
                        run(async () => {
                          await remove({ userId })
                          window.location.assign('/users')
                        })
                      }
                    }}
                  >
                    {t('settingsUi.team.removeAction')}
                  </GhostButton>
                </DangerRow>
              </SettingsCard>
            )}
          </div>
        </div>
      </>
    )
  }

  return renderShell({ name: label, actions, children: body })
}
