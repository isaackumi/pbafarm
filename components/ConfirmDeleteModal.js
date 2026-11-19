import { AlertTriangle } from 'lucide-react'
import { Button, Modal } from './ui'

/**
 * Shared destructive-action confirmation. Use for every permanent/soft delete.
 */
export default function ConfirmDeleteModal({
  open,
  title = 'Confirm delete',
  message = 'This action cannot be undone.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  onCancel,
  onConfirm,
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      role="alertdialog"
      title={title}
      icon={<AlertTriangle className="h-6 w-6 text-signal" aria-hidden />}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{message}</div>
    </Modal>
  )
}
