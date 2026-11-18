import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Field, Input } from './ui'

/** True when this browser can read QR codes from the camera itself. */
export function canScanInApp() {
  return (
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

/**
 * Full-screen cage label scanner (MOBILE-006). Uses the browser's
 * BarcodeDetector with the back camera; where that is missing (iOS Safari,
 * older Android WebViews) or the camera is refused, the person types the cage
 * code or name instead. Calls `onResult(text)` with the raw value once.
 */
export default function QrScanner({ open, onClose, onResult, title = 'Scan cage label' }) {
  const videoRef = useRef(null)
  const [status, setStatus] = useState('idle') // idle | starting | scanning | fallback
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const doneRef = useRef(false)

  useEffect(() => {
    if (!open) return undefined
    doneRef.current = false
    setTyped('')
    let stream = null
    let timer = null
    let cancelled = false

    const start = async () => {
      if (!canScanInApp()) {
        setReason('This browser cannot scan inside the app. Type the cage code or name, or scan with the phone camera.')
        setStatus('fallback')
        return
      }
      setStatus('starting')
      try {
        const formats = (await window.BarcodeDetector.getSupportedFormats?.()) || ['qr_code']
        if (!formats.includes('qr_code')) throw new Error('QR codes are not supported')
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) return
        const video = videoRef.current
        video.srcObject = stream
        await video.play()
        setStatus('scanning')
        const tick = async () => {
          if (cancelled || doneRef.current) return
          try {
            const codes = await detector.detect(video)
            const value = codes?.[0]?.rawValue
            if (value && !doneRef.current) {
              doneRef.current = true
              if (navigator.vibrate) navigator.vibrate(60)
              onResult(value)
              return
            }
          } catch {
            // frame not ready; try the next one
          }
          timer = setTimeout(tick, 200)
        }
        tick()
      } catch (err) {
        if (cancelled) return
        const denied = /denied|notallowed|permission/i.test(String(err?.name || err?.message))
        setReason(
          denied
            ? 'Camera access was refused. Type the cage code or name instead.'
            : 'The camera could not start. Type the cage code or name instead.',
        )
        setStatus('fallback')
      }
    }
    start()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // onResult is read once per scan; restarting the camera on every render is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const submitTyped = (e) => {
    e.preventDefault()
    const value = typed.trim()
    if (!value) return
    doneRef.current = true
    onResult(value)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] flex flex-col bg-black text-white"
    >
      <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <p className="font-medium">{title}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="inline-flex h-12 w-12 items-center justify-center rounded-lg hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X size={22} aria-hidden />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${status === 'scanning' ? '' : 'hidden'}`}
        />
        {status === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-60 w-60 rounded-2xl border-2 border-white/80" />
          </div>
        )}
        {status === 'starting' && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
            Starting camera…
          </p>
        )}
        {status === 'fallback' && (
          <p className="px-6 pt-8 text-sm text-white/80">{reason}</p>
        )}
      </div>

      <form
        onSubmit={submitTyped}
        className="bg-surface text-chart-ink px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3"
      >
        <Field label="Or type the cage code or name" htmlFor="qr-typed">
          <Input
            id="qr-typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="e.g. C-012 or A3"
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={!typed.trim()}>
          Open cage
        </Button>
      </form>
    </div>
  )
}
