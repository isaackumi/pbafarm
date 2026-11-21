import { useEffect, useMemo, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GhostButton, GradientButton, Pill, Skeleton } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import Link from 'next/link'
import { CloudOff, Send } from 'lucide-react'
import { CardNote, FIELD, Notice, RouteGate, SettingsCard, SettingsField, SettingsFrame, SettingsRow, useSettingsEyebrow } from '../components/settings'
import { LIME_BUTTON, SKY_TEXT, SkyToggle } from '../components/paperTones'
import { useLocale, useT } from '../lib/i18n/context'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useOutbox } from '../hooks/useOutbox'
import ChannelTiles from '../components/messaging/ChannelTiles'
import OutboxTable from '../components/messaging/OutboxTable'

const CHANNELS = [
  { id: 'sms', title: 'SMS', testPlaceholder: '024 412 3456' },
  { id: 'whatsapp', title: 'WhatsApp', testPlaceholder: '024 412 3456' },
  { id: 'email', title: 'Email', testPlaceholder: 'you@yourfarm.com' },
]

const STATUS_TONE = { draft: 'amber', verified: 'green', disabled: 'red' }

function StatusPill({ status }) {
  const t = useT()
  const key = STATUS_TONE[status] ? status : 'draft'
  return (
    <Pill tone={STATUS_TONE[key]} size="sm">
      {t(`settingsUi.msg.status.${key}`)}
    </Pill>
  )
}

function formatTime(ms) {
  if (!ms) return null
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return null
  }
}

