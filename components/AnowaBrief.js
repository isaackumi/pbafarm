import Link from 'next/link'
import { AnowaPulseIcon } from './brand/AnowaPulseIcon'
import { useT } from '../lib/i18n/context'
import { usePermission } from '../hooks/usePermission'

/**
 * Anowa's brief at the top of a page: one sentence on what needs someone,
 * built from the page's own records (never from a model), and a link that
 * opens Ask Anowa with a follow-up question in the composer.
 *
 * `lead` is the bold opening ("2 projects need you"); `items` are short
 * clauses joined with semicolons; `calm` is shown when nothing needs anyone.
 */
export default function AnowaBrief({ lead, items = [], calm, question, loading = false }) {
  const t = useT()
  const canAsk = usePermission('ai.use')
  return (
    <section
      aria-label={t('askAnowa.brief.label')}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:gap-4"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-surface-2 text-text" aria-hidden>
        <AnowaPulseIcon size={16} />
      </span>
      <p className="min-w-0 grow text-[14px] leading-5 text-muted" aria-live="polite">
        <span className="mr-2 text-xs font-medium uppercase tracking-[0.06em] text-faint">{t('askAnowa.brief.from')}</span>
        {loading ? (
          <span>{t('askAnowa.brief.loading')}</span>
        ) : items.length ? (
          <>
            <span className="font-semibold text-text">{lead}:</span> {items.join('; ')}.
          </>
        ) : (
          <span>{calm}</span>
        )}
      </p>
      {canAsk && question && (
        <Link
          href={`/assistant?q=${encodeURIComponent(question)}`}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-pill border border-line-strong px-[18px] py-[9px] text-[13px] leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:self-auto"
        >
          <AnowaPulseIcon size={14} />
          {t('askAnowa.brief.ask')}
        </Link>
      )}
    </section>
  )
}
