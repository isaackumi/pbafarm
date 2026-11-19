import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAction } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTheme } from '../contexts/ThemeContext'
import { effectiveHomeHeader } from '../convex/lib/userPreferences'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import AccountDeletionCard from '../components/AccountDeletionCard'
import ChatChannelsCard from '../components/ChatChannelsCard'
import { AuthenticatorRow } from '../components/AuthenticatorApp'
import { GhostButton, GradientButton, Pill } from '../components/ui'
import { initials } from '../components/ui/Avatar'
import {
  SettingsFrame,
  SettingsCard,
  SettingsRow,
  Notice,
  InlineError,
  FIELD,
  FIELD_LABEL,
  RouteGate,
} from '../components/settings'
import { usePermissions } from '../hooks/usePermission'
import { routePermission } from '../lib/routePermissions'
import { useLocale, useT } from '../lib/i18n/context'

/** Account & security (Paper 31, ACU-0). */
export default function AccountPage() {
  const router = useRouter()
  const t = useT()
  const { user } = useAuth()
  const { roleName } = usePermissions()
  const forced = router.query.force === '1' || user?.mustChangePassword
  const [done, setDone] = useState(false)

  // Wait until Convex clears mustChangePassword before leaving forced flow.
  useEffect(() => {
    if (!done || user?.mustChangePassword) return
    if (router.query.force === '1') {
      router.replace('/dashboard')
    }
  }, [done, user?.mustChangePassword, router])

  const locked = forced && !done
  const isPlatformAdmin = (user?.realRole ?? user?.role) === 'super_admin'
  const eyebrow = [t('settingsUi.account.title'), user?.name, roleName].filter(Boolean).join(' · ')

  return (
    <ProtectedRoute>
      <Layout title={t('settingsUi.account.title')} eyebrow={eyebrow}>
        <SettingsFrame active={null}>
          {locked && <Notice tone="warn">{t('settingsUi.account.forced')}</Notice>}
          {!locked && <ProfileCard user={user} />}
          <div className="flex w-full flex-col items-start gap-5 lg:flex-row">
            <SignInMethodsCard user={user} locked={locked} onPasswordChanged={() => setDone(true)} />
            {!locked && <PreferencesCard />}
          </div>
          {!locked && !user?.actingAs && !isPlatformAdmin && (
            <SettingsCard>
              <ChatChannelsCard />
            </SettingsCard>
          )}
          {!locked && <DataPrivacyCard showDelete={!isPlatformAdmin} />}
        </SettingsFrame>
      </Layout>
    </ProtectedRoute>
  )
}

function ProfileCard({ user }) {
  const t = useT()
  const { locale, supported } = useLocale()
  const language = supported.find((l) => l.code === locale)?.label
  const meta = [user?.email, user?.maskedPhone, language].filter(Boolean).join(' · ')
  return (
    <SettingsCard aria-label={t('settingsUi.account.profile')}>
      <div className="flex flex-wrap items-center gap-[18px]">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-pill border border-line-strong bg-surface-2 text-[22px] font-semibold leading-7 text-text"
        >
          {initials(user?.name || user?.email || '')}
        </span>
        <div className="flex min-w-0 grow basis-0 flex-col gap-1">
          <div className="text-[20px] font-semibold leading-6 text-text">{user?.name || user?.email}</div>
          {meta && <div className="truncate text-[13px] leading-4 text-muted">{meta}</div>}
        </div>
      </div>
    </SettingsCard>
  )
}

function SignInMethodsCard({ user, locked, onPasswordChanged }) {
  const t = useT()
  const [changing, setChanging] = useState(locked)
  return (
    <SettingsCard
      title={t('settingsUi.account.signIn')}
      meta={user?.mfaTotp ? t('settingsUi.account.strong') : t('settingsUi.account.basic')}
      className="w-full grow basis-0"
    >
      {!locked && <AuthenticatorRow />}
      {!locked && user?.hasPhone && !user?.actingAs && <PhoneRow user={user} />}
      <SettingsRow label={t('settingsUi.account.password')} helper={changing ? user?.email : t('settingsUi.account.passwordHelper')}>
        {!changing && (
          <GhostButton onClick={() => setChanging(true)}>{t('settingsUi.account.change')}</GhostButton>
        )}
      </SettingsRow>
      {changing && (
        <PasswordForm
          locked={locked}
          onCancel={() => setChanging(false)}
          onDone={() => {
            setChanging(false)
            onPasswordChanged()
          }}
        />
      )}
    </SettingsCard>
  )
}

