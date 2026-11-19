import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ShieldAlert } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, Input, Modal, Textarea } from './ui'

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
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      as="form"
      onSubmit={submit}
      title={`Support access: ${company.name}`}
      description="You will see this organization as its admin until you end the session or it expires. Starting, ending and every change are recorded in the organization's audit log under your name."
      footer={
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || reason.trim().length < 10}>
            {busy ? 'Starting…' : 'Start support access'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
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
      </div>
    </Modal>
  )
}
