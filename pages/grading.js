import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import GradingForm, { DraftIcon } from '../components/GradingForm'
import { Check } from 'lucide-react'
import { EmptyState, GhostButton, GradientButton } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission'
import { useLocale, useT } from '../lib/i18n/context'

const FORM_ID = 'grading-form'
const CARD = 'flex min-w-0 flex-col rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]'

/** "Nov 11": month and day of a business date. */
function shortDate(iso, locale) {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)
}

/** Paper 52 Recent gradings: source → destinations, fish, size spread and classes. */
function RecentGradings() {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const rows = useQuery(api.grading.recent, user ? {} : 'skip')
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
      {rows === undefined ? (
        <p className="border-t border-line py-3 text-[14px] leading-[18px] text-muted">{t('ui.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="border-t border-line py-3 text-[14px] leading-[18px] text-muted">{t('gradingPage.recent.empty')}</p>
      ) : (
        <ul>
          {rows.map((r) => {
            const title = `${r.source_name ?? '?'} → ${r.destinations.join(', ')}`
            const meta = [shortDate(r.date, locale), t('gradingPage.recent.fish', { n: r.fish })]
            if (r.cv_before_pct != null && r.cv_after_pct != null) {
              meta.push(
                t('gradingPage.recent.cv', { before: Math.round(r.cv_before_pct), after: Math.round(r.cv_after_pct) }),
              )
            }
            return (
              <li key={r.id} className="border-t border-line">
                <Link
                  href={r.batch_id ? `/batches/${r.batch_id}` : '/batches'}
                  className="flex items-center justify-between gap-3 rounded py-3 hover:bg-surface-2/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                >
                  <div className="flex min-w-0 flex-col gap-[2px]">
                    <span className="truncate text-[14px] leading-[18px] text-text">{title}</span>
                    <span className="text-xs leading-4 text-muted tabular-nums">{meta.join(' · ')}</span>
                  </div>
                  <span className="shrink-0 text-[13px] leading-4 text-text">
                    {t('gradingPage.recent.classes', { count: r.classes })}
                  </span>
                </Link>
              </li>
            )
          })}
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

  if (!router.isReady) return null
  if (canGrade) return <GradingForm key={cage} initialCageId={cage} formId={FORM_ID} aside={<RecentGradings />} />
  return (
    <div className="flex flex-col items-start gap-5 xl:flex-row">
      <div className="flex w-full min-w-0 flex-col gap-5 xl:w-[700px] xl:shrink-0">
        <div className={CARD}>
          <EmptyState title={t('gradingPage.adminsOnly')} description={t('gradingPage.adminsOnlyHint')} />
        </div>
      </div>
      <div className="flex w-full min-w-0 flex-col gap-5 xl:grow xl:basis-0">
        <RecentGradings />
      </div>
    </div>
  )
}

/** Paper 52 header actions: Save draft and Confirm grading submit the grading form. */
function GradingActions() {
  const t = useT()
  const canGrade = usePermission('production.transfer.approve')
  if (!canGrade) return null
  return (
    <>
      <GhostButton type="submit" form={FORM_ID} name="intent" value="draft" icon={DraftIcon} size="xl" className="max-sm:hidden">
        {t('gradingPage.saveDraft')}
      </GhostButton>
      <GradientButton type="submit" form={FORM_ID} name="intent" value="confirm" variant="lime" icon={Check} className="max-sm:hidden">
        {t('gradingPage.confirm')}
      </GradientButton>
    </>
  )
}

export default function GradingPage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout title={t('gradingPage.title')} eyebrow={t('gradingPage.eyebrow')} actions={<GradingActions />}>
        <GradingContent />
      </Layout>
    </ProtectedRoute>
  )
}