function PasswordForm({ locked, onCancel, onDone }) {
  const t = useT()
  const { showToast } = useToast()
  const changePassword = useAction(api.userAccounts.changePassword)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 6) return setError(t('settingsUi.account.pwTooShort'))
    if (newPassword !== confirmPassword) return setError(t('settingsUi.account.pwMismatch'))
    setSaving(true)
    try {
      await changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showToast('success', t('settingsUi.account.pwUpdated'))
      onDone()
    } catch (err) {
      const message =
        err?.message?.includes('InvalidSecret') || err?.message?.includes('incorrect')
          ? t('settingsUi.account.pwWrong')
          : err.message || t('settingsUi.account.pwFailed')
      setError(message)
      showToast('error', message)
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    ['currentPassword', 'pwCurrent', currentPassword, setCurrentPassword, 'current-password'],
    ['newPassword', 'pwNew', newPassword, setNewPassword, 'new-password'],
    ['confirmPassword', 'pwConfirm', confirmPassword, setConfirmPassword, 'new-password'],
  ]
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pb-3">
      {fields.map(([id, key, value, set, auto]) => (
        <div key={id}>
          <label htmlFor={id} className={FIELD_LABEL}>
            {t(`settingsUi.account.${key}`)}
          </label>
          <input
            id={id}
            type="password"
            autoComplete={auto}
            required
            minLength={id === 'currentPassword' ? undefined : 6}
            aria-describedby={id === 'newPassword' ? 'newPassword-hint' : undefined}
            value={value}
            onChange={(e) => set(e.target.value)}
            className={FIELD}
          />
          {id === 'newPassword' && (
            <p id="newPassword-hint" className="mt-1.5 text-[12px] leading-4 text-muted">
              {t('settingsUi.account.pwHint')}
            </p>
          )}
        </div>
      ))}
      <InlineError>{error}</InlineError>
      <div className="flex flex-wrap justify-end gap-3">
        {!locked && (
          <GhostButton onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </GhostButton>
        )}
        <GradientButton type="submit" size="sm" variant="solid" disabled={saving}>
          {saving ? t('settingsUi.saving') : t('settingsUi.account.pwSubmit')}
        </GradientButton>
      </div>
    </form>
  )
}

/**
 * A number an admin entered is not used for phone sign-in until its owner
 * confirms it with a code (ORG-002).
 */
