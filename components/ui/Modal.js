import { useId } from 'react'
import { X } from 'lucide-react'
import { useT } from '../../lib/i18n/context'
import { useDialogA11y } from '../../hooks/useDialogA11y'

const MODAL_SIZE = {
  sm: 'max-w-sm',
  md: 'max-w-[440px]',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
}

/** Icon badge tones (Paper 63 confirm dialog: 44px tinted circle). */
const ICON_TONE = {
  danger: 'border-[color:var(--alert-tint-border)] bg-[color:var(--alert-tint-bg)] text-alert',
  warn: 'border-[color:var(--warn-tint-border)] bg-[color:var(--warn-tint-bg)] text-warn',
  info: 'border-line-strong bg-surface text-cyan',
  neutral: 'border-line-strong bg-surface text-muted',
}

/** 44px tinted circle that holds a dialog or state icon. */
export function IconBadge({ tone = 'neutral', size = 44, className = '', children }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border [&>svg]:h-5 [&>svg]:w-5 ${ICON_TONE[tone] || ICON_TONE.neutral} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {children}
    </span>
  )
}

/**
 * Shared dialog (UX-901, Paper 63 / P-MODAL). Renders nothing while `open`
 * is false. Backdrop click and Escape call `onClose` unless `dismissible` is
 * false (e.g. while saving); `closeOnBackdrop={false}` keeps long forms open
 * on a stray click. Focus moves in, is trapped, and returns to the opener
 * (useDialogA11y). `footer` holds the actions; the body scrolls. Pass
 * `as="form"` plus `onSubmit` to make the whole panel a form. `icon` sits in
 * a tinted badge above the title; `tone` picks the tint (an alertdialog
 * defaults to danger).
 */
export function Modal({
  open = true,
  onClose,
  title,
  description,
  icon,
  tone,
  footer,
  children,
  size = 'md',
  dismissible = true,
  closeOnBackdrop = true,
  showClose = false,
  role = 'dialog',
  as: Panel = 'div',
  className = '',
  bodyClassName = '',
  layerClassName = 'z-[100]',
  ...panelProps
}) {
  const t = useT()
  const titleId = useId()
  const descriptionId = useId()
  const close = () => {
    if (dismissible) onClose?.()
  }
  const panelRef = useDialogA11y({ open, onClose, canClose: dismissible })
  if (!open) return null
  const iconTone = tone || (role === 'alertdialog' ? 'danger' : 'neutral')

  return (
    <div className={`fixed inset-0 flex items-center justify-center p-4 ${layerClassName}`}>
      <div
        className="absolute inset-0 modal-backdrop"
        onClick={closeOnBackdrop ? close : undefined}
        aria-hidden
      />
      <Panel
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        className={`relative flex max-h-[90vh] w-full flex-col gap-5 rounded-[24px] border border-line-strong bg-surface-2 p-6 text-text shadow-[0_24px_64px_rgb(0_0_0/0.5)] sm:p-7 ${MODAL_SIZE[size] || MODAL_SIZE.md} ${className}`}
        {...panelProps}
      >
        {(title || showClose || icon) && (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {icon && <IconBadge tone={iconTone}>{icon}</IconBadge>}
              {(title || description) && (
                <div className="flex flex-col gap-2">
                  {title && (
                    <h2 id={titleId} className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em] text-text">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p id={descriptionId} className="text-sm leading-5 text-muted">
                      {description}
                    </p>
                  )}
                </div>
              )}
            </div>
            {showClose && (
              <button
                type="button"
                onClick={close}
                disabled={!dismissible}
                aria-label={t('common.close')}
                className="-m-1 rounded-full p-1.5 text-muted hover:bg-surface hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>
        )}
        {children != null && children !== false && (
          <div className={`-mx-1 min-h-0 flex-1 overflow-y-auto px-1 ${bodyClassName}`}>{children}</div>
        )}
        {footer && (
          <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end">{footer}</div>
        )}
      </Panel>
    </div>
  )
}
