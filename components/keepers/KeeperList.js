import Link from 'next/link'
import { Check, ChevronRight } from 'lucide-react'
import { Avatar, SearchField } from '../ui'
import { useLocale, useT } from '../../lib/i18n/context'
import { capacityBar, rowStatus, shortDate } from '../../lib/keepers'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

/**
 * The exceptions list (Paper 57, right): keepers that need attention first,
 * healthy ones counted and hidden, search, site filter, quick filters, row
 * checkboxes that drive the bulk bar. One page from the server (`limit`),
 * "Show more" asks for the next.
 */
export default function KeeperList({
  board,
  filter,
  onFilter,
  search,
  onSearch,
  siteId,
  onSite,
  locations,
  selected,
  onToggle,
  onMore,
  onAssignGap,
  bulk,
}) {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const lang = formatLocale || locale
  const chips = [
    { key: 'attention', label: t('keepers.list.chipAttention', { count: board?.chips.attention ?? 0 }) },
    { key: 'over', label: t('keepers.list.chipOver', { capacity: board?.capacity ?? 25, count: board?.chips.over ?? 0 }) },
    { key: 'away', label: t('keepers.list.chipAway', { count: board?.chips.away ?? 0 }) },
    { key: 'all', label: t('keepers.list.chipAll', { count: board?.chips.all ?? 0 }) },
  ]
  const rows = board?.rows ?? []

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-line bg-surface" aria-label={t('keepers.list.label')}>
      <div className="flex flex-col gap-3 border-b border-line px-[18px] py-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchField
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('keepers.list.search')}
            aria-label={t('keepers.list.search')}
            className="h-[38px] grow rounded-[10px] bg-bg"
          />
          <select
            value={siteId || ''}
            onChange={(e) => onSite(e.target.value || null)}
            aria-label={t('keepers.list.site')}
            className="h-[38px] rounded-[10px] border border-line-strong bg-bg px-3 text-[13px] text-text sm:w-44"
          >
            <option value="">{t('keepers.list.allSites')}</option>
            {(locations || []).map((l) => (
              <option key={l.id || l._id} value={l.id || l._id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('keepers.list.filters')}>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={filter === c.key}
              onClick={() => onFilter(c.key)}
              className={`rounded-pill px-3 py-1.5 text-xs leading-4 ${FOCUS} ${
                filter === c.key ? 'bg-text font-semibold text-bg' : 'border border-line-strong text-muted hover:text-text'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden items-center gap-3 border-b border-line px-[18px] py-2 text-[11px] uppercase leading-[14px] tracking-[0.04em] text-faint md:flex" aria-hidden>
        <span className="w-4" />
        <span className="flex-[1.6]">{t('keepers.list.colKeeper')}</span>
        <span className="flex-[1.3]">{t('keepers.list.colCages')}</span>
        <span className="flex-1">{t('keepers.list.colToday')}</span>
        <span className="flex-[1.4]">{t('keepers.list.colWhy')}</span>
        <span className="w-4" />
      </div>

      {board === undefined ? (
        <p className="px-[18px] py-8 text-sm text-muted" role="status">{t('keepers.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="px-[18px] py-8 text-sm text-muted">{search ? t('keepers.list.noMatch') : filter === 'attention' ? t('keepers.list.allGood') : t('keepers.list.empty')}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => {
            const gap = r.kind === 'unassigned'
            const st = rowStatus(r, board.capacity)
            const bar = capacityBar(r.units, board.capacity, { unassigned: gap, away: !!r.away })
            const on = selected.has(r.id)
            const text = (x) => t(x.key, { ...(x.values || {}), date: x.values?.date ? shortDate(x.values.date, lang) : undefined })
            const href = r.siteId && r.row ? `/cage-keepers/row?site=${r.siteId}&row=${encodeURIComponent(r.row)}` : null
            return (
              <li key={r.id} className={`flex flex-wrap items-center gap-3 border-b border-line px-[18px] py-2.5 md:flex-nowrap ${on ? 'bg-cover/[0.06]' : ''}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={t('keepers.list.select', { name: gap ? t('keepers.list.noKeeperRow', { site: r.site, row: r.row }) : r.name })}
                  onClick={() => onToggle(r)}
                  className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] ${FOCUS} ${on ? 'border border-cover bg-cover text-bg' : 'border-[1.5px] border-line-strong'}`}
                >
                  {on && <Check size={12} strokeWidth={3} aria-hidden />}
                </button>
                <div className="flex min-w-0 flex-[1.6] items-center gap-2.5">
                  {gap ? (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-pill border-[1.5px] border-dashed border-alert text-xs text-alert" aria-hidden>
                      –
                    </span>
                  ) : (
                    <Avatar name={r.name} size={28} />
                  )}
                  <div className="flex min-w-0 flex-col">
                    <span className={`truncate text-[13px] font-semibold leading-4 ${gap ? 'text-alert' : 'text-text'}`}>{gap ? t('keepers.list.noKeeper') : r.name}</span>
                    <span className="truncate text-xs leading-4 text-muted">{[r.site, r.row ? t('keepers.list.row', { row: r.row }) : null].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
                <div className="flex min-w-[96px] flex-[1.3] items-center gap-2">
                  <span className="w-[22px] shrink-0 text-[13px] font-semibold leading-4 text-text">{r.units}</span>
                  <span className="h-[5px] grow overflow-hidden rounded-pill bg-line-strong" aria-hidden>
                    <span className={`block h-full rounded-pill ${bar.tone}`} style={{ width: `${bar.pct}%` }} />
                  </span>
                </div>
                <span className={`flex-1 text-[13px] leading-4 ${st.today.tone}`}>{text(st.today)}</span>
                <span className="flex-[1.4] text-[13px] leading-4 text-muted">{text(st.reason)}</span>
                {gap ? (
                  <button type="button" onClick={() => onAssignGap(r)} className={`shrink-0 text-[13px] font-semibold text-cover hover:underline ${FOCUS}`}>
                    {t('keepers.list.assign')}
                  </button>
                ) : href ? (
                  <Link href={href} aria-label={t('keepers.list.open', { name: r.name })} className={`shrink-0 rounded-sm text-faint hover:text-text ${FOCUS}`}>
                    <ChevronRight size={16} aria-hidden />
                  </Link>
                ) : (
                  <span className="w-4" />
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-auto flex flex-col gap-3 px-[18px] py-3">
        {board && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-4 text-faint">
            <span>
              {filter === 'attention'
                ? t('keepers.list.showingAttention', { shown: rows.length, count: board.total })
                : t('keepers.list.showing', { shown: rows.length, count: board.total })}
              {board.hiddenHealthy > 0 && ` · ${t('keepers.list.hidden', { count: board.hiddenHealthy })}`}
            </span>
            {rows.length < board.total && (
              <button type="button" onClick={onMore} className={`font-semibold text-cover hover:underline ${FOCUS}`}>
                {t('keepers.list.more')}
              </button>
            )}
          </div>
        )}
        {bulk}
      </div>
    </section>
  )
}
