import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { useLocale, useT } from '../lib/i18n/context'
import { Field, GradientButton, Input, Skeleton } from './ui'

const PROVIDERS = {
  // Third-party brand colours for the provider marks (not theme tokens).
  whatsapp: { name: 'WhatsApp', mark: 'W', color: 'bg-[#00A884]' },
  telegram: { name: 'Telegram', mark: 'T', color: 'bg-[#229ED9]' },
}

const OUTLINE =
  'rounded-pill border border-line-strong px-[14px] py-2 text-[13px] leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50 disabled:cursor-not-allowed'
const DANGER_TEXT =
  'rounded-pill px-[14px] py-2 text-[13px] leading-4 text-alert hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50 disabled:cursor-not-allowed'

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Farm bot connections (BOT-001..004, doc 23; Paper 43): link this account
 * to WhatsApp (verified phone + one-time code) or Telegram (one-time deep
 * link), set the daily reminder, and disconnect.
 */
export default function ChatChannelsCard() {
  const t = useT()
  const data = useQuery(api.bot.bindings.myChannels)
  const createCode = useMutation(api.bot.bindings.createConnectCode)
  const { showToast } = useToast()
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)

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

  return (
    <section aria-labelledby="chat-channels-title" className="flex flex-col gap-4">
      <div>
        <h2 id="chat-channels-title" className="text-[17px] font-semibold leading-[22px] text-text">
          {t('chatChannels.title')}
        </h2>
        <p className="mt-1 text-sm leading-[19px] text-muted">{t('chatChannels.subtitle')}</p>
      </div>
      {!data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {['whatsapp', 'telegram'].map((p) => (
            <ProviderCard
              key={p}
              provider={p}
              config={data[p]}
              bindings={data.bindings.filter((b) => b.provider === p)}
              pending={pending?.provider === p ? pending : null}
              busy={busy}
              onStart={() => start(p)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ProviderCard({ provider, config, bindings, pending, busy, onStart }) {
  const t = useT()
  const meta = PROVIDERS[provider]
  const connected = bindings.length > 0
  const minutesLeft = pending ? Math.max(1, Math.round((pending.expiresAt - Date.now()) / 60000)) : 0
  const canConnect = config.configured && (provider !== 'whatsapp' || config.phoneVerified)
  const status = connected
    ? t('chatChannels.connected', {
        address: bindings[0].displayName || (provider === 'whatsapp' ? bindings[0].address : '') || meta.name,
      })
    : !config.configured
      ? t('chatChannels.unavailable')
      : t('chatChannels.notConnected')

  return (
    <div className="flex flex-col gap-[14px] rounded-[12px] border border-line bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${meta.color}`} aria-hidden>
          <span className="text-[15px] font-bold leading-[18px] text-white">{meta.mark}</span>
        </div>
        <div className="flex flex-col gap-[2px]">
          <h3 className="text-[15px] font-semibold leading-[18px] text-text">{meta.name}</h3>
          <p className={`text-xs leading-4 ${connected ? 'text-good' : 'text-muted'}`}>{status}</p>
        </div>
      </div>
      <p className="text-sm leading-[19px] text-muted">
        {provider === 'whatsapp'
          ? !config.configured
            ? t('chatChannels.whatsappUnavailable')
            : !config.phoneVerified
              ? t('chatChannels.whatsappVerifyPhone')
              : t('chatChannels.whatsappHow', { phone: config.phone, bot: config.botNumber || t('chatChannels.whatsappBotFallback') })
          : config.configured
            ? t('chatChannels.telegramHow')
            : t('chatChannels.telegramUnavailable')}
      </p>

      {bindings.map((b) => (
        <BindingRow key={b.id} binding={b} />
      ))}

      {pending ? (
        <div role="status" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-[8px] border border-dashed border-line-strong px-4 py-[14px]">
            <span className="font-mono text-[24px] font-bold leading-[30px] tracking-[0.2em] text-pearl-cyan">
              {provider === 'whatsapp' ? `LINK ${pending.code}` : pending.code}
            </span>
            <span className="text-xs leading-4 text-muted">{t('chatChannels.minutesLeft', { count: minutesLeft })}</span>
          </div>
          <p className="text-xs leading-4 text-faint">
            {provider === 'whatsapp' ? t('chatChannels.sendCode') : pending.link ? t('chatChannels.tapStart') : t('chatChannels.telegramNoBot')}{' '}
            {t('chatChannels.doNotShare')}
          </p>
        </div>
      ) : null}

      {canConnect ? (
        <div className="flex flex-wrap gap-2">
          {pending?.link ? (
            <GradientButton size="sm" href={pending.link} target="_blank" rel="noopener noreferrer">
              {t('chatChannels.openIn', { app: meta.name })}
            </GradientButton>
          ) : null}
          <button type="button" className={OUTLINE} disabled={busy} onClick={onStart}>
            {pending ? t('chatChannels.newCode') : connected ? t('chatChannels.connectAnother') : t(`chatChannels.connect.${provider}`)}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function BindingRow({ binding }) {
  const t = useT()
  const { locale } = useLocale()
  const revoke = useMutation(api.bot.bindings.revokeChannel)
  const setReminder = useMutation(api.bot.bindings.setReminder)
  const { showToast } = useToast()
  const [enabled, setEnabled] = useState(binding.reminderEnabled)
  const [time, setTime] = useState(binding.reminderTime)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const id = `reminder-${binding.id}`
  const name = PROVIDERS[binding.provider]?.name ?? binding.provider

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
      showToast('success', t('chatChannels.reminderSaved'))
      setEditing(false)
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
      showToast('success', t('chatChannels.disconnected', { app: name }))
    } catch (err) {
      showToast('error', errorMessage(err))
      setBusy(false)
    }
  }

  const facts = [
    [t('chatChannels.organization'), binding.companyName],
    [t('chatChannels.defaultSite'), binding.siteName || t('chatChannels.allSites')],
    [
      t('chatChannels.dailyReminder'),
      binding.reminderEnabled ? t('chatChannels.reminderAt', { time: binding.reminderTime }) : t('chatChannels.reminderOff'),
    ],
    [t('chatChannels.connectedOn'), new Date(binding.verifiedAt).toLocaleDateString(locale || undefined)],
  ]

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2 rounded-[8px] bg-surface-2 p-3">
        {facts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-xs leading-4">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right text-text">{value}</dd>
          </div>
        ))}
      </dl>
      {editing ? (
        <div className="flex flex-col gap-3 text-sm text-text">
          <label className="flex min-h-11 items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--cyan)]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              {t('chatChannels.reminderLabel')}
              <span className="block text-muted">{t('chatChannels.reminderHint')}</span>
            </span>
          </label>
          {enabled ? (
            <Field label={t('chatChannels.reminderTime')} htmlFor={id} hint={binding.reminderTimezone || browserTimezone()}>
              <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="max-w-[10rem]" />
            </Field>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <button type="submit" className={OUTLINE} disabled={busy}>
            {t('chatChannels.saveReminder')}
          </button>
        ) : (
          <button type="button" className={OUTLINE} onClick={() => setEditing(true)}>
            {t('chatChannels.preferences')}
          </button>
        )}
        <button type="button" className={DANGER_TEXT} disabled={busy} onClick={disconnect}>
          {t('chatChannels.disconnect')}
        </button>
      </div>
    </form>
  )
}
