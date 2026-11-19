import { Button, Modal } from './ui'

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

  const batches = `${count} entr${count === 1 ? 'y' : 'ies'}`

  return (
    <Modal
      onClose={onCancel}
      dismissible={!sending}
      role="alertdialog"
      layerClassName="z-[110]"
      closeOnBackdrop={false}
      title={`${batches} not sent yet`}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={sending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onDiscard} disabled={sending}>
            Discard and sign out
          </Button>
          <Button onClick={onSend} disabled={sending || !online}>
            {sending ? 'Sending…' : 'Send and sign out'}
          </Button>
        </>
      }
    >
      <div className="text-sm space-y-2">
        <p>
          Entries saved on this phone are removed when you sign out.
          Send them now, or discard them if they are no longer needed.
        </p>
        {!online && (
          <p className="text-signal">No connection. Connect to send them.</p>
        )}
        {note && <p className="text-signal">{note}</p>}
      </div>
    </Modal>
  )
}
