import React, { useState, useEffect } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import { GhostButton, GradientButton, Pill, Table } from './ui'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'
import { CardNote, FIELD, FIELD_LABEL, InlineError, InlineSuccess, SettingsCard, SettingsRow } from './settings'

const ROLES = ['user', 'admin', 'super_admin']

const EMPTY_CREATE = {
  email: '',
  name: '',
  role: 'user',
  password: '',
}

/** Mobile number for phone sign-in and verification codes (SEC-006). */
function PhoneCell({ user, disabled, onSaved, onError }) {
  const t = useT()
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
      onError(errorMessage(err, t('settingsUi.users.phoneFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={t('settingsUi.users.mobileFor', { name: user.name || user.email })}
        type="tel"
        inputMode="tel"
        placeholder="024 412 3456"
        value={value}
        disabled={disabled || saving}
        onChange={(e) => setValue(e.target.value)}
        className={`${FIELD} w-40 py-2 font-data`}
      />
      {dirty && (
        <GhostButton size="sm" disabled={saving} onClick={save}>
          {saving ? t('settingsUi.saving') : t('common.save')}
        </GhostButton>
      )}
    </div>
  )
}

const UserManagement = () => {
  const t = useT()
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
      setSuccess(data?.message || t('settingsUi.users.inviteSent'))
    } catch (err) {
      setError(errorMessage(err, t('settingsUi.users.inviteFailed')))
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
        setSuccess(t('settingsUi.users.joined', { email: request.email }))
      } else {
        await declineJoin({ inviteId: request.id })
        setSuccess(t('settingsUi.users.declined', { email: request.email }))
      }
    } catch (err) {
      setError(errorMessage(err, t('settingsUi.users.joinFailed')))
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
      setError(errorMessage(err, t('settingsUi.users.roleFailed')))
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
        throw new Error(t('settingsUi.users.passwordShort'))
      }
      const data = await createWithPassword({
        email: form.email,
        name: form.name || undefined,
        role: form.role || 'user',
        password: form.password,
      })
      setForm(EMPTY_CREATE)
      setSuccess(data?.message || t('settingsUi.users.created', { email: emailForMessage }))
    } catch (err) {
      setError(errorMessage(err, t('settingsUi.users.createFailed')))
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
      setError(errorMessage(err, t('settingsUi.users.updateFailed')))
    } finally {
      setSavingId(null)
    }
  }

  const myId = me?._id || me?.id
  const roleLabel = (role) => t(`settingsUi.users.legacyRole.${role || 'user'}`)

  const columns = [
    {
      key: 'name',
      header: t('settingsUi.team.col.name'),
      render: (user) => user.name || '—',
      sub: (user) => <span className="font-data">{user.email}</span>,
    },
    {
      key: 'phone',
      header: t('settingsUi.users.mobile'),
      width: 230,
      render: (user) => (
        <PhoneCell
          user={user}
          disabled={(user.role || 'user') === 'super_admin' && !hasRole?.('super_admin')}
          onError={setError}
        />
      ),
    },
    {
      key: 'role',
      header: t('settingsUi.users.accessLevel'),
      width: 170,
      render: (user) => {
        const id = user._id || user.id
        // Only a super_admin can change a super_admin account (backend).
        const locked = (user.role || 'user') === 'super_admin' && !hasRole?.('super_admin')
        return (
          <select
            aria-label={t('settingsUi.users.roleFor', { name: user.name || user.email })}
            value={user.role || 'user'}
            disabled={savingId === id || id === myId || locked}
            onChange={(e) => handleRoleChange(id, e.target.value)}
            className={`${FIELD} w-36 py-2`}
          >
            {ROLES.filter((r) => r !== 'super_admin' || hasRole?.('super_admin') || locked).map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        )
      },
    },
    {
      key: 'status',
      header: t('settingsUi.team.col.status'),
      width: 260,
      align: 'right',
      render: (user) => {
        const id = user._id || user.id
        const locked = (user.role || 'user') === 'super_admin' && !hasRole?.('super_admin')
        return (
          <span className="inline-flex items-center justify-end gap-2">
            {id !== myId && !locked && (
              <GhostButton size="sm" disabled={savingId === id} onClick={() => toggleActive(user)}>
                {user.active === false ? t('settingsUi.team.reactivate') : t('settingsUi.users.deactivate')}
              </GhostButton>
            )}
            {user.active === false ? (
              <Pill tone="red">{t('settingsUi.users.inactive')}</Pill>
            ) : user.mustChangePassword ? (
              <Pill tone="amber">{t('settingsUi.users.mustChange')}</Pill>
            ) : (
              <Pill tone="green">{t('settingsUi.team.status.active')}</Pill>
            )}
          </span>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard id="invite" title={t('settingsUi.users.inviteTitle')} meta={t('settingsUi.users.inviteMeta')}>
        <form onSubmit={handleInvite} className="grid grid-cols-1 items-end gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
          <div>
            <label htmlFor="invite-email" className={FIELD_LABEL}>{t('settingsUi.users.email')}</label>
            <input
              id="invite-email"
              type="email"
              required
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              autoComplete="off"
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="invite-role" className={FIELD_LABEL}>{t('settingsUi.team.col.role')}</label>
            <select
              id="invite-role"
              value={invite.roleKey}
              onChange={(e) => setInvite({ ...invite, roleKey: e.target.value })}
              className={FIELD}
            >
              {['manager', 'field_staff', 'viewer', 'admin'].map((r) => (
                <option key={r} value={r}>{t(`settingsUi.team.role.${r}`)}</option>
              ))}
            </select>
          </div>
          <GradientButton type="submit" variant="solid" disabled={inviting}>
            {inviting ? t('settingsUi.users.sending') : t('settingsUi.users.sendInvite')}
          </GradientButton>
        </form>
        {inviteLink && (
          <div className="flex flex-col gap-1.5 pt-4">
            <p className="text-[12px] leading-4 text-muted">{t('settingsUi.users.inviteLinkHelp')}</p>
            <div className="flex gap-2">
              <input readOnly value={inviteLink} className={`${FIELD} font-data text-[13px]`} aria-label={t('settingsUi.users.inviteLink')} />
              <GhostButton onClick={() => navigator.clipboard?.writeText(inviteLink)}>
                {t('settingsUi.users.copy')}
              </GhostButton>
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title={t('settingsUi.users.joinTitle')}
        meta={joinRequests?.length ? t('settingsUi.users.pendingCount', { count: joinRequests.length }) : undefined}
      >
        {joinRequests === undefined ? (
          <CardNote>{t('common.loading')}</CardNote>
        ) : joinRequests.length === 0 ? (
          <CardNote>{t('settingsUi.users.noJoin')}</CardNote>
        ) : (
          joinRequests.map((request) => (
            <SettingsRow
              key={request.id}
              label={request.name || request.email}
              helper={t('settingsUi.users.joinAs', {
                email: request.email,
                role: roleLabel(request.role === 'admin' ? 'admin' : 'user'),
              })}
            >
              <GradientButton size="sm" variant="solid" disabled={decidingId === request.id} onClick={() => decideJoin(request, true)}>
                {t('settingsUi.users.approve')}
              </GradientButton>
              <GhostButton disabled={decidingId === request.id} onClick={() => decideJoin(request, false)}>
                {t('settingsUi.users.decline')}
              </GhostButton>
            </SettingsRow>
          ))
        )}
        <p className="pt-2 text-[12px] leading-4 text-muted">{t('settingsUi.users.joinHelp')}</p>
      </SettingsCard>

      <SettingsCard title={t('settingsUi.users.createTitle')} meta={t('settingsUi.users.createMeta')}>
        <form onSubmit={handleCreate} className="grid grid-cols-1 items-end gap-3 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <div>
            <label htmlFor="create-email" className={FIELD_LABEL}>{t('settingsUi.users.email')}</label>
            <input id="create-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" className={FIELD} />
          </div>
          <div>
            <label htmlFor="create-name" className={FIELD_LABEL}>{t('settingsUi.users.name')}</label>
            <input id="create-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" className={FIELD} />
          </div>
          <div>
            <label htmlFor="create-role" className={FIELD_LABEL}>{t('settingsUi.users.accessLevel')}</label>
            <select id="create-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={FIELD}>
              <option value="user">{roleLabel('user')}</option>
              <option value="admin">{roleLabel('admin')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="create-password" className={FIELD_LABEL}>{t('settingsUi.users.tempPassword')}</label>
            <input
              id="create-password"
              type="text"
              required
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
              aria-describedby="create-password-hint"
              className={`${FIELD} font-data tabular-nums`}
            />
          </div>
          <GradientButton type="submit" disabled={creating}>
            {creating ? t('settingsUi.users.creating') : t('settingsUi.users.create')}
          </GradientButton>
        </form>
        <p id="create-password-hint" className="pt-2 text-[12px] leading-4 text-muted">{t('settingsUi.users.passwordHint')}</p>
      </SettingsCard>

      <InlineSuccess>{success}</InlineSuccess>
      <InlineError>{error}</InlineError>

      <Table
        title={t('settingsUi.users.accountsTitle')}
        columns={columns}
        rows={loading ? [] : users}
        empty={loading ? t('common.loading') : t('settingsUi.users.noUsers')}
      />
    </div>
  )
}

export default UserManagement
