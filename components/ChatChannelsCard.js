import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, FormActions, FormCard, Input, Skeleton } from './ui'

const PROVIDER_LABEL = { whatsapp: 'WhatsApp', telegram: 'Telegram' }

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Farm bot connections (BOT-001..004, doc 23): link this account to WhatsApp
 * (verified phone + one-time code) or Telegram (one-time deep link), set the
 * daily reminder, and disconnect.
 */
export default function ChatChannelsCard() {
  const data = useQuery(api.bot.bindings.myChannels)
  const createCode = useMutation(api.bot.bindings.createConnectCode)
  const { showToast } = useToast()
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!data) {
    return (
      <FormCard title="Connect WhatsApp / Telegram">
        <Skeleton className="h-32" />
      </FormCard>
    )
  }

  const start = async (provider) => {
    setBusy(true)
    try {
      const res = await createCode({ provider })
      setPending({ provider, ...res })
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const { whatsapp, telegram, bindings } = data
  const minutesLeft = pending ? Math.max(1, Math.round((pending.expiresAt - Date.now()) / 60000)) : 0

  return (
    <FormCard
      title="Connect WhatsApp / Telegram"
      subtitle="Record feeding and mortality, check units and get daily reminders from a chat. Every entry is shown to you to Save or Cancel first."
    >
      <div className="space-y-6">
        <div className="space-y-2 text-sm text-chart-ink">
          <p className="font-semibold">WhatsApp</p>
          {!whatsapp.configured ? (
            <p className="text-muted">Not available on this deployment yet.</p>
          ) : !whatsapp.phoneVerified ? (
            <p className="text-muted">
              WhatsApp connects only from your verified phone number. Add and confirm your phone first.
            </p>
          ) : (
            <>
              <p className="text-muted">
                From {whatsapp.phone}, send the code to {whatsapp.botNumber || 'the PBA Farm WhatsApp number'}.
              </p>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => start('whatsapp')}>
                Get a WhatsApp code
              </Button>
            </>
          )}
        </div>

        <div className="space-y-2 text-sm text-chart-ink">
          <p className="font-semibold">Telegram</p>
          {!telegram.configured ? (
            <p className="text-muted">Not available on this deployment yet.</p>
          ) : (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => start('telegram')}>
              Connect Telegram
            </Button>
          )}
        </div>

        {pending && (
          <div className="rounded-xl bg-foam px-4 py-3 text-sm text-chart-ink space-y-2" role="status">
            {pending.provider === 'whatsapp' ? (
              <>
                <p>
                  Send this message on WhatsApp: <strong className="font-mono">LINK {pending.code}</strong>
                </p>
                {pending.link && (
                  <a className="underline" href={pending.link} target="_blank" rel="noopener noreferrer">
                    Open WhatsApp
                  </a>
                )}
              </>
            ) : pending.link ? (
              <p>
                <a className="underline" href={pending.link} target="_blank" rel="noopener noreferrer">
                  Open Telegram
                </a>{' '}
                and tap Start.
              </p>
            ) : (
              <p>The Telegram bot name is not configured.</p>
            )}
            <p className="text-muted">Works once, for about {minutesLeft} minutes. Do not share it.</p>
          </div>
        )}

        {bindings.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-chart-ink">Connected chats</p>
            {bindings.map((b) => (
              <BindingRow key={b.id} binding={b} />
            ))}
          </div>
        )}
      </div>
    </FormCard>
  )
}

function BindingRow({ binding }) {
  const revoke = useMutation(api.bot.bindings.revokeChannel)
  const setReminder = useMutation(api.bot.bindings.setReminder)
  const { showToast } = useToast()
  const [enabled, setEnabled] = useState(binding.reminderEnabled)
  const [time, setTime] = useState(binding.reminderTime)
  const [busy, setBusy] = useState(false)
  const id = `reminder-${binding.id}`

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await setReminder({
        bindingId: binding.id,
        enabled,
        time,
        timezone: binding.reminderTimezone || browserTimezone(),
      })
      showToast('success', 'Reminder saved')
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await revoke({ bindingId: binding.id })
      showToast('success', `${PROVIDER_LABEL[binding.provider]} disconnected`)
    } catch (err) {
      showToast('error', errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="rounded-xl border border-foam-deep px-4 py-3 space-y-3 text-sm text-chart-ink">
      <div>
        <span className="font-semibold">{PROVIDER_LABEL[binding.provider]}</span>{' '}
        {binding.displayName || (binding.provider === 'whatsapp' ? binding.address : '')}
        <span className="block text-muted">
          {binding.companyName}
          {binding.siteName ? ` · ${binding.siteName}` : ''} · connected{' '}
          {new Date(binding.verifiedAt).toLocaleDateString()}
        </span>
      </div>
      <label className="flex items-start gap-3 min-h-11">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          Daily reminder for units with no entry
          <span className="block text-muted">Sent only when something is missing.</span>
        </span>
      </label>
      {enabled && (
        <Field label="Reminder time" htmlFor={id} hint={binding.reminderTimezone || browserTimezone()}>
          <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="max-w-[10rem]" />
        </Field>
      )}
      <FormActions>
        <Button type="submit" variant="secondary" disabled={busy}>
          Save reminder
        </Button>
        <Button type="button" variant="danger" disabled={busy} onClick={disconnect}>
          Disconnect
        </Button>
      </FormActions>
    </form>
  )
}
