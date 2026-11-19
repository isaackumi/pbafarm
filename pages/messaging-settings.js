import { useEffect, useMemo, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GhostButton, GradientButton, Pill, Skeleton, Toggle } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import Link from 'next/link'
import { CloudOff, Send } from 'lucide-react'
import { CardNote, FIELD, Notice, RouteGate, SettingsCard, SettingsField, SettingsFrame, SettingsRow, useSettingsEyebrow } from '../components/settings'
import { useT } from '../lib/i18n/context'
import { useOutbox } from '../hooks/useOutbox'

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
        <GradientButton onClick={onSave} disabled={!provider || busy !== null}>
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
            <GradientButton onClick={onTest} disabled={!testTo.trim() || busy !== null}>
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
        <Toggle
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
        <Toggle
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
        <Toggle
          checked={policy.phoneLoginSatisfies2fa}
          disabled={saving}
          label={t('settingsUi.msg.sec.phoneCounts')}
          onChange={(v) => save({ phoneLoginSatisfies2fa: v }, t('settingsUi.msg.saved'))}
        />
      </SettingsRow>
    </SettingsCard>
  )
}

function PreferencesCard({ data }) {
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
      {toggles.map(([channel, key]) => {
        const p = data.platform[channel]
        const label = t(`settingsUi.msg.def.usePlatform.${channel}`)
        return (
          <SettingsRow
            key={channel}
            label={label}
            helper={p.available ? t('settingsUi.msg.def.available') : t('settingsUi.msg.def.unavailable')}
          >
            <Toggle checked={p.enabled} disabled={saving || !p.available} label={label} onChange={(v) => save({ [key]: v })} />
          </SettingsRow>
        )
      })}
    </SettingsCard>
  )
}

/** Summary tile per channel (Paper 57): provider · sender and status. */
function ChannelSummary({ spec, row, providers, platform }) {
  const t = useT()
  const name = spec.id === 'email' ? t('settingsUi.msg.channelName.email') : spec.title
  const provider = providers.find((p) => p.id === row?.provider)
  const platformOn = !row && platform?.[spec.id]?.available && platform[spec.id].enabled
  return (
    <a
      href={`#${spec.id}`}
      className="flex min-w-0 flex-col gap-[14px] rounded-card border border-line bg-surface px-6 py-[22px] shadow-[var(--shadow-card)] hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold leading-[18px] text-text">{name}</span>
        {row ? (
          <StatusPill status={row.status} />
        ) : (
          <Pill tone={platformOn ? 'cyan' : 'neutral'} size="sm">
            {platformOn ? t('settingsUi.msg.platformChannel') : t('settingsUi.msg.notConfigured')}
          </Pill>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-[2px]">
        <span className="text-[13px] leading-4 text-muted">
          {provider ? `${provider.label} · ${provider.senderLabel || ''}`.replace(/ · $/, '') : t(`settingsUi.msg.channel.${spec.id}`)}
        </span>
        {row?.senderId && <span className="truncate font-data text-[14px] leading-[18px] text-text">{row.senderId}</span>}
      </div>
    </a>
  )
}

/** Banner for entries saved on this phone and waiting to send (MOBILE-002). */
function PhoneOutboxBanner() {
  const t = useT()
  const { items, sending, send } = useOutbox()
  if (!items.length) return null
  return (
    <Notice
      tone="warn"
      role="status"
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
      <span className="text-text">{t('settingsUi.msg.outbox.waiting', { count: items.length })}</span>
      {' · '}
      <Link href="/outbox" className="text-muted underline-offset-2 hover:underline">
        {t('settingsUi.msg.outbox.open')}
      </Link>
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
          <GradientButton icon={Send} href={`#${testable.id}-test`}>
            {t('settingsUi.msg.sendTestAction')}
          </GradientButton>
        ) : null
      }
    >
      <SettingsFrame active="messaging">
        <div className="flex flex-col gap-5">
          <p className="text-[14px] leading-[18px] text-muted">
            {t('settingsUi.msg.description')}{' '}
            <RouteGate href="/users">
              <Link href="/users" className="text-pearl-cyan underline-offset-2 hover:underline">
                {t('settingsUi.nav.members')}
              </Link>
            </RouteGate>
          </p>
          {!data ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-48" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                {CHANNELS.map((spec) => (
                  <ChannelSummary
                    key={spec.id}
                    spec={spec}
                    row={byChannel[spec.id]}
                    providers={data.providers}
                    platform={data.platform}
                  />
                ))}
              </div>
              <PhoneOutboxBanner />
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
              <PreferencesCard data={data} />
            </>
          )}
        </div>
      </SettingsFrame>
    </Layout>
  )
}
