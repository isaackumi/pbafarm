import { useEffect, useId, useState } from 'react'
import { GhostButton, Modal } from './ui'
import { DangerButton } from './ui/Modal'
import { useT } from '../lib/i18n/context'

/** Paper 63 bin glyph (20px in the 44px badge). */
function BinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  )
}

/**
 * Shared destructive-action confirmation (Paper 63 "Confirm delete modal").
 * Use for every permanent/soft delete. `confirmWord` (e.g. "DELETE") adds
 * the type-to-confirm field and keeps the delete button off until it matches.
 */
export default function ConfirmDeleteModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  confirmWord,
  busy = false,
  onCancel,
  onConfirm,
}) {
  const t = useT()
  const fieldId = useId()
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (!open) setTyped('')
  }, [open])
  const matched = !confirmWord || typed.trim() === confirmWord
  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      role="alertdialog"
      tone="danger"
      title={title || t('overlay.confirmDelete.title')}
      description={message || t('overlay.confirmDelete.message')}
      icon={<BinIcon />}
      footer={
        <>
          <GhostButton size="dialog" className="justify-center" disabled={busy} onClick={onCancel}>
            {cancelLabel || t('common.cancel')}
          </GhostButton>
          <DangerButton disabled={busy || !matched} onClick={onConfirm}>
            {busy ? t('overlay.confirmDelete.deleting') : confirmLabel || t('overlay.confirmDelete.confirm')}
          </DangerButton>
        </>
      }
    >
      {confirmWord && (
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-[13px] leading-4 text-muted [[data-theme=light]_&]:text-text">
            {t('overlay.confirmDelete.typePrefix')} <span className="font-geist text-text">{confirmWord}</span>{' '}
            {t('overlay.confirmDelete.typeSuffix')}
          </label>
          <input
            id={fieldId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className="w-full rounded-input border border-line-strong bg-surface px-4 py-3 font-geist text-[14px] leading-[18px] text-text placeholder:text-faint focus:border-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40"
          />
        </div>
      )}
    </Modal>
  )
}
