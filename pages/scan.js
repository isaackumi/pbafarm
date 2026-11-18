import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import QrScanner from '../components/QrScanner'
import { Button, FormCard, TabBar } from '../components/ui'
import { useToast } from '../components/Toast'
import { cageService } from '../lib/cageService'
import { parseCageScan, scanHref } from '../lib/qrTarget'

const TARGET_KEY = 'pbafarm:scan:target'
const LOOKUPS_CACHE_KEY = 'pbafarm:daily-entry:lookups'

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
  const [target, setTarget] = useState('daily')

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
        return
      }
      try {
        setCages(JSON.parse(localStorage.getItem(LOOKUPS_CACHE_KEY) || 'null')?.cages || null)
      } catch {
        setCages(null)
      }
    })
  }, [])

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
      <QrScanner open={open} onClose={() => setOpen(false)} onResult={onResult} />
    </FormCard>
  )
}
