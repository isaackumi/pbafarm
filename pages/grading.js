import { useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import GradingForm from '../components/GradingForm'
import { ArrowLeftRight, Check } from 'lucide-react'
import { EmptyState, GhostButton, GradientButton } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'
import { formatDate } from '../lib/format'
import { useLocale, useT } from '../lib/i18n/context'

const FORM_ID = 'grading-form'
const CARD = 'flex min-w-0 flex-col rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]'

/** Batches made by grading, grouped by the day they were graded, newest first. */
function gradingGroups(batches, limit = 5) {
  const byDay = new Map()
  for (const b of batches || []) {
    if (b.origin !== 'grading_split') continue
    const list = byDay.get(b.opened_on) || []
    list.push(b)
    byDay.set(b.opened_on, list)
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, limit)
    .map(([date, list]) => ({ date, batches: list }))
}

function RecentGradings() {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const batches = useQuery(api.batches.list, user ? {} : 'skip')
  const groups = useMemo(() => gradingGroups(batches), [batches])
  return (
    <section className={`${CARD} gap-1`} aria-labelledby="recent-gradings">
      <div className="flex items-center justify-between pb-3">
        <h2 id="recent-gradings" className="text-[15px] font-semibold leading-[18px] text-text">
          {t('gradingPage.recent.title')}
        </h2>
        <Link
          href="/batches"
          className="rounded text-[13px] leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {t('gradingPage.recent.all')}
        </Link>
      </div>
      {batches === undefined ? (
        <p className="border-t border-line py-3 text-[14px] leading-[18px] text-muted">{t('ui.loading')}</p>
      ) : groups.length === 0 ? (
        <p className="border-t border-line py-3 text-[14px] leading-[18px] text-muted">{t('gradingPage.recent.empty')}</p>
      ) : (
        <ul>
          {groups.map((g) => (
            <li key={g.date} className="flex items-center justify-between gap-3 border-t border-line py-3">
              <div className="flex min-w-0 flex-col gap-[2px]">
                <div className="flex flex-wrap gap-x-2 text-[14px] leading-[18px] text-text">
                  {g.batches.map((b, i) => (
                    <Link
                      key={b.id}
                      href={`/batches/${b.id}`}
                      className="rounded hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                    >
                      {b.batch_number}
                      {i < g.batches.length - 1 ? ',' : ''}
                    </Link>
                  ))}
                </div>
                <div className="text-xs leading-4 text-muted">
                  {formatDate(g.date, { locale })}
                  {g.batches[0].species ? ` · ${g.batches[0].species}` : ''}
                </div>
              </div>
              <div className="shrink-0 text-[13px] leading-4 text-text">
                {t('gradingPage.recent.batches', { count: g.batches.length })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function GradingContent() {
  const t = useT()
  const router = useRouter()
  const cage = typeof router.query.cage === 'string' ? router.query.cage : ''
  const canGrade = usePermission('production.transfer.approve')

  const aside = (
    <div className="flex w-full min-w-0 flex-col gap-5 xl:grow xl:basis-0">
      <section className={`${CARD} gap-2`}>
        <h2 className="text-[15px] font-semibold leading-[18px] text-text">{t('gradingPage.how.title')}</h2>
        <p className="text-[13px] leading-[18px] text-muted">{t('gradingPage.how.body')}</p>
      </section>
      <RecentGradings />
    </div>
  )

  if (!router.isReady) return null
  if (canGrade) return <GradingForm key={cage} initialCageId={cage} formId={FORM_ID} aside={aside} />
  return (
    <div className="flex flex-col items-start gap-5 xl:flex-row">
      <div className="flex w-full min-w-0 flex-col gap-5 xl:w-[700px] xl:shrink-0">
        <div className={CARD}>
          <EmptyState title={t('gradingPage.adminsOnly')} description={t('gradingPage.adminsOnlyHint')} />
        </div>
      </div>
      {aside}
    </div>
  )
}

function GradingActions() {
  const t = useT()
  const canGrade = usePermission('production.transfer.approve')
  return (
    <>
      <GhostButton href="/fish-transfers" icon={ArrowLeftRight} size="lg" className="!h-[45px] !gap-2.5 !px-[22px] !text-[15px] font-medium !leading-[18px]">
        {t('gradingPage.transfers')}
      </GhostButton>
      {canGrade && (
        <GradientButton type="submit" form={FORM_ID} variant="solid" icon={Check} className="max-sm:hidden">
          Confirm grading
        </GradientButton>
      )}
    </>
  )
}

export default function GradingPage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout
        title={t('gradingPage.title')}
        eyebrow={t('gradingPage.eyebrow')}
        actions={<GradingActions />}
      >
        <GradingContent />
      </Layout>
    </ProtectedRoute>
  )
}
