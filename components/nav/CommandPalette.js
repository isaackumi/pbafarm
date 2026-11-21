import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useDialogA11y } from '../../hooks/useDialogA11y'
import { useOptionalQuery } from '../../hooks/useOptionalQuery'
import { usePermissions } from '../../hooks/usePermission'
import { useTerm } from '../../hooks/useTerm'
import { navKey } from '../../lib/i18n'
import { useT } from '../../lib/i18n/context'
import { addDays, formatDate, formatNumber, localToday } from '../../lib/format'
import {
  actionHref,
  actionQuery,
  askHref,
  matchActions,
  matchPages,
  moveIndex,
  pageItem,
  placeOf,
  waterHistoryHref,
} from '../../lib/commandPalette'
import { AnowaPulseIcon } from '../brand/AnowaPulseIcon'

// Paper 72a / 72b glyphs (24px grid, 2px round strokes).
const GLYPH = {
  daily: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  feed: 'M12 4v12M6 10l6 6 6-6M5 20h14',
  sampling: 'M4 18h16M6 18V9M12 18V5M18 18v-6',
  stock: 'M12 5v14M5 12h14',
  createCage: 'M12 5v14M5 12h14',
  water: 'M3 12h4l3-8 4 16 3-8h4',
  transfer: 'M4 8h14l-4-4M20 16H6l4 4',
  import: 'M12 16V4M6 10l6-6 6 6M5 20h14',
}

