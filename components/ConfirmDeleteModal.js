import { AlertTriangle } from 'lucide-react'
import { Button } from './ui'
import { useDialogA11y } from '../hooks/useDialogA11y'

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
  const panelRef = useDialogA11y({ open, onClose: onCancel, canClose: !busy })
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 modal-backdrop"
        onClick={() => !busy && onCancel?.()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="relative w-full max-w-md rounded-xl border border-foam-deep bg-surface p-6 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 shrink-0 text-signal" />
          <h3
            id="confirm-delete-title"
            className="text-lg font-semibold text-chart-ink"
          >
            {title}
          </h3>
        </div>
        <div className="mb-5 text-sm text-muted">{message}</div>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
