import { AlertTriangle } from 'lucide-react'

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
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 modal-backdrop"
        onClick={() => !busy && onCancel?.()}
        aria-hidden
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="relative w-full max-w-md rounded-2xl border border-foam-deep bg-surface p-6 shadow-xl"
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
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-10 rounded-xl border border-input-border px-4 py-2 text-sm font-medium text-chart-ink hover:bg-foam-deep/40 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-10 rounded-xl bg-signal px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
