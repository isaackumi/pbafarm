import { useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, FormPage, LoadingState } from '../components/ui'
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
    <Layout title={t('biweekly.pageTitle')}>
      <FormPage width="full">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: t('entry.dashboard'), href: '/dashboard' },
            { label: t('biweekly.crumbRecords'), href: '/biweekly-records' },
            { label: t('biweekly.crumbEntry') },
          ]}
          description={
            detailed
              ? t('biweekly.descDetailed')
              : t('biweekly.descBatch')
          }
          related={[
            { label: t('biweekly.relatedAll'), href: '/biweekly-records' },
            { label: t('biweekly.relatedDaily'), href: '/daily-entry' },
            { label: t('biweekly.relatedHarvest'), href: '/harvest-sampling' },
          ]}
          actions={
            detailed ? (
              <Button variant="secondary" size="sm" href="/biweekly-entry">
                {t('biweekly.backToSampling')}
              </Button>
            ) : (
              <Button href="/biweekly-records" variant="secondary" size="sm">
                {t('biweekly.viewRecords')}
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
