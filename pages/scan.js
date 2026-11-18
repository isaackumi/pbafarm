import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import QrScanner from '../components/QrScanner'
import { Button, FormCard, TabBar } from '../components/ui'
import { useToast } from '../components/Toast'
import { cageService } from '../lib/cageService'
import { findCageByCode, parseCageScan, scanHref } from '../lib/qrTarget'
import { useT } from '../lib/i18n/context'
import { useAuth } from '../contexts/AuthContext'
import { getActiveLocationId } from '../lib/locationScope'
import { readReferenceList, saveReferenceData } from '../lib/referenceCache'

const TARGET_KEY = 'pbafarm:scan:target'

export default function ScanPage() {
  return (
    <ProtectedRoute>
      <Layout title="Scan cage">
        <Scan />
      </Layout>
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
  const [cages, setCages] = useState(null)
  const [cagesLoaded, setCagesLoaded] = useState(false)
  const handledCode = useRef(null)
  const t = useT()
  const [target, setTarget] = useState('daily')
  const { user } = useAuth()
  const userId = user?.id

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TARGET_KEY)
      if (saved === 'daily' || saved === 'biweekly') setTarget(saved)
    } catch {
      // storage blocked
    }
    cageService.getActiveCages().then((res) => {
      if (!res.error) {
        setCages(res.data || [])
        saveReferenceData(userId, getActiveLocationId(), { cages: res.data || [] })
      } else {
        setCages(readReferenceList(userId, getActiveLocationId(), 'cages'))
      }
      setCagesLoaded(true)
    })
  }, [userId])

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

  const chooseTarget = (t) => {
    setTarget(t)
    try {
      localStorage.setItem(TARGET_KEY, t)
    } catch {
      // storage blocked
    }
  }

  const onResult = (text) => {
    // Without a cage list (offline, first run) only full label URLs can be read.
    const hit = parseCageScan(text, cages?.length ? cages : null)
    const href = hit && (cages?.length || /^https?:|^\//.test(text.trim())) ? scanHref(hit, target) : null
    if (!href) {
      showToast('No cage on this farm matches that label', 'error')
      setOpen(false)
      return
    }
    router.push(href)
  }

  return (
    <FormCard title="Scan cage" subtitle="Point the camera at the label on the cage.">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">Open in</span>
          <TabBar
            tabs={[
              { id: 'daily', label: 'Daily entry' },
              { id: 'biweekly', label: 'Bi-weekly sampling' },
            ]}
            active={target}
            onChange={chooseTarget}
          />
        </div>
        <Button size="lg" onClick={() => setOpen(true)} className="w-full sm:w-auto">
          Start scanning
        </Button>
      </div>
      {labelCode && (
        <p role="status" className="mt-4 text-sm text-muted">
          {t('scan.openingCode', { code: labelCode })}
        </p>
      )}
      <QrScanner open={open && !labelCode} onClose={() => setOpen(false)} onResult={onResult} />
    </FormCard>
  )
}
