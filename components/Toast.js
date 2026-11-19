import React, { createContext, useContext, useState, useCallback } from 'react'
import { useT } from '../lib/i18n/context'

const DOT = {
  error: 'bg-dot-alert',
  success: 'bg-dot-good',
  warning: 'bg-dot-warn',
  info: 'bg-cyan',
}

/** Paper 63 toast pill: status dot, message, close. The dot's meaning is also read out. */
function ToastPill({ toast, onClose }) {
  const t = useT()
  const error = toast.type === 'error'
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-[22px] border bg-surface-2 py-1 pl-[18px] pr-1 text-sm leading-[18px] text-text shadow-[0_12px_32px_rgb(0_0_0/0.25)] lg:w-auto lg:max-w-[400px] ${
        error ? 'border-[color:var(--alert-tint-border)]' : 'border-line-strong'
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[toast.type] || DOT.info}`} aria-hidden />
      <p className="min-w-0 flex-1 py-2">
        <span className="sr-only">{t(`overlay.toast.${toast.type in DOT ? toast.type : 'info'}`)}: </span>
        {toast.message}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        <span className="sr-only">{t('common.close')}</span>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

const ToastContext = createContext(null)

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((messageOrType, typeOrMessage = 'info') => {
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
    setToasts((prev) => [...prev, { id, message, type }])

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
      {/* Phones: top of the screen, clear of the tab bar and save bars. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2.5 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:inset-x-auto lg:bottom-0 lg:right-0 lg:top-auto lg:items-end lg:p-5">
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