function PhoneRow({ user }) {
  const t = useT()
  const { showToast } = useToast()
  const start = useAction(api.mfa.startPhoneConfirmation)
  const confirm = useAction(api.mfa.confirmPhone)
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirmed = Boolean(user.phoneVerificationTime)

  const send = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await start({ channel: 'sms' })
      if (res.ok) setSentTo(res.sentTo)
      else setError(res.error || t('settingsUi.account.codeSendFailed'))
    } catch (err) {
      setError(err?.data?.message || err?.message || t('settingsUi.account.codeSendFailed'))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await confirm({ code })
      if (res.ok) showToast('success', t('settingsUi.account.phoneConfirmed'))
      else setError(res.error || t('settingsUi.account.codeWrong'))
    } catch (err) {
      setError(err?.data?.message || err?.message || t('settingsUi.account.phoneConfirmFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsRow
        label={t('settingsUi.account.phone')}
        helper={
          confirmed
            ? user.maskedPhone
            : t('settingsUi.account.phoneUnconfirmed', { phone: user.maskedPhone || '' })
        }
      >
        {confirmed ? (
          <Pill tone="green">{t('settingsUi.account.confirmed')}</Pill>
        ) : (
          <GhostButton onClick={send} disabled={busy}>
            {sentTo ? t('settingsUi.account.sendAgain') : t('settingsUi.account.sendCode')}
          </GhostButton>
        )}
      </SettingsRow>
      {!confirmed && (sentTo || error) && (
        <form onSubmit={submit} className="flex flex-col gap-3 pb-3">
          {sentTo && (
            <div>
              <label htmlFor="phoneConfirmCode" className={FIELD_LABEL}>
                {t('settingsUi.account.codeSentTo', { to: sentTo })}
              </label>
              <div className="flex gap-3">
                <input
                  id="phoneConfirmCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={FIELD}
                />
                <GradientButton type="submit" size="sm" variant="solid" disabled={busy || !code.trim()}>
                  {t('settingsUi.account.confirm')}
                </GradientButton>
              </div>
            </div>
          )}
          <InlineError>{error}</InlineError>
        </form>
      )}
    </>
  )
}

/** Links to the per-user settings that live on their own pages. */
function PreferencesCard() {
  const t = useT()
  return (
    <SettingsCard title={t('settingsUi.account.preferences')} className="w-full grow basis-0">
      <SettingsRow label={t('settingsUi.account.notifications')} helper={t('settingsUi.account.notificationsHelper')}>
        <GhostButton href="/notifications">{t('settingsUi.account.manage')}</GhostButton>
      </SettingsRow>
      <HomeHeaderRow />
    </SettingsCard>
  )
}

/** Plain title or the "Sky & lake" panel on Home (Paper L · 01 Home — Sky & lake). Saves on click. */
function HomeHeaderRow() {
  const t = useT()
  const { showToast } = useToast()
  const { settings, updateDashboard } = useSettings()
  const { theme } = useTheme()
  const value = effectiveHomeHeader(settings.dashboard?.homeHeader, theme)
  const choose = async (next) => {
    if (next === value) return
    try {
      await updateDashboard({ homeHeader: next })
      showToast('success', t('settingsUi.account.homeHeaderSaved'))
    } catch (err) {
      showToast('error', err?.data?.message || t('settingsUi.account.homeHeaderFailed'))
    }
  }
  const options = [
    { value: 'plain', label: t('settingsUi.account.homeHeaderPlain') },
    { value: 'sky', label: t('settingsUi.account.homeHeaderSky') },
  ]
  return (
    <SettingsRow label={t('settingsUi.account.homeHeader')} helper={t('settingsUi.account.homeHeaderHelper')}>
      <div role="radiogroup" aria-label={t('settingsUi.account.homeHeader')} className="flex gap-2">
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(opt.value)}
              className={`flex flex-col items-center gap-[6px] rounded-input border p-[6px] pb-2 text-[12px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                active ? 'border-text bg-surface-2 text-text' : 'border-line text-muted hover:text-text'
              }`}
            >
              <HomeHeaderPreview kind={opt.value} />
              {opt.label}
            </button>
          )
        })}
      </div>
    </SettingsRow>
  )
}

/** Thumbnail of the Home header style: a greeting bar and two card tops. */
function HomeHeaderPreview({ kind }) {
  const sky = kind === 'sky'
  return (
    <span
      aria-hidden
      className={`relative block h-[46px] w-[76px] overflow-hidden rounded-[8px] border border-line bg-bg ${sky ? 'home-sky-thumb' : ''}`}
    >
      {sky && <span className="home-sky-thumb-panel absolute inset-x-[3px] top-[3px] h-[28px] rounded-[6px]" />}
      <span className={`absolute left-[8px] top-[9px] h-[4px] w-[30px] rounded-pill ${sky ? 'bg-white' : 'bg-muted'}`} />
      <span
        className={`absolute right-[8px] top-[8px] h-[6px] w-[14px] rounded-pill ${sky ? 'bg-[#D7F75B]' : 'bg-line-strong'}`}
      />
      <span className="absolute bottom-[3px] left-[6px] h-[18px] w-[36px] rounded-[4px] border border-line bg-surface" />
      <span className="absolute bottom-[3px] right-[6px] h-[18px] w-[24px] rounded-[4px] border border-line bg-surface" />
    </span>
  )
}

function DataPrivacyCard({ showDelete }) {
  const t = useT()
  const { can } = usePermissions()
  const canExport = can(routePermission('/export'))
  if (!canExport && !showDelete) return null
  return (
    <SettingsCard title={t('settingsUi.account.dataPrivacy')}>
      {canExport && (
        <RouteGate href="/export">
        <SettingsRow label={t('settingsUi.account.download')} helper={t('settingsUi.account.downloadHelper')}>
          <GradientButton href="/export" size="sm">
            {t('settingsUi.account.downloadAction')}
          </GradientButton>
        </SettingsRow>
        </RouteGate>
      )}
      {showDelete && <AccountDeletionCard />}
    </SettingsCard>
  )
}
