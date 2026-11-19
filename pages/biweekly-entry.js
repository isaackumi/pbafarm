import { useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { ArrowLeft, List } from 'lucide-react'
import { GradientButton, LoadingState } from '../components/ui'
import BiweeklyEntryForm from '../components/BiweeklyEntryForm'
import BiweeklyBatchEntry from '../components/BiweeklyBatchEntry'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { useT } from '../lib/i18n/context'

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
  const t = useT()
  const detailed = router.query.mode === 'detailed'
  const cageId = typeof router.query.cage === 'string' ? router.query.cage : null

  return (
    <Layout
      title={t('biweekly.pageTitle')}
      eyebrow={t('biweekly.eyebrow')}
      actions={
        detailed ? (
          <GradientButton reverse icon={ArrowLeft} href="/biweekly-entry">
            {t('biweekly.backToSampling')}
          </GradientButton>
        ) : (
          <GradientButton reverse icon={List} href="/biweekly-records">
            {t('biweekly.viewRecords')}
          </GradientButton>
        )
      }
    >
      <div className="flex w-full flex-col gap-4">
        <p className="max-w-2xl text-sm text-muted">
          {detailed ? t('biweekly.descDetailed') : t('biweekly.descBatch')}
        </p>
        {detailed && cageId ? (
          <DetailedEntry cageId={cageId} onDone={() => router.push('/biweekly-entry')} />
        ) : (
          <BiweeklyBatchEntry />
        )}
      </div>
    </Layout>
  )
}

function DetailedEntry({ cageId, onDone }) {
  const t = useT()
  const { locationArgs } = useLocation()
  const cages = useQuery(api.cages.list, locationArgs)

  if (cages === undefined) {
    return <LoadingState />
  }
  const cage = cages.find((c) => (c.id || c._id) === cageId)
  if (!cage) {
    return <p className="text-sm text-muted">{t('biweekly.cageNotFound')}</p>
  }
  return <BiweeklyEntryForm cage={cage} onComplete={onDone} />
}
