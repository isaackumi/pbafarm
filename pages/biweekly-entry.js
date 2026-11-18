import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, FormPage } from '../components/ui'
import BiweeklyEntryForm from '../components/BiweeklyEntryForm'
import BiweeklyBatchEntry from '../components/BiweeklyBatchEntry'
import { cageService } from '../lib/databaseService'

export default function BiweeklyEntryPage() {
  return (
    <ProtectedRoute>
      <BiweeklyEntry />
    </ProtectedRoute>
  )
}

/**
 * Default: sampling for many cages at once (MOBILE-005), honouring `?cage=`.
 * `?mode=detailed&cage=<id>` opens the single-cage form with several samples.
 */
function BiweeklyEntry() {
  const router = useRouter()
  const detailed = router.query.mode === 'detailed'
  const cageId = typeof router.query.cage === 'string' ? router.query.cage : null

  return (
    <Layout title="Bi-weekly entry">
      <FormPage width="full">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Bi-weekly records', href: '/biweekly-records' },
            { label: 'Entry' },
          ]}
          description={
            detailed
              ? 'Several samples for one cage.'
              : 'Sampling for one or many cages, saved together.'
          }
          related={[
            { label: 'All records', href: '/biweekly-records' },
            { label: 'Daily entry', href: '/daily-entry' },
            { label: 'Harvest sampling', href: '/harvest-sampling' },
          ]}
          actions={
            detailed ? (
              <Button variant="secondary" size="sm" href="/biweekly-entry">
                Back to sampling
              </Button>
            ) : (
              <Button href="/biweekly-records" variant="secondary" size="sm">
                View records
              </Button>
            )
          }
        />
        {detailed && cageId ? (
          <DetailedEntry cageId={cageId} onDone={() => router.push('/biweekly-entry')} />
        ) : (
          <BiweeklyBatchEntry />
        )}
      </FormPage>
    </Layout>
  )
}

function DetailedEntry({ cageId, onDone }) {
  const [cage, setCage] = useState(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    cageService.getAllCages().then(({ data }) => {
      if (!live) return
      const found = (data || []).find((c) => (c.id || c._id) === cageId)
      if (found) setCage(found)
      else setMissing(true)
    })
    return () => {
      live = false
    }
  }, [cageId])

  if (missing) {
    return <p className="text-sm text-muted">That cage was not found on this farm.</p>
  }
  if (!cage) {
    return <div className="h-64 rounded-xl bg-foam animate-pulse" />
  }
  return <BiweeklyEntryForm cage={cage} onComplete={onDone} />
}
