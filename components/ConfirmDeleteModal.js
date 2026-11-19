import { AlertTriangle } from 'lucide-react'
import { Button, Modal } from './ui'
import { useT } from '../lib/i18n/context'

/**
 * Shared destructive-action confirmation (Paper 63). Use for every
 * permanent/soft delete.
 */
export default function ConfirmDeleteModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy = false,
  onCancel,
  onConfirm,
}) {
  const t = useT()
  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      role="alertdialog"
      tone="danger"
      title={title || t('overlay.confirmDelete.title')}
      icon={<AlertTriangle aria-hidden />}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel || t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? t('overlay.confirmDelete.deleting') : confirmLabel || t('overlay.confirmDelete.confirm')}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-5 text-muted">{message || t('overlay.confirmDelete.message')}</div>
    </Modal>
  )
}