function ChannelCard({ spec, row, providers, platform, encryptionReady }) {
  const t = useT()
  const name = spec.id === 'email' ? t('settingsUi.msg.channelName.email') : spec.title
  const { showToast } = useToast()
  const toast = {
    success: (m) => showToast('success', m),
    error: (m) => showToast('error', m),
  }
  const saveChannel = useMutation(api.messaging.channels.saveChannel)
  const disableChannel = useMutation(api.messaging.channels.disableChannel)
  const removeChannel = useMutation(api.messaging.channels.removeChannel)
  const saveCredentials = useAction(api.messaging.channels.saveCredentials)
  const sendTest = useAction(api.messaging.channels.sendTest)

  const options = useMemo(
    () => providers.filter((p) => p.channels.includes(spec.id)),
    [providers, spec.id],
  )
  const [provider, setProvider] = useState(row?.provider || options[0]?.id || '')
  const [senderId, setSenderId] = useState(row?.senderId || '')
  const [settings, setSettings] = useState(row?.settings || {})
  const [creds, setCreds] = useState({})
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState(null)

  // Follow the server row when it changes (another admin, or after a save).
  useEffect(() => {
    setProvider(row?.provider || options[0]?.id || '')
    setSenderId(row?.senderId || '')
    setSettings(row?.settings || {})
  }, [row?.provider, row?.senderId, row?.settings, options])

  const adapter = options.find((p) => p.id === provider)
  const providerChanged = row && row.provider !== provider

  const run = async (name, fn, success) => {
    setBusy(name)
    try {
      const result = await fn()
      if (success) toast.success(typeof success === 'function' ? success(result) : success)
      return result
    } catch (err) {
      toast.error(errorMessage(err))
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const onSave = () =>
    run(
      'save',
      () =>
        saveChannel({
          channel: spec.id,
          provider,
          senderId,
          settings: Object.fromEntries(
            Object.entries(settings).filter(([k]) => adapter?.settingFields.some((f) => f.key === k)),
          ),
        }),
      providerChanged
        ? t('settingsUi.msg.toast.savedNewProvider')
        : t('settingsUi.msg.toast.saved'),
    )

  const onSaveCredentials = async () => {
    const result = await run(
      'creds',
      () => saveCredentials({ channelId: row.id, credentials: creds }),
      t('settingsUi.msg.toast.credsSaved'),
    )
    if (result) setCreds({})
  }

  const onTest = () =>
    run(
      'test',
      () => sendTest({ channelId: row.id, to: testTo }),
      null,
    ).then((result) => {
      if (!result) return
      if (result.ok) toast.success(t('settingsUi.msg.toast.testOk'))
      else toast.error(t('settingsUi.msg.toast.testRefused', { error: result.error }))
    })

  const platformInfo = platform?.[spec.id]

  return (
    <SettingsCard id={spec.id} title={name} action={row ? <StatusPill status={row.status} /> : null}>
      <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t(`settingsUi.msg.channel.${spec.id}`)}</p>

      {!row && platformInfo?.available && platformInfo.enabled && (
        <CardNote>{t('settingsUi.msg.usingPlatform', { channel: name })}</CardNote>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsField label={t('settingsUi.msg.provider')} htmlFor={`${spec.id}-provider`}>
          <select
            className={FIELD}
            id={`${spec.id}-provider`}
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value)
              setSettings({})
            }}
          >
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </SettingsField>
        {adapter && (
          <SettingsField
            label={adapter.senderLabel}
            htmlFor={`${spec.id}-sender`}
            required={adapter.senderRequired}
          >
            <input
              className={FIELD}
              id={`${spec.id}-sender`}
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              autoComplete="off"
            />
          </SettingsField>
        )}
        {adapter?.settingFields.map((f) => (
          <SettingsField
            key={f.key}
            label={f.label}
            htmlFor={`${spec.id}-${f.key}`}
            hint={f.help || undefined}
            required={f.required}
          >
            <input
              className={FIELD}
              id={`${spec.id}-${f.key}`}
              value={settings[f.key] || ''}
              onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))}
              autoComplete="off"
            />
          </SettingsField>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <GradientButton ring="sky" onClick={onSave} disabled={!provider || busy !== null}>
          {busy === 'save' ? t('settingsUi.saving') : row ? t('settingsUi.msg.saveChanges') : t('settingsUi.msg.addChannel', { channel: name })}
        </GradientButton>
        {row && row.status !== 'disabled' && (
          <GhostButton
            size="lg"
            disabled={busy !== null}
            onClick={() =>
              run('disable', () => disableChannel({ channelId: row.id }), t('settingsUi.msg.toast.disabled'))
            }
          >
            {t('settingsUi.msg.disable')}
          </GhostButton>
        )}
        {row && (
          <GhostButton
            disabled={busy !== null}
            onClick={() => {
              if (typeof window !== 'undefined' && !window.confirm(t('settingsUi.msg.confirmRemove'))) return
              run('remove', () => removeChannel({ channelId: row.id }), t('settingsUi.msg.toast.removed'))
            }}
          >
            {t('settingsUi.msg.remove')}
          </GhostButton>
        )}
      </div>

      {row && !providerChanged && adapter && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-[14px] font-medium leading-[18px] text-text">{t('settingsUi.msg.credentials')}</h3>
          <p className="mt-1 text-[12px] leading-4 text-muted">
            {row.credentialsConfigured
              ? row.credentialHint
                ? t('settingsUi.msg.credsHint', { hint: row.credentialHint.replace('…', '') })
                : t('settingsUi.msg.credsSet')
              : t('settingsUi.msg.credsUnset')}
          </p>
          {!encryptionReady && (
            <p className="mt-2 text-[12px] leading-4 text-alert">
              {t('settingsUi.msg.noKeyShort')}
            </p>
          )}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {adapter.credentialFields.map((f) => (
              <SettingsField key={f.key} label={f.label} htmlFor={`${spec.id}-cred-${f.key}`} required={f.required}>
                <input
                  className={FIELD}
                  id={`${spec.id}-cred-${f.key}`}
                  type="password"
                  autoComplete="new-password"
                  value={creds[f.key] || ''}
                  placeholder={row.credentialsConfigured ? '••••••••' : ''}
                  onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                />
              </SettingsField>
            ))}
          </div>
          <GhostButton
            size="lg"
            className="mt-3"
            onClick={onSaveCredentials}
            disabled={!encryptionReady || busy !== null || Object.values(creds).every((x) => !x)}
          >
            {busy === 'creds' ? t('settingsUi.saving') : t('settingsUi.msg.saveCreds')}
          </GhostButton>
        </div>
      )}

      {row && row.credentialsConfigured && row.status !== 'disabled' && !providerChanged && (
        <div id={`${spec.id}-test`} className="mt-4 border-t border-line pt-4">
          <h3 id={`${spec.id}-test-title`} className="text-[14px] font-medium leading-[18px] text-text">{t('settingsUi.msg.sendTestTitle')}</h3>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <SettingsField label={t('settingsUi.msg.sendTo')} htmlFor={`${spec.id}-test`} className="flex-1">
              <input
                className={FIELD}
                id={`${spec.id}-test`}
                value={testTo}
                inputMode={spec.id === 'email' ? 'email' : 'tel'}
                placeholder={spec.testPlaceholder}
                onChange={(e) => setTestTo(e.target.value)}
              />
            </SettingsField>
            <GradientButton ring="sky" onClick={onTest} disabled={!testTo.trim() || busy !== null}>
              {busy === 'test' ? t('settingsUi.msg.sending') : t('settingsUi.msg.sendTest')}
            </GradientButton>
          </div>
          {row.lastTestAt && (
            <p className="mt-2 text-[12px] leading-4 text-muted">
              {t('settingsUi.msg.lastTest', {
                when: formatTime(row.lastTestAt),
                result: row.lastTestResult === 'ok' ? t('settingsUi.msg.deliveredToProvider') : row.lastTestResult,
              })}
            </p>
          )}
        </div>
      )}
    </SettingsCard>
  )
}

