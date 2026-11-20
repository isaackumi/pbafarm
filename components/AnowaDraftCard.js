import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation } from 'convex/react'
import { Ban, Loader2, ShieldCheck } from 'lucide-react'
import { api } from '../lib/convexBridge'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { useCurrency } from '../hooks/useCurrency'
import { useLocale, useT } from '../lib/i18n/context'
import { errorMessage } from '../lib/errorMessage'
import {
  cardState,
  editHref,
  fishAfter,
  hoursLeft,
  itemKind,
  orderBar,
  rowNumber,
  splitItems,
  undoMinutesLeft,
} from '../lib/anowaDraftCard'

/**
 * Ask Anowa's draft card (Paper artboard 48 "Does it for you"): the changes
 * the assistant prepared, numbered, with before/after numbers, the "why this
 * amount" bar for a feed order, and Cancel / Edit / Confirm. Items the
 * member's role may not do are greyed with the reason and left out of
 * Confirm. After Confirm: saved, with Undo for 10 minutes.
 *
 * Everything shown comes from the typed draft items (convex/anowa/drafts.get),
 * read live, so a role change or expiry shows at once.
 */

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [active])
  return now
}

export default function DraftCard({ draftGroup }) {
  const t = useT()
  const card = useOptionalQuery(api.anowa.drafts.get, draftGroup ? { draftGroup } : 'skip', null)
  const confirm = useMutation(api.anowa.drafts.confirm)
  const cancel = useMutation(api.anowa.drafts.cancel)
  const undo = useMutation(api.anowa.drafts.undo)
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [skipped, setSkipped] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const editRef = useRef(null)

  const state = card === undefined ? 'loading' : cardState(card, Date.now())
  const now = useNow(state === 'pending' || state === 'saved')

  useEffect(() => {
    if (!editOpen) return undefined
    const close = (e) => {
      if (editRef.current && !editRef.current.contains(e.target)) setEditOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [editOpen])

  if (state === 'loading') {
    return (
      <p className="mt-4 flex items-center gap-2 text-sm text-muted" role="status">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        {t('askAnowa.draft.loading')}
      </p>
    )
  }
  if (state === 'missing') return <p className="mt-4 text-sm text-muted">{t('askAnowa.draft.missing')}</p>

  const run = async (fn) => {
    setBusy(true)
    setNote('')
    try {
      await fn()
    } catch (err) {
      setNote(t('askAnowa.draft.failed', { message: errorMessage(err) }))
    } finally {
      setBusy(false)
    }
  }

  const { allowed, refused } = splitItems(card)
  const items = state === 'pending' ? card.items.filter((i) => i.status === 'pending') : card.items
  const total = items.length
  const savedCount = card.items.filter((i) => i.status === 'committed').length
  const minutes = undoMinutesLeft(card.undoUntil, now)

  const onConfirm = () =>
    run(async () => {
      const r = await confirm({ draftGroup })
      if (r.status === 'saved') setSkipped(r.skipped)
      else if (r.status === 'nothing_allowed') setNote(t('askAnowa.draft.nothingAllowed'))
      else if (r.status === 'already') setNote(t('askAnowa.draft.already'))
    })
  const onUndo = () =>
    run(async () => {
      const r = await undo({ draftGroup })
      if (r.status === 'too_late') setNote(t('askAnowa.draft.tooLate'))
    })
  const onEdit = (item) =>
    run(async () => {
      // Edit hands the values to the normal form; the draft closes, like the chat bot's Edit.
      await cancel({ draftGroup })
      await router.push(editHref(item))
    })

  const dot = state === 'pending' ? 'bg-warn' : state === 'saved' ? 'bg-good' : 'bg-faint'
  const header =
    state === 'pending'
      ? t('askAnowa.draft.header', { count: total })
      : state === 'saved'
        ? t('askAnowa.draft.savedHeader', { count: savedCount })
        : t(`askAnowa.draft.${state}Header`)

  const confirmLabel =
    allowed.length === 2 && total === 2
      ? t('askAnowa.draft.confirmBoth')
      : allowed.length > 1
        ? t('askAnowa.draft.confirmN', { count: allowed.length })
        : t('askAnowa.draft.confirm')
  const roleText = !allowed.length
    ? t('askAnowa.draft.role.none')
    : refused.length
      ? t('askAnowa.draft.role.some', { allowed: allowed.length, count: total })
      : total === 2
        ? t('askAnowa.draft.role.both')
        : t('askAnowa.draft.role.all', { count: total })

  const editable = items.filter((i) => i.status === 'pending' && !i.problem)

  return (
    <section
      aria-label={t('askAnowa.draft.label')}
      className="mt-4 flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface text-left"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-[14px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-[7px] shrink-0 rounded-pill ${dot}`} aria-hidden />
          <span className="truncate font-geist text-xs uppercase leading-4 tracking-wide text-muted">{header}</span>
        </div>
        {state === 'pending' && (
          <span className="shrink-0 text-xs leading-4 text-faint">{t('askAnowa.draft.expires', { count: hoursLeft(card.expiresAt, now) })}</span>
        )}
      </header>

      <ol className="flex flex-col">
        {items.map((item, i) => (
          <DraftRow key={item.id} item={item} index={i} muted={!!item.problem || (state !== 'pending' && item.status !== 'committed')} />
        ))}
      </ol>

      <footer className="flex flex-col gap-3 bg-surface-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2 text-sm leading-[18px] text-muted" role={note ? 'status' : undefined}>
          {state === 'pending' && !note && (
            <>
              <ShieldCheck size={16} className={`mt-px shrink-0 ${allowed.length ? 'text-good' : 'text-faint'}`} aria-hidden />
              <span>
                {roleText} · {t('askAnowa.draft.role.loggedAs')} <span className="text-text">{t('askAnowa.draft.role.you')}</span>
              </span>
            </>
          )}
          {state === 'saved' && !note && (
            <span>
              {minutes > 0 ? t('askAnowa.draft.savedNote', { minutes }) : t('askAnowa.draft.savedFinal')}
              {skipped > 0 && ` ${t('askAnowa.draft.skipped', { count: skipped })}`}
            </span>
          )}
          {state === 'undone' && !note && <span>{t('askAnowa.draft.undoneNote')}</span>}
          {state === 'expired' && !note && <span>{t('askAnowa.draft.expiredNote')}</span>}
          {state === 'cancelled' && !note && <span>{t('askAnowa.draft.cancelledNote')}</span>}
          {note && <span className="text-text">{note}</span>}
        </div>

        {state === 'pending' && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => run(() => cancel({ draftGroup }))}
              disabled={busy}
              className={`rounded-pill px-4 py-[10px] text-sm font-medium leading-[18px] text-muted hover:text-text disabled:opacity-50 ${FOCUS}`}
            >
              {t('askAnowa.draft.cancel')}
            </button>
            {editable.length > 0 && (
              <div className="relative" ref={editRef}>
                <button
                  type="button"
                  title={t('askAnowa.draft.editHint')}
                  aria-haspopup={editable.length > 1 ? 'menu' : undefined}
                  aria-expanded={editable.length > 1 ? editOpen : undefined}
                  onClick={() => (editable.length === 1 ? onEdit(editable[0]) : setEditOpen((o) => !o))}
                  disabled={busy}
                  className={`rounded-pill border border-line-strong px-[18px] py-[10px] text-sm font-medium leading-[18px] text-text hover:bg-surface disabled:opacity-50 ${FOCUS}`}
                >
                  {t('askAnowa.draft.edit')}
                </button>
                {editOpen && editable.length > 1 && (
                  <div role="menu" className="absolute bottom-full right-0 z-10 mb-2 flex w-64 flex-col rounded-input border border-line-strong bg-surface p-1 shadow-lg">
                    {editable.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        onClick={() => onEdit(item)}
                        className={`rounded-[10px] px-3 py-2 text-left text-sm text-text hover:bg-surface-2 ${FOCUS}`}
                      >
                        {t('askAnowa.draft.editItem', {
                          n: rowNumber(items.indexOf(item)),
                          title: t(`askAnowa.draft.kinds.${itemKind(item.payload)}.title`),
                        })}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || !allowed.length}
              className={`flex items-center gap-2 rounded-pill bg-lime px-5 py-[10px] text-sm font-semibold leading-[18px] text-ink disabled:opacity-50 ${FOCUS}`}
            >
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {busy ? t('askAnowa.draft.saving') : confirmLabel}
            </button>
          </div>
        )}
        {state === 'saved' && minutes > 0 && (
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className={`shrink-0 self-start rounded-pill border border-line-strong px-[18px] py-[10px] text-sm font-medium leading-[18px] text-text hover:bg-surface disabled:opacity-50 sm:self-auto ${FOCUS}`}
          >
            {t('askAnowa.draft.undo')}
          </button>
        )}
      </footer>
    </section>
  )
}

function Field({ label, children, mono = false }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <span className="text-xs leading-4 text-faint">{label}</span>
      <span className={`text-base leading-5 text-text ${mono ? 'font-geist' : ''}`}>{children}</span>
    </div>
  )
}

function DraftRow({ item, index, muted }) {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const { formatCurrency } = useCurrency()
  const lang = formatLocale || locale || undefined
  const p = item.payload
  const kind = itemKind(p)
  const num = (n, dp = 1) => new Intl.NumberFormat(lang, { maximumFractionDigits: dp }).format(n)
  const kg = (n) => `${num(n)} kg`
  const day = (d) =>
    d ? new Date(`${d}T12:00:00`).toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }) : t('askAnowa.draft.fields.noDue')
  const unitName = p.cageName || ''
  const meta = p.kind === 'project_milestone' || p.kind === 'project_cost'
    ? t(`askAnowa.draft.kinds.${kind}.meta`, { project: p.projectName })
    : p.kind === 'project_create'
      ? p.siteName
        ? t('askAnowa.draft.kinds.projectNew.metaSite', { site: p.siteName })
        : t('askAnowa.draft.kinds.projectNew.meta')
      : kind === 'issue' || kind === 'task'
      ? unitName
        ? t(`askAnowa.draft.kinds.${kind}.metaUnit`, { unit: unitName })
        : t(`askAnowa.draft.kinds.${kind}.meta`)
      : t(`askAnowa.draft.kinds.${kind}.meta`, { unit: unitName })

  let fields = null
  if (p.kind === 'daily_entry') {
    const fish = fishAfter(p)
    fields = (
      <>
        {p.feedKg > 0 && (
          <Field label={t('askAnowa.draft.fields.feedGiven')} mono>
            {kg(p.feedKg)}
            {p.feedTypeName && <span className="font-sans text-faint"> · {p.feedTypeName}</span>}
          </Field>
        )}
        {(p.mortality > 0 || !p.feedKg) && (
          <Field label={t('askAnowa.draft.fields.dead')} mono>
            {num(p.mortality, 0)}
          </Field>
        )}
        <Field label={t('askAnowa.draft.fields.date')}>{day(item.date)}</Field>
        {fish && p.mortality > 0 && (
          <Field label={t('askAnowa.draft.fields.fishAfter')} mono>
            {num(fish.after, 0)} <span className="text-faint">{t('askAnowa.draft.fields.from', { count: fish.before })}</span>
          </Field>
        )}
      </>
    )
  } else if (p.kind === 'feed_issue') {
    fields = (
      <>
        <Field label={t('askAnowa.draft.fields.feed')}>{p.feedTypeName}</Field>
        <Field label={t('askAnowa.draft.fields.quantity')} mono>
          {kg(p.quantityKg)}
        </Field>
        <Field label={t('askAnowa.draft.fields.date')}>{day(item.date)}</Field>
      </>
    )
  } else if (p.kind === 'purchase_order') {
    fields = (
      <>
        <Field label={t('askAnowa.draft.fields.feed')}>{p.feedTypeName}</Field>
        <Field label={t('askAnowa.draft.fields.quantity')} mono>
          {kg(p.quantityKg)} <span className="text-faint">· {t('askAnowa.draft.fields.bags', { count: p.bags })}</span>
        </Field>
        <Field label={t('askAnowa.draft.fields.supplier')}>{p.supplierName}</Field>
        {p.pricePerKg > 0 && (
          <Field label={t('askAnowa.draft.fields.cost')} mono>
            {formatCurrency(p.quantityKg * p.pricePerKg, { maximumFractionDigits: 0 })}
          </Field>
        )}
      </>
    )
  } else if (p.kind === 'project_create') {
    fields = (
      <>
        <Field label={t('askAnowa.draft.fields.project')}>{p.name}</Field>
        <Field label={t('askAnowa.draft.fields.budget')} mono>
          {formatCurrency(p.budget, { maximumFractionDigits: 0 })}
        </Field>
        <Field label={t('askAnowa.draft.fields.dates')}>
          {day(p.startDate)} - {day(p.targetEndDate)}
        </Field>
        <Field label={t('askAnowa.draft.fields.owner')}>{p.ownerName}</Field>
      </>
    )
  } else if (p.kind === 'project_milestone') {
    fields = (
      <>
        <Field label={t('askAnowa.draft.fields.milestone')}>{p.title}</Field>
        <Field label={t('askAnowa.draft.fields.due')}>{day(p.dueDate)}</Field>
        {p.progressPct > 0 && (
          <Field label={t('askAnowa.draft.fields.progress')} mono>
            {num(p.progressPct, 0)}%
          </Field>
        )}
      </>
    )
  } else if (p.kind === 'project_cost') {
    const after = p.spentBefore + p.amount
    fields = (
      <>
        <Field label={t('askAnowa.draft.fields.amount')} mono>
          {formatCurrency(p.amount, { maximumFractionDigits: 0 })}
        </Field>
        <Field label={t('askAnowa.draft.fields.date')}>{day(item.date)}</Field>
        <Field label={t('askAnowa.draft.fields.spentAfter')} mono>
          {formatCurrency(after, { maximumFractionDigits: 0 })}
          {p.budget > 0 && (
            <span className={`font-sans ${after > p.budget ? 'text-alert' : 'text-faint'}`}>
              {' '}
              {t('askAnowa.draft.fields.ofBudget', { pct: Math.round((after / p.budget) * 100) })}
            </span>
          )}
        </Field>
        {p.note && <Field label={t('askAnowa.draft.fields.note')}>{p.note}</Field>}
      </>
    )
  } else {
    fields = (
      <>
        <Field label={t('askAnowa.draft.fields.task')}>{p.title}</Field>
        <Field label={t('askAnowa.draft.fields.assignee')}>{p.assigneeName}</Field>
        <Field label={t('askAnowa.draft.fields.due')}>{day(p.dueDate)}</Field>
      </>
    )
  }

  const bar = p.kind === 'purchase_order' ? orderBar(p) : null
  return (
    <li className={`flex gap-4 border-b border-line p-5 ${muted ? 'opacity-60' : ''}`}>
      <span className="w-[22px] shrink-0 font-geist text-sm leading-[22px] text-faint" aria-hidden>
        {rowNumber(index)}
      </span>
      <div className="flex min-w-0 grow flex-col gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <h3 className="text-base font-semibold leading-[22px] text-text">{t(`askAnowa.draft.kinds.${kind}.title`)}</h3>
          <span className="text-sm leading-4 text-muted">{meta}</span>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">{fields}</div>
        {bar && (
          <div className="flex flex-col gap-2 pt-1" aria-label={t('askAnowa.draft.bar.label')} role="group">
            <div className="flex h-2 shrink-0 gap-[2px] overflow-hidden rounded-pill" aria-hidden>
              {bar.stockPct > 0 && <div className="bg-muted" style={{ width: `${bar.stockPct}%` }} />}
              <div className="grow bg-lime" />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm leading-4 text-muted">
              <span>{renderKg(t('askAnowa.draft.bar.onHand', { kg: '\u0000' }), kg(p.stockKg))}</span>
              <span>{renderKg(t('askAnowa.draft.bar.needed', { kg: '\u0000', days: p.days, count: p.units }), kg(p.needKg))}</span>
              <span>{renderKg(t('askAnowa.draft.bar.toOrder', { kg: '\u0000' }), kg(p.quantityKg), 'font-semibold text-good dark:text-lime')}</span>
            </div>
          </div>
        )}
        {item.problem && (
          <p className="flex items-start gap-2 text-sm leading-[18px] text-muted">
            <Ban size={14} className="mt-[2px] shrink-0" aria-hidden />
            {t('askAnowa.draft.notAllowed', { reason: item.problem })}
          </p>
        )}
      </div>
    </li>
  )
}

/** Put a mono-styled figure where the translation has its {kg} placeholder. */
function renderKg(text, figure, cls = 'text-text') {
  const [before, after = ''] = text.split('\u0000')
  return (
    <>
      {before}
      <span className={`font-geist ${cls}`}>{figure}</span>
      {after}
    </>
  )
}
