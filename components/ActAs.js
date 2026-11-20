import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, Input, Modal, Textarea } from './ui'
import { useT } from '../lib/i18n/context'
import { getActiveLocale } from '../lib/format'

/** Clock time the session ends, e.g. "08:15" (Paper 63 "ends 08:15"). */
function endsAt(expiresAt) {
  return new Intl.DateTimeFormat(getActiveLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(expiresAt),
  )
}

/**
 * Support-access banner (ENT-006): always visible while a super_admin is
 * acting as an organization, with the time left and a stop button.
 */
export function ActAsBanner() {
  const t = useT()
  const { user } = useAuth()
  const session = useQuery(api.actAs.status, user?.realRole === 'super_admin' ? {} : 'skip')
  const stop = useMutation(api.actAs.stop)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!session) return undefined
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [session])
  if (!session || session.expiresAt <= now) return null
  return (
    // Paper 63 act-as strip: 44px, 1.5px sky-gradient hairline under the bar.
    // Dark: #0F1A2B bar, sky eye, muted tail, lime-outlined Exit. Light:
    // #F3FAD6 bar, lime-ink eye, text-colour tail, ink-filled Exit.
    <div role="status" className="sticky top-0 z-40 pb-[1.5px]" style={{ backgroundImage: 'var(--gradient-sky)' }}>
      <div className="flex min-h-[42.5px] flex-wrap items-center justify-center gap-x-3.5 gap-y-1 bg-[#0F1A2B] px-4 py-2 text-[13px] leading-4 [[data-theme=light]_&]:bg-[#F3FAD6]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-sky-ink [[data-theme=light]_&]:text-lime-ink" aria-hidden>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span className="text-text">
          {t('overlay.actAs.viewingAs')} <b className="font-semibold">{session.companyName}</b>
          <span className="text-muted [[data-theme=light]_&]:text-text">
            {' · '}
            {session.allowWrites ? t('overlay.actAs.writes') : t('overlay.actAs.readOnly')}
            {' · '}
            {t('overlay.actAs.endsAt', { time: endsAt(session.expiresAt) })}
            {session.reason ? ` · ${session.reason}` : ''}
          </span>
        </span>
        <button
          type="button"
          aria-label={t('overlay.actAs.exitLabel')}
          className="rounded-pill border border-[#4A5A1C] px-3.5 py-1 text-xs font-medium leading-4 text-lime-ink hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan [[data-theme=light]_&]:border-ink [[data-theme=light]_&]:bg-ink [[data-theme=light]_&]:text-white [[data-theme=light]_&]:hover:opacity-90"
          onClick={() => stop({}).then(() => window.location.reload())}
        >
          {t('overlay.actAs.exit')}
        </button>
      </div>
    </div>
  )
}

/** Start support access for one organization: reason, duration, writes. */
export function ActAsStartModal({ company, onClose }) {
  const t = useT()
  const start = useMutation(api.actAs.start)
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [allowWrites, setAllowWrites] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const open = Boolean(company)
  if (!open) return null

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await start({ companyId: company.id, reason, minutes: Number(minutes), allowWrites })
      window.location.assign('/dashboard')
    } catch (err) {
      setError(errorMessage(err, t('overlay.actAs.startFailed')))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      as="form"
      onSubmit={submit}
      title={t('overlay.actAs.startTitle', { name: company.name })}
      description={t('overlay.actAs.startBody')}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy || reason.trim().length < 10}>
            {busy ? t('overlay.actAs.starting') : t('overlay.actAs.start')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
        <Field label={t('overlay.actAs.reason')} htmlFor="act-as-reason" required>
          <Textarea id="act-as-reason" required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('overlay.actAs.minutes')} htmlFor="act-as-minutes">
          <Input
            id="act-as-minutes"
            type="number"
            min={1}
            max={120}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" className="accent-[color:var(--cyan)]" checked={allowWrites} onChange={(e) => setAllowWrites(e.target.checked)} />
          {t('overlay.actAs.allowWrites')}
        </label>
      </div>
    </Modal>
  )
}
