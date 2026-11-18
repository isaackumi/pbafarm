import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ShieldAlert } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useDialogA11y } from '../hooks/useDialogA11y'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, Input, Textarea } from './ui'

function minutesLeft(expiresAt, now) {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000))
}

/**
 * Support-access banner (ENT-006): always visible while a super_admin is
 * acting as an organization, with the time left and a stop button.
 */
export function ActAsBanner() {
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
  const left = minutesLeft(session.expiresAt, now)
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-signal/40 bg-signal px-4 py-2 text-sm text-white"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-semibold">Support access: {session.companyName}</span>
      <span>
        {session.allowWrites ? 'Changes allowed and audited' : 'Read-only'} · ends in {left} min · {session.reason}
      </span>
      <button
        type="button"
        className="ml-auto rounded border border-white/60 px-2 py-0.5 font-medium hover:bg-white/10"
        onClick={() => stop({}).then(() => window.location.reload())}
      >
        End support access
      </button>
    </div>
  )
}

/** Start support access for one organization: reason, duration, writes. */
export function ActAsStartModal({ company, onClose }) {
  const start = useMutation(api.actAs.start)
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [allowWrites, setAllowWrites] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const open = Boolean(company)
  const panelRef = useDialogA11y({ open, onClose, canClose: !busy })
  if (!open) return null

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await start({ companyId: company.id, reason, minutes: Number(minutes), allowWrites })
      window.location.assign('/dashboard')
    } catch (err) {
      setError(errorMessage(err, 'Could not start support access'))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 modal-backdrop" onClick={() => !busy && onClose()} aria-hidden />
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="act-as-title"
        onSubmit={submit}
        className="relative w-full max-w-md space-y-4 rounded-xl border border-foam-deep bg-surface p-6 shadow-xl"
      >
        <h3 id="act-as-title" className="text-lg font-semibold text-chart-ink">
          Support access: {company.name}
        </h3>
        <p className="text-sm text-muted">
          You will see this organization as its admin until you end the session or it expires. Starting, ending and
          every change are recorded in the organization&apos;s audit log under your name.
        </p>
        {error && <p className="text-sm text-signal">{error}</p>}
        <Field label="Reason (ticket or request)" htmlFor="act-as-reason" required>
          <Textarea id="act-as-reason" required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Minutes (1–120)" htmlFor="act-as-minutes">
          <Input
            id="act-as-minutes"
            type="number"
            min={1}
            max={120}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-chart-ink">
          <input type="checkbox" checked={allowWrites} onChange={(e) => setAllowWrites(e.target.checked)} />
          Allow changes (default is read-only)
        </label>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || reason.trim().length < 10}>
            {busy ? 'Starting…' : 'Start support access'}
          </Button>
        </div>
      </form>
    </div>
  )
}
