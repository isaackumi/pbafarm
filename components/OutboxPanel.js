import { useState } from 'react'
import { CloudOff, RefreshCw } from 'lucide-react'
import { OUTBOX_KINDS, kindOf } from '../lib/offlineOutbox'
import { useOutbox } from '../hooks/useOutbox'
import { Button, EmptyState } from './ui'
import { useToast } from './Toast'

const when = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Entries saved on this device and waiting to send (MOBILE-002): pending
 * count, why an item was refused, and Retry / Discard per item. `compact`
 * renders nothing while the queue is empty and the phone is online, and only
 * lists items of `kinds` when given.
 */
export default function OutboxPanel({ compact = false, kinds = null, online = true }) {
  const { items: all, sending, send, discard } = useOutbox()
  const { showToast } = useToast()
  const [confirming, setConfirming] = useState(null)
  const items = kinds ? all.filter((i) => kinds.includes(kindOf(i))) : all

  if (compact && !items.length && online) return null

  const sendNow = async (only) => {
    const { sent, failed } = await send(only)
    if (sent) showToast(`Sent ${sent} saved entr${sent === 1 ? 'y' : 'ies'}`, 'success')
    if (failed) showToast(`${failed} saved entr${failed === 1 ? 'y needs' : 'ies need'} attention`, 'error')
    if (!sent && !failed) showToast('Could not reach the server. Try again when you have signal', 'info')
  }

  if (!compact && !items.length) {
    return (
      <EmptyState
        title="Nothing waiting to send"
        description="Entries saved without signal appear here until they reach the server."
      />
    )
  }

  return (
    <div
      className={
        compact ? 'mb-5 rounded-lg border border-foam-deep bg-foam p-3 text-sm space-y-2' : 'space-y-3'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <CloudOff size={16} className="text-muted shrink-0" aria-hidden />
        <span className="text-chart-ink">
          {!online ? 'Offline. Entries are saved on this device. ' : ''}
          {items.length > 0 &&
            `${items.length} entr${items.length === 1 ? 'y' : 'ies'} waiting to send`}
        </span>
        {online && items.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => sendNow()}
            disabled={sending}
            className="ml-auto"
          >
            <RefreshCw size={14} aria-hidden className={sending ? 'animate-spin' : ''} />
            {sending ? 'Sending…' : 'Send now'}
          </Button>
        )}
      </div>
      {(compact ? items.filter((i) => i.lastError) : items).map((i) => (
        <div
          key={i.id}
          className={`rounded-lg border p-3 ${
            i.lastError ? 'border-signal/30 bg-signal/5' : 'border-foam-deep bg-surface'
          }`}
        >
          <p className="font-medium text-chart-ink">
            {OUTBOX_KINDS[kindOf(i)]}
            {i.summary ? <span className="font-normal text-muted"> · {i.summary}</span> : null}
          </p>
          <p className="text-xs text-muted">Saved {when(i.queuedAt)}</p>
          {i.lastError && <p className="mt-1 text-sm text-signal">{i.lastError}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {online && (
              <Button variant="secondary" size="sm" onClick={() => sendNow(i.id)} disabled={sending}>
                Retry
              </Button>
            )}
            {confirming === i.id ? (
              <>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    discard(i.id)
                    setConfirming(null)
                  }}
                >
                  Discard for good
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(i.id)}>
                Discard
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
