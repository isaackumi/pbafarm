import React, { createContext, useContext, useState, useCallback } from 'react'

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
      <div className="pointer-events-none fixed inset-x-0 top-0 pt-[max(0.75rem,env(safe-area-inset-top))] px-3 space-y-2 z-[60] lg:inset-x-auto lg:top-auto lg:bottom-0 lg:right-0 lg:p-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto rounded-lg border p-4 shadow-md max-w-md mx-auto lg:mx-0 bg-surface transition-colors duration-300 ease-in-out ${
              toast.type === 'error'
                ? 'border-signal/40 text-signal'
                : toast.type === 'success'
                  ? 'border-kelp/40 text-kelp'
                  : toast.type === 'warning'
                    ? 'border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300'
                    : 'border-foam-deep text-chart-ink'
            }`}
          >
            <div className="flex items-start">
              <div className="flex-1">
                <p className="text-sm font-medium">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="ml-2 -my-2 -mr-2 h-11 w-11 inline-flex items-center justify-center shrink-0 rounded text-muted hover:text-chart-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
              >
                <span className="sr-only">Close</span>
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
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