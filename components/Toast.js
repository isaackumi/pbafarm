import React, { createContext, useContext, useState, useCallback } from 'react'
import { useT } from '../lib/i18n/context'

/**
 * Paper 63 dot colours. Dark uses the status tokens (sky for info); light
 * gives its own literals (#16A34A, #D97706, #3D86E6); error is the alert
 * token on both.
 */
const DOT = {
  error: 'bg-alert',
  success: 'bg-good [[data-theme=light]_&]:bg-[#16A34A]',
  warning: 'bg-warn [[data-theme=light]_&]:bg-[#D97706]',
  info: 'bg-sky-ink [[data-theme=light]_&]:bg-[#3D86E6]',
}

/** Paper 63 surface for toasts and the update card: surface-2 + line-strong, no shadow on dark; white + line + shadow on light. */
export const TOAST_SURFACE =
  'bg-surface-2 [[data-theme=light]_&]:bg-surface [[data-theme=light]_&]:shadow-[0_12px_32px_#1018282E]'

/**
 * Paper 63 toast pill: 8px status dot, 13/16 message, 10/18 padding, 10px
 * gaps. A failed toast has a #5A2A2A edge and may carry a "Retry" pill
 * (`action`). The close button is the app's own (not in Paper). The dot's
 * meaning is also read out.
 */
function ToastPill({ toast, onClose }) {
  const t = useT()
  const error = toast.type === 'error'
  const action = toast.action
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-pill border py-2.5 pl-[18px] pr-2.5 text-[13px] leading-4 text-text lg:w-auto lg:max-w-[400px] ${TOAST_SURFACE} ${
        error ? 'border-[#5A2A2A]' : 'border-line-strong [[data-theme=light]_&]:border-line'
      }`}
    >
      <span className={`size-2 shrink-0 rounded-full ${DOT[toast.type] || DOT.info}`} aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="sr-only">{t(`overlay.toast.${toast.type in DOT ? toast.type : 'info'}`)}: </span>
        {toast.message}
      </p>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick?.()
            onClose()
          }}
          className={`shrink-0 rounded-pill border px-3 py-1 text-xs font-medium leading-4 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
            error ? 'border-[#5A2A2A] text-alert' : 'border-line-strong text-text'
          }`}
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="-my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        <span className="sr-only">{t('common.close')}</span>
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

const ToastContext = createContext(null)

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([])

  /** showToast(message, type, { action: { label, onClick } }) — `action` adds a pill such as "Retry". */
  const showToast = useCallback((messageOrType, typeOrMessage = 'info', options = {}) => {
    const known = ['error', 'success', 'info', 'warning']
    let message = messageOrType
    let type = typeOrMessage
    // Support both showToast(msg, type) and showToast(type, msg)
    if (
      known.includes(messageOrType) &&
      typeof typeOrMessage === 'string' &&
      !known.includes(typeOrMessage)
    ) {
      type = messageOrType
      message = typeOrMessage
    }
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type, action: options?.action }])

    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 5000)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Phones: top of the screen, clear of the tab bar and save bars. Desktop: 32px from the bottom-right corner, 10px apart (Paper 63). */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2.5 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:inset-x-auto lg:bottom-0 lg:right-0 lg:top-auto lg:items-end lg:p-8">
        {toasts.map((toast) => (
          <ToastPill key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

export default ToastProvider 