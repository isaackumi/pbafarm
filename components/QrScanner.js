import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Field, Input, StatusDot } from './ui'
import { useT } from '../lib/i18n/context'

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
export default function QrScanner({ open, onClose, onResult, title }) {
  const t = useT()
  const heading = title || t('scan.labelTitle')
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
        setReason('unsupported')
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
        setReason(denied ? 'denied' : 'failed')
        setStatus('fallback')
      }
    }
    start()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
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

  const iconBtn =
    'inline-flex h-11 w-11 items-center justify-center rounded-full border border-line-strong text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      className="fixed inset-0 z-[70] flex flex-col bg-bg text-text"
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="h-11 w-11" aria-hidden />
        <p className="text-[17px] font-semibold leading-[22px]">{heading}</p>
        <button type="button" onClick={onClose} aria-label={t('scan.close')} className={iconBtn}>
          <X size={20} aria-hidden />
        </button>
      </div>

      <div
        className="relative mx-4 flex-1 overflow-hidden rounded-[24px] bg-surface"
        style={{ backgroundImage: 'radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--cyan) 14%, transparent), transparent 70%)' }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${status === 'scanning' ? '' : 'hidden'}`}
        />
        {(status === 'scanning' || status === 'starting') && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5">
            <ScanFrame className="h-60 w-60" />
            <span className="inline-flex items-center gap-2 rounded-pill border border-line bg-bg px-4 py-2 text-[14px]">
              <StatusDot tone={status === 'scanning' ? 'good' : 'neutral'} size={8} />
              {status === 'scanning' ? t('scan.pointAt') : t('scan.starting')}
            </span>
          </div>
        )}
        {status === 'fallback' && (
          <p className="px-6 pt-8 text-[14px] leading-5 text-muted">{t(`scan.reason.${reason}`)}</p>
        )}
      </div>

      <form
        onSubmit={submitTyped}
        className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4"
      >
        <Field label={t('scan.typeLabel')} htmlFor="qr-typed">
          <Input
            id="qr-typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder={t('scan.typePlaceholder')}
          />
        </Field>
        <button
          type="submit"
          disabled={!typed.trim()}
          className="flex min-h-[52px] w-full items-center justify-center rounded-[16px] bg-button text-[16px] font-medium text-button-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('scan.openCage')}
        </button>
      </form>
    </div>
  )
}

/** Corner brackets from 54 Mobile Scan: cyan on the left, pink on the right. */
export function ScanFrame({ className = 'h-40 w-40' }) {
  const corner = 'absolute h-[22%] w-[22%] border-[3px]'
  return (
    <div className={`relative ${className}`} aria-hidden>
      <span className={`${corner} left-0 top-0 rounded-tl-[18px] border-b-0 border-r-0 border-cyan`} />
      <span className={`${corner} right-0 top-0 rounded-tr-[18px] border-b-0 border-l-0 border-pink`} />
      <span className={`${corner} bottom-0 left-0 rounded-bl-[18px] border-r-0 border-t-0 border-cyan`} />
      <span className={`${corner} bottom-0 right-0 rounded-br-[18px] border-l-0 border-t-0 border-pink`} />
    </div>
  )
}
