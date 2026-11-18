import { useEffect, useMemo, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, Field, FormPage, Input, PageHeader, Select, Skeleton } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'

const CHANNELS = [
  {
    id: 'sms',
    title: 'SMS',
    description: 'Text messages for sign-in codes and alerts.',
    testPlaceholder: '024 412 3456',
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp',
    description: 'Sign-in codes through an approved WhatsApp template.',
    testPlaceholder: '024 412 3456',
  },
  {
    id: 'email',
    title: 'Email',
    description: 'Email from your own sending domain.',
    testPlaceholder: 'you@yourfarm.com',
  },
]

const STATUS_TEXT = {
  draft: { label: 'Not verified', className: 'bg-foam text-chart-ink' },
  verified: { label: 'Verified', className: 'bg-kelp/15 text-kelp' },
  disabled: { label: 'Disabled', className: 'bg-signal/10 text-signal' },
}

function StatusPill({ status }) {
  const s = STATUS_TEXT[status] || STATUS_TEXT.draft
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
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
        ? 'Saved. Enter the credentials for the new provider, then send a test.'
        : 'Channel saved. Send a test to verify it.',
    )

  const onSaveCredentials = async () => {
    const result = await run(
      'creds',
      () => saveCredentials({ channelId: row.id, credentials: creds }),
      'Credentials saved. Send a test to verify the channel.',
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
      if (result.ok) toast.success('Test message sent. The channel is verified.')
      else toast.error(`The provider refused the message: ${result.error}`)
    })

  const platformInfo = platform?.[spec.id]

  return (
    <Card>
      <CardHeader
        title={spec.title}
        subtitle={spec.description}
        action={row ? <StatusPill status={row.status} /> : null}
      />

      {!row && platformInfo?.available && platformInfo.enabled && (
        <p className="mb-4 text-sm text-muted">
          Using the platform&apos;s {spec.title} channel until you add your own.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider" htmlFor={`${spec.id}-provider`}>
          <Select
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
          </Select>
        </Field>
        {adapter && (
          <Field
            label={adapter.senderLabel}
            htmlFor={`${spec.id}-sender`}
            required={adapter.senderRequired}
          >
            <Input
              id={`${spec.id}-sender`}
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              autoComplete="off"
            />
          </Field>
        )}
        {adapter?.settingFields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            htmlFor={`${spec.id}-${f.key}`}
            hint={f.help || undefined}
            required={f.required}
          >
            <Input
              id={`${spec.id}-${f.key}`}
              value={settings[f.key] || ''}
              onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))}
              autoComplete="off"
            />
          </Field>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onSave} disabled={!provider || busy !== null}>
          {busy === 'save' ? 'Saving…' : row ? 'Save changes' : `Add ${spec.title} channel`}
        </Button>
        {row && row.status !== 'disabled' && (
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              run('disable', () => disableChannel({ channelId: row.id }), 'Channel disabled.')
            }
          >
            Disable
          </Button>
        )}
        {row && (
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              if (typeof window !== 'undefined' && !window.confirm('Remove this channel and its saved credentials?')) return
              run('remove', () => removeChannel({ channelId: row.id }), 'Channel removed.')
            }}
          >
            Remove
          </Button>
        )}
      </div>

      {row && !providerChanged && adapter && (
        <div className="mt-6 border-t border-foam-deep pt-5">
          <h3 className="text-sm font-medium text-chart-ink">Credentials</h3>
          <p className="mt-1 text-sm text-muted">
            {row.credentialsConfigured
              ? `Configured${row.credentialHint ? ` · ends in ${row.credentialHint.replace('…', '')}` : ''}. Enter new values only to replace them.`
              : 'Not set. They are encrypted and never shown again after saving.'}
          </p>
          {!encryptionReady && (
            <p className="mt-2 text-sm text-signal">
              Credentials cannot be saved until the platform encryption key is set on the server.
            </p>
          )}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {adapter.credentialFields.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`${spec.id}-cred-${f.key}`} required={f.required}>
                <Input
                  id={`${spec.id}-cred-${f.key}`}
                  type="password"
                  autoComplete="new-password"
                  value={creds[f.key] || ''}
                  placeholder={row.credentialsConfigured ? '••••••••' : ''}
                  onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={onSaveCredentials}
            disabled={!encryptionReady || busy !== null || Object.values(creds).every((x) => !x)}
          >
            {busy === 'creds' ? 'Saving…' : 'Save credentials'}
          </Button>
        </div>
      )}

      {row && row.credentialsConfigured && row.status !== 'disabled' && !providerChanged && (
        <div className="mt-6 border-t border-foam-deep pt-5">
          <h3 className="text-sm font-medium text-chart-ink">Send a test message</h3>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Send to" htmlFor={`${spec.id}-test`} className="flex-1">
              <Input
                id={`${spec.id}-test`}
                value={testTo}
                inputMode={spec.id === 'email' ? 'email' : 'tel'}
                placeholder={spec.testPlaceholder}
                onChange={(e) => setTestTo(e.target.value)}
              />
            </Field>
            <Button onClick={onTest} disabled={!testTo.trim() || busy !== null}>
              {busy === 'test' ? 'Sending…' : 'Send test'}
            </Button>
          </div>
          {row.lastTestAt && (
            <p className="mt-2 text-sm text-muted">
              Last test {formatTime(row.lastTestAt)}:{' '}
              {row.lastTestResult === 'ok' ? 'delivered to the provider' : row.lastTestResult}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

/** Sign-in security: phone sign-in and two-step verification (SEC-006, SEC-007). */
function SecurityCard() {
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
      <option value="sms">SMS{policy.channelAvailable.sms ? '' : ' (not set up)'}</option>
      <option value="whatsapp">WhatsApp{policy.channelAvailable.whatsapp ? '' : ' (not set up)'}</option>
    </>
  )

  return (
    <Card>
      <CardHeader
        title="Sign-in security"
        subtitle="Codes are sent through the channels above. Turn these on only after a test message arrives."
      />
      <div className="space-y-6">
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm text-chart-ink">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={policy.allowPhoneLogin}
              disabled={saving}
              onChange={(e) =>
                save(
                  { allowPhoneLogin: e.target.checked },
                  e.target.checked ? 'Staff can now sign in with a phone code.' : 'Phone sign-in turned off.',
                )
              }
            />
            <span>
              Let staff sign in with a code sent to their phone
              <span className="block text-muted">
                Only people whose mobile number you added on the Users page can use it.
              </span>
            </span>
          </label>
          <Field label="Send sign-in codes by" htmlFor="login-channel" className="sm:max-w-xs">
            <Select
              id="login-channel"
              value={policy.phoneLoginChannel}
              disabled={saving}
              onChange={(e) => save({ phoneLoginChannel: e.target.value }, 'Saved.')}
            >
              {channelOptions}
            </Select>
          </Field>
        </div>

        <div className="space-y-3 border-t border-foam-deep pt-5">
          <label className="flex items-start gap-3 text-sm text-chart-ink">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={policy.require2fa}
              disabled={saving}
              onChange={(e) =>
                save(
                  { require2fa: e.target.checked },
                  e.target.checked
                    ? 'Two-step verification is on. Everyone enters a code at their next sign-in.'
                    : 'Two-step verification turned off.',
                )
              }
            />
            <span>
              Require a code at every new sign-in (two-step verification)
              <span className="block text-muted">
                {policy.adminHasPhone
                  ? 'Staff without a mobile number add one the first time.'
                  : 'Add your own mobile number on the Users page first.'}
              </span>
            </span>
          </label>
          <Field label="Send verification codes by" htmlFor="mfa-channel-policy" className="sm:max-w-xs">
            <Select
              id="mfa-channel-policy"
              value={policy.twoFactorChannel}
              disabled={saving}
              onChange={(e) => save({ twoFactorChannel: e.target.value }, 'Saved.')}
            >
              {channelOptions}
            </Select>
          </Field>
          <label className="flex items-start gap-3 text-sm text-chart-ink">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={policy.phoneLoginSatisfies2fa}
              disabled={saving}
              onChange={(e) => save({ phoneLoginSatisfies2fa: e.target.checked }, 'Saved.')}
            />
            <span>
              A phone sign-in code also counts as the second step
              <span className="block text-muted">
                When off and two-step verification is on, phone sign-in is not offered.
              </span>
            </span>
          </label>
        </div>
      </div>
    </Card>
  )
}

function PreferencesCard({ data }) {
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
      toast.success('Saved.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const toggles = [
    ['sms', 'usePlatformDefaultSms', 'SMS'],
    ['whatsapp', 'usePlatformDefaultWhatsapp', 'WhatsApp'],
    ['email', 'usePlatformDefaultEmail', 'email'],
  ]

  return (
    <Card>
      <CardHeader
        title="Defaults"
        subtitle="How phone numbers are read, and whether to fall back to the platform's channels."
      />
      <Field label="Country for local numbers" htmlFor="default-country" hint="0244 123 456 is read as a number in this country.">
        <Select
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
        </Select>
      </Field>
      <div className="mt-4 space-y-3">
        {toggles.map(([channel, key, label]) => {
          const p = data.platform[channel]
          return (
            <label key={channel} className="flex items-start gap-3 text-sm text-chart-ink">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={p.enabled}
                disabled={saving || !p.available}
                onChange={(e) => save({ [key]: e.target.checked })}
              />
              <span>
                Use the platform {label} channel when we have none of our own
                <span className="block text-muted">
                  {p.available ? 'Available on this platform.' : 'Not offered on this platform.'}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </Card>
  )
}

export default function MessagingSettingsPage() {
  const data = useQuery(api.messaging.channels.overview)
  const byChannel = useMemo(() => {
    const map = {}
    for (const row of data?.channels || []) map[row.channel] = row
    return map
  }, [data])

  return (
    <ProtectedRoute requiredRole="admin">
      <Layout title="Messaging">
        <FormPage width="lg">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Company settings', href: '/company-settings' },
              { label: 'Messaging' },
            ]}
            description="Choose the SMS, WhatsApp and email providers your company sends with. A channel is used for sign-in codes only after a successful test message."
            related={[
              { label: 'Company settings', href: '/company-settings' },
              { label: 'Users', href: '/users' },
            ]}
          />
          {!data ? (
            <div className="space-y-4">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : (
            <div className="space-y-6">
              {!data.encryptionReady && (
                <Card>
                  <p className="text-sm text-chart-ink">
                    Provider credentials cannot be saved yet: the platform encryption key is not set on the server. You can still set up channels; ask the platform operator to set the key.
                  </p>
                </Card>
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
            </div>
          )}
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