/** Sign-in security: phone sign-in and two-step verification (SEC-006, SEC-007). */
function SecurityCard() {
  const t = useT()
  const { showToast } = useToast()
  const policy = useQuery(api.security.getPolicy)
  const updatePolicy = useMutation(api.security.updatePolicy)
  const [saving, setSaving] = useState(false)

  if (!policy) return <Skeleton className="h-48" />

  const save = async (patch, message) => {
    setSaving(true)
    try {
      await updatePolicy(patch)
      showToast('success', message)
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const channelOptions = (
    <>
      <option value="sms">{policy.channelAvailable.sms ? 'SMS' : t('settingsUi.msg.notSetUp', { channel: 'SMS' })}</option>
      <option value="whatsapp">
        {policy.channelAvailable.whatsapp ? 'WhatsApp' : t('settingsUi.msg.notSetUp', { channel: 'WhatsApp' })}
      </option>
    </>
  )

  return (
    <SettingsCard title={t('settingsUi.msg.sec.title')}>
      <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t('settingsUi.msg.sec.sub')}</p>
      <SettingsRow label={t('settingsUi.msg.sec.phone')} helper={t('settingsUi.msg.sec.phoneHelp')}>
        <SkyToggle
          checked={policy.allowPhoneLogin}
          disabled={saving}
          label={t('settingsUi.msg.sec.phone')}
          onChange={(v) =>
            save({ allowPhoneLogin: v }, v ? t('settingsUi.msg.sec.phoneOn') : t('settingsUi.msg.sec.phoneOff'))
          }
        />
      </SettingsRow>
      <SettingsRow label={t('settingsUi.msg.sec.loginChannel')} htmlFor="login-channel">
        <select
          id="login-channel"
          className={`${FIELD} w-auto py-2`}
          value={policy.phoneLoginChannel}
          disabled={saving}
          onChange={(e) => save({ phoneLoginChannel: e.target.value }, t('settingsUi.msg.saved'))}
        >
          {channelOptions}
        </select>
      </SettingsRow>
      <SettingsRow
        label={t('settingsUi.msg.sec.mfa')}
        helper={policy.adminHasPhone ? t('settingsUi.msg.sec.mfaHelpHas') : t('settingsUi.msg.sec.mfaHelpNone')}
      >
        <SkyToggle
          checked={policy.require2fa}
          disabled={saving}
          label={t('settingsUi.msg.sec.mfa')}
          onChange={(v) =>
            save(
              { require2fa: v },
              v
                ? t('settingsUi.msg.sec.mfaOn')
                : t('settingsUi.msg.sec.mfaOff'),
            )
          }
        />
      </SettingsRow>
      <SettingsRow label={t('settingsUi.msg.sec.mfaChannel')} htmlFor="mfa-channel-policy">
        <select
          id="mfa-channel-policy"
          className={`${FIELD} w-auto py-2`}
          value={policy.twoFactorChannel}
          disabled={saving}
          onChange={(e) => save({ twoFactorChannel: e.target.value }, t('settingsUi.msg.saved'))}
        >
          {channelOptions}
        </select>
      </SettingsRow>
      <SettingsRow
        label={t('settingsUi.msg.sec.phoneCounts')}
        helper={t('settingsUi.msg.sec.phoneCountsHelp')}
      >
        <SkyToggle
          checked={policy.phoneLoginSatisfies2fa}
          disabled={saving}
          label={t('settingsUi.msg.sec.phoneCounts')}
          onChange={(v) => save({ phoneLoginSatisfies2fa: v }, t('settingsUi.msg.saved'))}
        />
      </SettingsRow>
    </SettingsCard>
  )
}

function PreferencesCard({ data, usage }) {
  const t = useT()
  const { showToast } = useToast()
  const toast = {
    success: (m) => showToast('success', m),
    error: (m) => showToast('error', m),
  }
  const updatePreferences = useMutation(api.messaging.channels.updatePreferences)
  const [saving, setSaving] = useState(false)

  const save = async (patch) => {
    setSaving(true)
    try {
      await updatePreferences(patch)
      toast.success(t('settingsUi.msg.saved'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const toggles = [
    ['sms', 'usePlatformDefaultSms'],
    ['whatsapp', 'usePlatformDefaultWhatsapp'],
    ['email', 'usePlatformDefaultEmail'],
  ]

  return (
    <SettingsCard title={t('settingsUi.msg.def.title')}>
      <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t('settingsUi.msg.def.sub')}</p>
      <SettingsField label={t('settingsUi.msg.def.country')} htmlFor="default-country" hint={t('settingsUi.msg.def.countryHint')} className="mb-2 sm:max-w-xs">
        <select
          className={FIELD}
          id="default-country"
          value={data.defaultCountryCode}
          disabled={saving}
          onChange={(e) => save({ defaultCountryCode: e.target.value })}
        >
          {data.countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} ({c.callingCode})
            </option>
          ))}
        </select>
      </SettingsField>
      {usage && <BudgetFields usage={usage} saving={saving} save={save} />}
      {toggles.map(([channel, key]) => {
        const p = data.platform[channel]
        const label = t(`settingsUi.msg.def.usePlatform.${channel}`)
        return (
          <SettingsRow
            key={channel}
            label={label}
            helper={p.available ? t('settingsUi.msg.def.available') : t('settingsUi.msg.def.unavailable')}
          >
            <SkyToggle checked={p.enabled} disabled={saving || !p.available} label={label} onChange={(v) => save({ [key]: v })} />
          </SettingsRow>
        )
      })}
    </SettingsCard>
  )
}

/** Monthly budgets behind the usage meters (Paper 57b); alert only, never enforced. */
function BudgetFields({ usage, saving, save }) {
  const t = useT()
  const [draft, setDraft] = useState({})
  const fields = [
    ['sms', 'SMS'],
    ['whatsapp', 'WhatsApp'],
    ['email', t('settingsUi.msg.channelName.email')],
  ]
  return (
    <fieldset className="mb-2">
      <legend className="text-[13px] font-medium leading-4 text-text">{t('settingsUi.msg.def.budget')}</legend>
      <p className="mt-1 text-[12px] leading-4 text-muted">{t('settingsUi.msg.def.budgetHint')}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {fields.map(([key, label]) => {
          const id = `budget-${key}`
          const current = usage[key].budget
          const value = draft[key] ?? String(current)
          return (
            <SettingsField key={key} label={label} htmlFor={id}>
              <input
                id={id}
                className={FIELD}
                inputMode="numeric"
                value={value}
                disabled={saving}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.replace(/[^0-9]/g, '') }))}
                onBlur={() => {
                  const n = Number(value)
                  setDraft((d) => ({ ...d, [key]: undefined }))
                  if (Number.isInteger(n) && n > 0 && n !== current) save({ monthlyBudget: { [key]: n } })
                }}
              />
            </SettingsField>
          )
        })}
      </div>
    </fieldset>
  )
}