function Glyph({ name, size = 14 }) {
  if (name === 'ask') return <AnowaPulseIcon size={16} strokeWidth={2} aria-hidden />
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path d={GLYPH[name]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const KBD = 'inline-block shrink-0 rounded-[6px] border border-line-strong px-[7px] py-[3px] font-sans text-[11px] leading-[14px] text-muted'
const SECTION_LABEL = 'px-3 pb-2 text-[11px] uppercase leading-[14px] tracking-[0.06em] text-faint'
const ICON_BOX = 'flex size-7 shrink-0 items-center justify-center rounded-[8px]'

/** "42.6 t" from kilograms. */
const tonnes = (kg) => formatNumber(kg / 1000, { decimals: 1 })

/**
 * The top-bar search (Paper 72a / 72b): ⌘K / Ctrl+K or a click opens it.
 * Empty: quick actions with live hints, then recently opened cages, batches
 * and pages. Typed: cages (with inline actions), batches & lots, people,
 * pages and actions, then "Do it for <cage>" and Ask Anowa. ↑↓ move, ↵
 * opens, Tab reaches the inline actions, ⌘↵ asks Anowa, Esc closes.
 */
export default function CommandPalette({ open, onClose }) {
  if (!open) return null
  return <Palette onClose={onClose} />
}

function Palette({ onClose }) {
  const router = useRouter()
  const t = useT()
  const term = useTerm()
  const { canUseApp } = useAuth()
  const { can } = usePermissions()
  const { locationArgs } = useLocation()
  const panelRef = useDialogA11y({ open: true, onClose })
  const listId = useId()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''))
  }, [])
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 120)
    return () => clearTimeout(id)
  }, [query])

  const trimmed = query.trim()
  const typed = trimmed.length > 0
  const actionMode = actionQuery(query) != null
  const tr = (key, fallback, vars) => term.text(t.or(key, fallback, vars))
  const labelOf = (item) => tr(item.labelKey || navKey(item.path), item.title)
  const actionLabel = (a) => tr(a.labelKey, a.title)

  // Live hints (72a): each is hidden when its data can't load or isn't the member's.
  const today = useMemo(() => localToday(), [])
  const hints = useOptionalQuery(api.navSearch.quickHints, canUseApp && !typed ? { date: today } : 'skip')
  const coverArgs = useMemo(() => ({ from: addDays(today, -29), to: today, ...(locationArgs || {}) }), [today, locationArgs])
  const cover = useOptionalQuery(
    api.inventory.coverSummary,
    canUseApp && !typed && can('inventory.view') ? coverArgs : 'skip',
  )
  const recents = useOptionalQuery(api.navSearch.recents, canUseApp && !typed ? { date: today } : 'skip', [])
  const searchText = debounced.trim()
  const found = useOptionalQuery(
    api.navSearch.palette,
    canUseApp && searchText && actionQuery(debounced) == null ? { q: searchText, date: today } : 'skip',
  )

  const go = (href) => {
    if (!href) return
    onClose()
    router.push(href)
  }

  const cageTitle = (cage) => term.text(t('navSearch.cageName', { name: cage.name }))
  const cageFacts = (cage) =>
    [cage.species, cage.dayOfCycle != null ? t('navSearch.dayOfCycle', { day: cage.dayOfCycle }) : null]
      .filter(Boolean)
      .join(' · ')

  // ---- Options, grouped in sections (one flat index for ↑↓) --------------
  const sections = []
  const firstCage = typed && !actionMode ? found?.cages?.[0] ?? null : null

  if (!typed) {
    const quick = []
    if (can('production.daily.record')) {
      quick.push({
        id: 'q-daily', type: 'quick', icon: 'daily', label: tr('navSearch.action.daily', 'Log daily entry'), href: actionHref('daily'),
        hint: hints?.notLoggedToday != null ? t('navSearch.hint.notLogged', { count: hints.notLoggedToday }) : null,
      })
    }
    if (can('inventory.issue')) {
      quick.push({
        id: 'q-feed', type: 'quick', icon: 'feed', label: tr('navSearch.action.feed', 'Issue feed'), href: actionHref('feed'),
        hint: cover && Number.isFinite(cover.stock_kg) ? t('navSearch.hint.inStore', { tonnes: tonnes(cover.stock_kg) }) : null,
      })
    }
    if (can('production.sampling.record')) {
      quick.push({
        id: 'q-sampling', type: 'quick', icon: 'sampling', label: tr('navSearch.action.sampling', 'Record sampling'), href: actionHref('sampling'),
        hint: hints?.samplingDue != null ? t('navSearch.hint.due', { count: hints.samplingDue }) : null,
        hintTone: 'warn',
      })
    }
    if (can('production.stocking.request')) {
      quick.push({ id: 'q-stock', type: 'quick', icon: 'stock', label: tr('navSearch.action.stock', 'Stock a new cage'), href: actionHref('stock') })
    }
    if (can('ai.use')) {
      quick.push({ id: 'q-ask', type: 'quick', icon: 'ask', label: t('navSearch.action.ask'), href: askHref(''), hint: t('navSearch.hint.ask') })
    }
    if (quick.length) sections.push({ key: 'quick', label: t('navSearch.section.quick'), variant: 'first', options: quick })

    const recent = (recents || [])
      .map((r) => {
        if (r.kind === 'cage' && r.cage) {
          return {
            id: `r-${r.key}`, type: 'row', dot: r.cage.alert ? 'bg-alert' : 'bg-line-strong',
            name: cageTitle(r.cage), detail: [cageFacts(r.cage), r.cage.sampleText].filter(Boolean).join(' · '),
            right: term.text(t('navSearch.kind.cage')), href: `/cages/${r.cage._id}`,
          }
        }
        if (r.kind === 'batch' && r.batch) {
          return {
            id: `r-${r.key}`, type: 'row', dot: 'bg-sky-ink', mono: true, name: r.batch.code,
            detail: batchDetail(r.batch, { t, term, short: true }), right: t('navSearch.kind.batch'), href: `/batches/${r.batch._id}`,
          }
        }
        const item = r.kind === 'page' ? pageItem(r.key) : null
        if (!item) return null
        return {
          id: `r-${r.key}`, type: 'row', dot: 'bg-line-strong', name: labelOf(item),
          detail: placeOf(item, (k, f) => t.or(k, f)), right: t('navSearch.kind.page'), href: item.path,
        }
      })
      .filter(Boolean)
    if (recent.length) sections.push({ key: 'recent', label: t('navSearch.section.recent'), variant: 'border', options: recent })
  } else if (actionMode) {
    const actions = matchActions(actionQuery(query), { can, labelOf: actionLabel }).map((a) => ({
      id: `a-${a.key}`, type: 'doit', icon: a.key, label: actionLabel(a), href: a.key === 'ask' ? askHref('') : actionHref(a.key),
    }))
    if (actions.length) sections.push({ key: 'actions', label: t('navSearch.section.actions'), variant: 'first', options: actions })
  } else {
    const cages = found?.cages || []
    if (firstCage) {
      sections.push({
        key: 'cage', label: term.text(t('navSearch.section.cage')), variant: 'first',
        options: [{ id: `c-${firstCage._id}`, type: 'cage', cage: firstCage, href: `/cages/${firstCage._id}` }],
      })
    }
    const moreCages = cages.slice(1).map((c) => ({
      id: `c-${c._id}`, type: 'row', dot: c.alert ? 'bg-alert' : 'bg-line-strong', name: cageTitle(c),
      detail: [cageFacts(c), c.location].filter(Boolean).join(' · '), right: term.text(t('navSearch.kind.cage')), href: `/cages/${c._id}`,
    }))
    if (moreCages.length) sections.push({ key: 'cages', label: term.text(t('navSearch.section.cages')), options: moreCages })
    const batchRows = [
      ...(found?.batches || []).map((b) => ({
        id: `b-${b._id}`, type: 'row', dot: 'bg-sky-ink', mono: true, name: b.code,
        detail: batchDetail(b, { t, term }), right: t('navSearch.kind.batch'), href: `/batches/${b._id}`,
      })),
      ...(found?.lots || []).map((l) => ({
        id: `l-${l._id}`, type: 'row', dot: 'bg-lime', mono: true, name: l.code,
        detail: lotDetail(l, { t }), right: t('navSearch.kind.lot'), href: `/trace/${l._id}`,
      })),
    ]
    if (batchRows.length) sections.push({ key: 'batches', label: t('navSearch.section.batches'), options: batchRows })
    const people = (found?.people || []).map((p) => ({
      id: `p-${p.userId}`, type: 'row', dot: 'bg-line-strong', name: p.name, detail: p.detail || '',
      right: t('navSearch.kind.person'), href: `/users?member=${p.userId}`,
    }))
    if (people.length) sections.push({ key: 'people', label: t('navSearch.section.people'), options: people })
    const pages = matchPages(trimmed, { can, labelOf }).map(({ item, label }) => ({
      id: `pg-${item.path}`, type: 'row', dot: 'bg-line-strong', name: label,
      detail: placeOf(item, (k, f) => t.or(k, f)), right: t('navSearch.kind.page'), href: item.path,
    }))
    if (pages.length) sections.push({ key: 'pages', label: t('navSearch.section.pages'), options: pages })
    const actions = matchActions(trimmed, { can, labelOf: actionLabel, limit: 3 })
      .filter((a) => a.key !== 'ask')
      .map((a) => ({ id: `a-${a.key}`, type: 'doit', icon: a.key, label: actionLabel(a), href: actionHref(a.key) }))
    if (actions.length) sections.push({ key: 'actions', label: t('navSearch.section.actions'), options: actions })

    const doIt = []
    if (firstCage) {
      if (can('production.view')) {
        doIt.push({
          id: 'd-water', type: 'doit', icon: 'water', label: term.text(t('navSearch.doIt.water', { name: firstCage.name })),
          right: t.or('nav.paper.health', 'Health & water'), href: waterHistoryHref(firstCage.name),
        })
      }
      if (can('inventory.issue')) {
        doIt.push({
          id: 'd-feed', type: 'doit', icon: 'feed', label: t('navSearch.doIt.feed', { name: firstCage.name }),
          right: t.or('nav.section.feed', 'Feed & inventory'), href: actionHref('feed', firstCage._id),
        })
      }
    }
    if (can('ai.use')) {
      const question = firstCage ? t('navSearch.askAboutCage', { name: firstCage.name }) : trimmed
      doIt.push({ id: 'd-ask', type: 'ask', question, href: askHref(question) })
    }
    if (doIt.length) {
      sections.push({
        key: 'doit',
        label: firstCage ? t('navSearch.section.doIt', { name: firstCage.name }) : null,
        variant: 'border',
        options: doIt,
      })
    }
  }

  const options = sections.flatMap((s) => s.options)
  const askOption = options.find((o) => o.type === 'ask' || o.id === 'q-ask')
  const loadingResults = typed && !actionMode && (found === undefined || searchText !== trimmed)
  const activeIndex = Math.min(active, options.length - 1)
  const activeOption = options[activeIndex]

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    if (!activeOption) return
    document.getElementById(`${listId}-${activeOption.id}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeOption, listId])

  const onKeyDown = (e) => {
    // "Type a question, then Tab" (72a): with no inline actions to reach, Tab
    // from the field picks Ask Anowa.
    if (e.key === 'Tab' && !e.shiftKey && typed && e.target === inputRef.current && !firstCage && askOption) {
      e.preventDefault()
      e.stopPropagation()
      setActive(options.indexOf(askOption))
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => moveIndex(Math.min(i, options.length - 1), e.key === 'ArrowDown' ? 1 : -1, options.length))
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (!can('ai.use')) return
      e.preventDefault()
      go(askOption?.href || askHref(trimmed))
    } else if (e.key === 'Enter' && activeOption) {
      e.preventDefault()
      go(activeOption.href)
    }
  }

  const resultCount = typed && !loadingResults ? options.length : null

  return (
    <div className="fixed inset-0 z-[100] flex justify-center px-4 pt-6 sm:pt-[96px]">
      <div className="absolute inset-0 modal-backdrop" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('navSearch.dialogLabel')}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[calc(100dvh-48px)] w-full max-w-[680px] flex-col self-start overflow-hidden rounded-[20px] border border-line-strong bg-surface shadow-[0_24px_64px_#0000008C] sm:max-h-[calc(100dvh-128px)]"
      >
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line px-5">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className={`shrink-0 ${typed ? 'text-sky-ink' : 'text-faint'}`}>
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            data-autofocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
            aria-label={t('navSearch.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('navSearch.placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 grow border-0 bg-transparent p-0 text-[16px] leading-5 text-text placeholder:text-faint placeholder:opacity-100 focus:shadow-none focus:outline-none focus:ring-0"
            style={{ backgroundColor: 'transparent' }}
          />
          {typed ? (
            resultCount != null && (
              <span className="shrink-0 text-xs leading-4 text-faint" aria-live="polite">
                {t('navSearch.results', { count: resultCount })}
              </span>
            )
          ) : (
            <kbd className={KBD}>Esc</kbd>
          )}
        </div>

        <div id={listId} role="listbox" aria-label={t('navSearch.dialogLabel')} className="min-h-0 overflow-y-auto">
          {sections.map((section, si) => (
            <div
              key={section.key}
              role="group"
              aria-label={section.label || undefined}
              className={`flex flex-col px-2 ${
                section.variant === 'first' ? 'pb-2 pt-3' : section.variant === 'border' ? `border-t border-line pb-2 ${section.label ? 'pt-1' : 'pt-2'}` : 'py-1'
              } ${si === 0 && section.variant !== 'first' ? 'pt-3' : ''}`}
            >
              {section.label && (
                <div className={`${SECTION_LABEL} ${section.variant === 'border' && !typed ? 'pt-1' : section.variant === 'border' ? 'pt-[10px]' : 'pt-1'}`}>
                  {section.label}
                </div>
              )}
              {section.options.map((option) => (
                <Option
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  option={option}
                  active={option === activeOption}
                  onHover={() => setActive(options.indexOf(option))}
                  onRun={() => go(option.href)}
                  go={go}
                  t={t}
                  term={term}
                  cageTitle={cageTitle}
                  cageFacts={cageFacts}
                  can={can}
                  isMac={isMac}
                />
              ))}
            </div>
          ))}
          {typed && !loadingResults && options.length === 0 && (
            <p className="px-5 py-6 text-[14px] leading-[18px] text-muted">{t('navSearch.noResults', { q: trimmed })}</p>
          )}
          {loadingResults && options.length === 0 && (
            <p className="px-5 py-6 text-[14px] leading-[18px] text-muted">{t('common.loading')}</p>
          )}
        </div>

        <div className="flex h-11 shrink-0 items-center gap-4 border-t border-line bg-bg px-5 text-xs leading-4 text-faint">
          <span>
            <span className="text-muted">↑↓</span> {t('navSearch.footer.move')}
          </span>
          <span>
            <span className="text-muted">↵</span> {t('navSearch.footer.open')}
          </span>
          <span className="hidden sm:inline">
            <span className="text-muted">Tab</span> {t('navSearch.footer.actions')}
          </span>
          <span className="grow" />
          <span className="hidden sm:inline">
            {t('navSearch.footer.try')} <span className="text-muted">c-07</span>, <span className="text-muted">{t('navSearch.footer.tryFeed')}</span>,{' '}
            <span className="text-muted">&gt; {t('navSearch.footer.tryAction')}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function batchDetail(b, { t, term }) {
  const parts = []
  if (b.cageName) {
    parts.push(
      <span key="in">
        {term.text(t('navSearch.batchIn'))} <span className="text-text">{b.cageName}</span>
      </span>,
    )
  }
  if (b.fishCount != null) parts.push(t('navSearch.fish', { count: b.fishCount, n: formatNumber(b.fishCount) }))
  if (b.abwG != null) parts.push(t('navSearch.abw', { g: formatNumber(b.abwG) }))
  return joinDot(parts)
}

function lotDetail(l, { t }) {
  const parts = []
  parts.push(
    l.cageName ? (
      <span key="from">
        {t('navSearch.lotFrom')} <span className="text-text">{l.cageName}</span>
      </span>
    ) : (
      t('navSearch.lot')
    ),
  )
  if (l.weightKg != null) parts.push(`${tonnes(l.weightKg)} t`)
  if (l.date) parts.push(formatDate(l.date))
  return joinDot(parts)
}

function joinDot(parts) {
  return parts.flatMap((p, i) => (i === 0 ? [p] : [' · ', p])).map((p, i) => (typeof p === 'string' ? <span key={`s${i}`}>{p}</span> : p))
}

const PILL = 'flex h-[30px] items-center rounded-pill px-3 text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

function Option({ id, option, active, onHover, onRun, go, t, term, cageTitle, cageFacts, can, isMac }) {
  const common = {
    id,
    role: 'option',
    'aria-selected': active,
    onMouseMove: active ? undefined : onHover,
    onClick: onRun,
  }

  if (option.type === 'quick') {
    return (
      <div {...common} className={`flex h-11 shrink-0 cursor-pointer items-center gap-3 rounded-[12px] px-3 ${active ? 'bg-surface-2' : ''}`}>
        <span className={`${ICON_BOX} ${active ? 'bg-lime text-ink' : 'border border-line-strong text-text'}`}>
          <Glyph name={option.icon} />
        </span>
        <span className={`grow truncate text-[14px] leading-[18px] text-text ${active ? 'font-medium' : ''}`}>{option.label}</span>
        {option.hint && (
          <span className={`hidden shrink-0 text-xs leading-4 sm:inline ${option.hintTone === 'warn' ? 'text-warn' : 'text-faint'}`}>{option.hint}</span>
        )}
        {active && <kbd className={KBD}>↵</kbd>}
      </div>
    )
  }

  if (option.type === 'row') {
    return (
      <div {...common} className={`flex h-10 shrink-0 cursor-pointer items-center gap-3 rounded-[12px] px-3 ${active ? 'bg-surface-2' : ''}`}>
        <span className={`mx-[10px] size-2 shrink-0 rounded-pill ${option.dot}`} aria-hidden />
        <span className={`shrink-0 text-text ${option.mono ? 'font-geist text-[13px] leading-[18px]' : 'text-[14px] leading-[18px]'}`}>
          {option.name}
        </span>
        <span className="min-w-0 grow truncate text-xs leading-4 text-muted">{option.detail}</span>
        <span className="shrink-0 text-xs leading-4 text-faint">{option.right}</span>
      </div>
    )
  }

  if (option.type === 'doit') {
    return (
      <div {...common} className={`flex h-10 shrink-0 cursor-pointer items-center gap-3 rounded-[12px] px-3 ${active ? 'bg-surface-2' : ''}`}>
        <span className={`${ICON_BOX} border border-line-strong text-text`}>
          <Glyph name={option.icon} />
        </span>
        <span className="grow truncate text-[14px] leading-[18px] text-text">{option.label}</span>
        {option.right && <span className="hidden shrink-0 text-xs leading-4 text-faint sm:inline">{option.right}</span>}
        {active && <kbd className={KBD}>↵</kbd>}
      </div>
    )
  }

  if (option.type === 'ask') {
    return (
      <div
        {...common}
        className={`flex h-11 shrink-0 cursor-pointer items-center gap-3 rounded-[12px] bg-[color-mix(in_oklab,#F2A07B_8%,transparent)] px-3 ${active ? 'ring-1 ring-inset ring-[#F2A07B59]' : ''}`}
      >
        <span className={`${ICON_BOX} border border-[#F2A07B59] text-text`}>
          <Glyph name="ask" />
        </span>
        <span className="grow truncate text-[14px] leading-[18px] text-text">
          {t('navSearch.askPrefix')} <span className="text-muted">&ldquo;{option.question}&rdquo;</span>
        </span>
        <kbd className={KBD}>{isMac ? '⌘↵' : 'Ctrl ↵'}</kbd>
      </div>
    )
  }

  // The cage card (72b): facts, the open alert in red, and inline actions reached with Tab.
  const { cage } = option
  const pills = [
    can('production.daily.record') && { key: 'water', lime: cage.alert?.water, label: t('navSearch.action.water') },
    can('production.daily.record') && { key: 'daily', label: t('navSearch.action.daily') },
    can('production.sampling.record') && { key: 'sampling', label: t('navSearch.action.sampling') },
    can('production.transfer.request') && { key: 'transfer', label: t('navSearch.action.transfer') },
  ].filter(Boolean)
  return (
    <div
      {...common}
      className={`flex flex-col gap-3 rounded-[14px] border border-line-strong bg-surface-2 p-[14px] ${active ? '' : 'cursor-pointer'}`}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line-strong text-text" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </span>
        <div className="flex min-w-0 grow flex-col gap-[2px]">
          <div className="truncate text-[16px] font-semibold leading-5 text-text">
            {cageTitle(cage)}{' '}
            <span className="font-normal text-muted">
              {[cageFacts(cage), cage.location].filter(Boolean).map((part) => `· ${part} `)}
            </span>
          </div>
          {cage.alert && <div className="truncate text-xs leading-4 text-alert">{cage.alert.text}</div>}
        </div>
        {active && <kbd className={KBD}>↵ {t('navSearch.footer.open')}</kbd>}
      </div>
      {pills.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:pl-12">
          {pills.map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                go(actionHref(pill.key, cage._id))
              }}
              className={`${PILL} ${pill.lime ? 'bg-lime font-semibold text-ink' : 'border border-line-strong text-text hover:bg-surface'}`}
            >
              {term.text(pill.label)}
            </button>
          ))}
          <span className="grow" />
          <span className="hidden text-[11px] leading-[14px] text-faint sm:inline">Tab</span>
        </div>
      )}
    </div>
  )
}
