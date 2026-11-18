import { useEffect, useRef } from 'react'
import { nextFocus } from '../lib/dialogFocus'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard behaviour for a modal dialog (UX-003): focus moves into the
 * dialog when it opens, Tab and Shift+Tab stay inside it, Escape calls
 * `onClose` (unless `canClose` is false), and focus returns to the control
 * that opened it. Put the returned ref on the dialog panel.
 */
export function useDialogA11y({ open = true, onClose, canClose = true } = {}) {
  const ref = useRef(null)
  const onCloseRef = useRef(onClose)
  const canCloseRef = useRef(canClose)
  useEffect(() => {
    onCloseRef.current = onClose
    canCloseRef.current = canClose
  })

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const opener = document.activeElement
    const panel = ref.current
    const items = () =>
      panel
        ? [...panel.querySelectorAll(FOCUSABLE)].filter(
            (el) => el.getClientRects().length > 0 || el === document.activeElement,
          )
        : []

    if (panel && !panel.contains(document.activeElement)) {
      const auto = panel.querySelector('[autofocus], [data-autofocus]')
      const all = items()
      const firstField = all.find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !el.readOnly)
      const target = auto || firstField || all[0] || panel
      if (target === panel && !panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1')
      target.focus?.()
    }

    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (canCloseRef.current !== false) {
          e.stopPropagation()
          onCloseRef.current?.()
        }
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const next = nextFocus(items(), document.activeElement, e.shiftKey)
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [open])

  return ref
}
