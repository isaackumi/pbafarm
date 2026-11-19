import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { GhostButton, GradientButton, Pill } from './ui'
import MovementStatus from './MovementStatus'
import { useT } from '../lib/i18n/context'

function Side({ label, value, sub, subTone = 'text-pearl-cyan' }) {
  return (
    <div className="min-w-0 flex-1 rounded-[16px] border border-line bg-bg px-5 py-5 sm:px-[26px]">
      <p className="truncate text-[13px] leading-4 text-muted">{label}</p>
      <p className="mt-2.5 truncate text-[26px] font-medium leading-8 tracking-[-0.01em] text-text tabular-nums">{value}</p>
      {sub ? <p className={`mt-2 truncate text-[15px] leading-5 tabular-nums ${subTone}`}>{sub}</p> : null}
    </div>
  )
}

/**
 * Request detail panel (Paper 25 Approvals): kind pill + meta, a large title,
 * From → To boxes, a fact list, and the approve / reject footer. The note is
 * required to reject, optional otherwise.
 */
export default function MovementDetailPanel({
  kind,
  kindTone = 'pink',
  meta,
  title,
  status,
  from,
  to,
  facts = [],
  notice,
  canModerate = false,
  processing = false,
  approveLabel,
  onApprove,
  onReject,
}) {
  const t = useT()
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const reject = () => {
    if (!note.trim()) {
      setNoteError(t('stocking.detail.reasonRequired'))
      return
    }
    setNoteError('')
    onReject(note.trim())
  }
  return (
    <section className="flex flex-col gap-7 rounded-card border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone={kindTone}>{kind}</Pill>
          {meta ? <span className="text-sm text-muted">{meta}</span> : null}
          {status ? (
            <span className="ml-auto">
              <MovementStatus status={status} />
            </span>
          ) : null}
        </div>
        <h2 className="text-[26px] font-semibold leading-8 tracking-[-0.01em] text-text">{title}</h2>
      </header>

      {from && to ? (
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Side {...from} />
          <ArrowRight className="mx-auto size-5 shrink-0 rotate-90 text-faint sm:rotate-0" aria-hidden />
          <span className="sr-only">{t('stocking.to')}</span>
          <Side {...to} />
        </div>
      ) : null}

      {facts.length > 0 && (
        <dl className="flex flex-col border-t border-line">
          {facts.map((f) => (
            <div
              key={f.label}
              className="flex flex-col gap-1 border-b border-line py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            >
              <dt className="text-sm text-muted">{f.label}</dt>
              <dd className={`text-[15px] leading-5 text-text sm:text-right ${f.wrap ? 'whitespace-pre-wrap' : ''}`}>
                {f.value ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {notice}

      {canModerate && (
        <>
          <div className="flex flex-col gap-2.5">
            <label htmlFor="detail-note" className="text-[15px] text-muted">
              {t('stocking.detail.note')}
            </label>
            <textarea
              id="detail-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('stocking.detail.notePlaceholder')}
              aria-invalid={noteError ? true : undefined}
              aria-describedby={noteError ? 'detail-note-error' : undefined}
              className="w-full resize-y rounded-input border border-line-strong bg-bg px-5 py-4 text-base text-text placeholder:text-faint focus:border-pearl-cyan focus:outline-none focus:ring-2 focus:ring-cyan/30 aria-[invalid=true]:border-alert sm:text-[15px]"
            />
            {noteError ? (
              <p id="detail-note-error" role="alert" className="text-sm text-alert">
                {noteError}
              </p>
            ) : null}
          </div>
          <footer className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] leading-[18px] text-faint">{t('stocking.detail.auditHint')}</p>
            <div className="flex flex-wrap gap-3">
              <GhostButton size="lg" disabled={processing} onClick={reject}>
                {t('stocking.reject')}
              </GhostButton>
              <GradientButton variant="solid" disabled={processing} onClick={onApprove}>
                {processing ? t('stocking.detail.working') : approveLabel}
              </GradientButton>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}