/** "Android", "iPhone", ... for the banner's device line; null when unknown. */
function deviceKind() {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'Android'
  if (/iphone/i.test(ua)) return 'iPhone'
  if (/ipad/i.test(ua)) return 'iPad'
  if (/windows/i.test(ua)) return 'Windows'
  if (/mac os|macintosh/i.test(ua)) return 'Mac'
  if (/linux/i.test(ua)) return 'Linux'
  return null
}

function timeAgo(ms, locale, justNow) {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (minutes < 1) return justNow
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'short' })
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  if (minutes < 48 * 60) return rtf.format(-Math.round(minutes / 60), 'hour')
  return rtf.format(-Math.round(minutes / 1440), 'day')
}

/**
 * Banner for entries saved on this phone and waiting to send (MOBILE-002,
 * Paper 57b): count, last sync of this device, whose device and which site.
 */
function PhoneOutboxBanner() {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const { user } = useAuth()
  const { activeLocation } = useLocation()
  const { items, sending, send, lastSyncAt } = useOutbox()
  if (!items.length) return null
  const device = deviceKind()
  const owner = (user?.name || user?.full_name || '').trim().split(/\s+/)[0] || null
  const deviceLine = device
    ? owner
      ? t('settingsUi.msg.outbox.deviceOf', { name: owner, device })
      : device
    : t('settingsUi.msg.outbox.thisDevice')
  const detail = [
    lastSyncAt
      ? t('settingsUi.msg.outbox.lastSync', {
          ago: timeAgo(lastSyncAt, formatLocale || locale || 'en', t('settingsUi.msg.outbox.justNow')),
        })
      : t('settingsUi.msg.outbox.neverSynced'),
    activeLocation?.name ? `${deviceLine}, ${activeLocation.name}` : deviceLine,
  ].join(' · ')
  return (
    <Notice
      tone="warn"
      role="status"
      // Paper 57: #17140C on #5E4A1E; light #FFFBEB on #F3D9A4 (the Notice sets these inline).
      className="border-[#5E4A1E]! bg-[#17140C]! [html[data-theme=light]_&]:border-[#F3D9A4]! [html[data-theme=light]_&]:bg-[#FFFBEB]!"
      action={
        <button
          type="button"
          onClick={() => send()}
          disabled={sending}
          className="shrink-0 text-[13px] leading-4 text-warn underline-offset-2 hover:underline disabled:opacity-50"
        >
          {sending ? t('settingsUi.msg.outbox.syncing') : t('settingsUi.msg.outbox.sync')}
        </button>
      }
    >
      <Link href="/outbox" className="text-text underline-offset-2 hover:underline">
        {t('settingsUi.msg.outbox.waiting', { count: items.length })}
      </Link>
      <span className="text-muted [html[data-theme=light]_&]:text-text"> · {detail}</span>
    </Notice>
  )
}

