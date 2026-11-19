import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import QrScanner, { ScanFrame } from '../components/QrScanner'
import { ScanLine } from 'lucide-react'
import { Segmented } from '../components/ui'
import { useToast } from '../components/Toast'
import { findCageByCode, parseCageScan, scanHref } from '../lib/qrTarget'
import { useT } from '../lib/i18n/context'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { useReferenceList } from '../hooks/useReferenceList'

const TARGET_KEY = 'pbafarm:scan:target'

export default function ScanPage() {
  return (
    <ProtectedRoute>
      <Scan />
    </ProtectedRoute>
  )
}

/**
 * Scan a cage label and land on daily entry or bi-weekly sampling with that
 * cage already selected (MOBILE-006). Labels that name a screen go there;
 * plain codes use the screen chosen here.
 */
function Scan() {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(true)
  const handledCode = useRef(null)
  const t = useT()
  const [target, setTarget] = useState('daily')
  const { locationArgs } = useLocation()
  const { list: cages, ready: cagesLoaded } = useReferenceList('cages', api.cages.getActive, locationArgs)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TARGET_KEY)
      if (saved === 'daily' || saved === 'biweekly') setTarget(saved)
    } catch {
      // storage blocked
    }
  }, [])

  // A label opened by the phone's own camera: /scan?c=<short code>.
  const labelCode = router.isReady && typeof router.query.c === 'string' ? router.query.c : null
  useEffect(() => {
    if (!labelCode || !cagesLoaded || handledCode.current === labelCode) return
    handledCode.current = labelCode
    const cage = findCageByCode(labelCode, cages || [])
    if (!cage) {
      showToast(t('scan.unknownCode', { code: labelCode }), 'error')
      router.replace('/scan', undefined, { shallow: true })
      return
    }
    setOpen(false)
    router.replace(scanHref({ cageIds: [String(cage.id || cage._id)], target: null }, target))
  }, [labelCode, cagesLoaded, cages, target, router, showToast, t])

  const chooseTarget = (next) => {
    setTarget(next)
    try {
      localStorage.setItem(TARGET_KEY, next)
    } catch {
      // storage blocked
    }
  }

  const onResult = (text) => {
    // Without a cage list (offline, first run) only full label URLs can be read.
    const hit = parseCageScan(text, cages?.length ? cages : null)
    const href = hit && (cages?.length || /^https?:|^\//.test(text.trim())) ? scanHref(hit, target) : null
    if (!href) {
      showToast(t('scan.noMatch'), 'error')
      setOpen(false)
      return
    }
    router.push(href)
  }

  return (
    <Layout title={t('scan.title')} eyebrow={t('scan.eyebrow')}>
      <section
        aria-labelledby="scan-card-title"
        className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-6 rounded-[24px] border border-line bg-surface p-6 text-center shadow-[var(--shadow-card)]"
      >
        <ScanFrame />
        <div className="flex flex-col gap-1">
          <h2 id="scan-card-title" className="text-[20px] font-semibold leading-6 text-text">
            {t('scan.title')}
          </h2>
          <p className="text-[14px] leading-5 text-muted">{t('scan.subtitle')}</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-muted">{t('scan.openIn')}</span>
          <Segmented
            label={t('scan.openIn')}
            options={[
              { value: 'daily', label: t('scan.daily') },
              { value: 'biweekly', label: t('scan.biweekly') },
            ]}
            value={target}
            onChange={chooseTarget}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[16px] bg-button text-[16px] font-medium text-button-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ScanLine size={20} aria-hidden />
          {t('scan.start')}
        </button>
        {labelCode && (
          <p role="status" className="text-sm text-muted">
            {t('scan.openingCode', { code: labelCode })}
          </p>
        )}
      </section>
      <QrScanner open={open && !labelCode} onClose={() => setOpen(false)} onResult={onResult} />
    </Layout>
  )
}
