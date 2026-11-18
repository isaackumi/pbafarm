import { Button } from './ui'
import { useDialogA11y } from '../hooks/useDialogA11y'

/**
 * Asked before sign-out when this user still has field entries saved on the
 * device. Sign-out clears the device, so the entries must be sent or
 * deliberately discarded first.
 */
export default function SignOutOutboxDialog({
  count,
  note,
  sending,
  onSend,
  onDiscard,
  onCancel,
}) {
  const online = typeof navigator === 'undefined' || navigator.onLine !== false

  const panelRef = useDialogA11y({ onClose: onCancel, canClose: !sending })

  const batches = `${count} entr${count === 1 ? 'y' : 'ies'}`

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4 modal-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="signout-outbox-title"
      aria-describedby="signout-outbox-body"
    >
      <div ref={panelRef} className="w-full max-w-md rounded-xl border border-foam-deep bg-surface text-chart-ink shadow-xl p-5 space-y-4">
        <h2 id="signout-outbox-title" className="text-lg font-semibold">
          {batches} not sent yet
        </h2>
        <div id="signout-outbox-body" className="text-sm space-y-2">
          <p>
            Entries saved on this phone are removed when you sign out.
            Send them now, or discard them if they are no longer needed.
          </p>
          {!online && (
            <p className="text-signal">No connection. Connect to send them.</p>
          )}
          {note && <p className="text-signal">{note}</p>}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={sending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onDiscard} disabled={sending}>
            Discard and sign out
          </Button>
          <Button onClick={onSend} disabled={sending || !online}>
            {sending ? 'Sending…' : 'Send and sign out'}
          </Button>
        </div>
      </div>
    </div>
  )
}