export default function MessagingSettingsPage() {
  return (
    <ProtectedRoute permission="integrations.manage">
      <MessagingSettings />
    </ProtectedRoute>
  )
}

function MessagingSettings() {
  const t = useT()
  const eyebrow = useSettingsEyebrow(t('settingsUi.msg.crumb'))
  const data = useQuery(api.messaging.channels.overview)
  // Usage meters are for the current UTC month; the query never reads the clock.
  const [period] = useState(() => new Date().toISOString().slice(0, 7))
  const usage = useQuery(api.messaging.outbox.usage, { period })
  const byChannel = useMemo(() => {
    const map = {}
    for (const row of data?.channels || []) map[row.channel] = row
    return map
  }, [data])
  const testable = CHANNELS.find((c) => {
    const row = byChannel[c.id]
    return row && row.credentialsConfigured && row.status !== 'disabled'
  })

  return (
    <Layout
      title={t('settingsUi.msg.title')}
      eyebrow={eyebrow}
      actions={
        testable ? (
          <GradientButton variant="lime" className={LIME_BUTTON} icon={Send} href={`#${testable.id}-test`}>
            {t('settingsUi.msg.sendTestAction')}
          </GradientButton>
        ) : null
      }
    >
      <SettingsFrame active="messaging">
        <div className="flex flex-col gap-5">
          {!data ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-48" />
            </div>
          ) : (
            <>
              <ChannelTiles data={data} usage={usage} byChannel={byChannel} />
              <PhoneOutboxBanner />
              <OutboxTable />
              <p className="mt-3 text-[14px] leading-[18px] text-muted">
                {t('settingsUi.msg.description')}{' '}
                <RouteGate href="/users">
                  <Link href="/users" className={`${SKY_TEXT} underline-offset-2 hover:underline`}>
                    {t('settingsUi.nav.members')}
                  </Link>
                </RouteGate>
              </p>
              {!data.encryptionReady && (
                <Notice tone="alert" role="status">
                  {t('settingsUi.msg.noKey')}
                </Notice>
              )}
              {CHANNELS.map((spec) => (
                <ChannelCard
                  key={spec.id}
                  spec={spec}
                  row={byChannel[spec.id]}
                  providers={data.providers}
                  platform={data.platform}
                  encryptionReady={data.encryptionReady}
                />
              ))}
              <SecurityCard />
              <PreferencesCard data={data} usage={usage} />
            </>
          )}
        </div>
      </SettingsFrame>
    </Layout>
  )
}
