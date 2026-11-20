import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import { CalendarDays, SlidersHorizontal } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Avatar, GhostButton, GradientButton, Tabs } from '../../components/ui'
import LimeButton from '../../components/keepers/LimeButton'
import PlanCoverSheet from '../../components/keepers/PlanCoverSheet'
import { useKeeperDraft } from '../../components/keepers/KeeperDraft'
import { api } from '../../convex/_generated/api'
import { useLocation } from '../../contexts/LocationContext'
import { localToday } from '../../lib/format'
import { useLocale, useT } from '../../lib/i18n/context'
import { clock, shortDate } from '../../lib/keepers'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
const SHOWN = 4

/**
 * One row up close (Paper 54): a column per keeper for one site row, the
 * units without a keeper, today's progress, and the coaching scorecard.
 * Drag a unit onto another keeper (or use its "Move to" menu); the moves are
 * staged and drafted together, and the Anowa card confirms them.
 */
export default function KeeperRowPage() {
  return (
    <ProtectedRoute permission="production.keepers.manage">
      <RowBoard />
    </ProtectedRoute>
  )
}

function RowBoard() {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const lang = formatLocale || locale
  const router = useRouter()
  const { locations, activeLocationId } = useLocation()
  const siteId = typeof router.query.site === 'string' ? router.query.site : activeLocationId
  const rows = useQuery(api.keepers.board.siteRows, siteId ? { siteId } : 'skip')
  const rowParam = typeof router.query.row === 'string' ? router.query.row : null
  const row = rowParam ?? rows?.[0]?.row ?? null
  const data = useQuery(api.keepers.board.row, siteId && row !== null ? { siteId, row, asOf: localToday() } : 'skip')
  const { propose, busy, modal } = useKeeperDraft()
  const [moves, setMoves] = useState(() => new Map())
  const [dragging, setDragging] = useState(null)
  const [cover, setCover] = useState(null)
  const [open, setOpen] = useState(() => new Set())

  useEffect(() => setMoves(new Map()), [siteId, row])

  const go = (query) => router.push({ pathname: '/cage-keepers/row', query: { site: siteId, row, ...query } }, undefined, { shallow: true })

  // Columns with the staged moves applied (the server state is unchanged until confirm).
  const columns = useMemo(() => {
    if (!data) return []
    const cols = data.columns.map((c) => ({ ...c, cards: c.cards.filter((x) => !moves.has(x.id)) }))
    const all = [...data.columns.flatMap((c) => c.cards), ...data.unassigned]
    for (const [unitId, keeperId] of moves) {
      const card = all.find((x) => x.id === unitId)
      const col = cols.find((c) => c.keeperId === keeperId)
      if (card && col) col.cards = [...col.cards, { ...card, staged: true }]
    }
    return cols
  }, [data, moves])
  const unassigned = data ? data.unassigned.filter((x) => !moves.has(x.id)) : []

  const stage = (unitId, keeperId) =>
    setMoves((prev) => {
      const next = new Map(prev)
      const home = data?.columns.find((c) => c.cards.some((x) => x.id === unitId))?.keeperId
      if (home === keeperId) next.delete(unitId)
      else next.set(unitId, keeperId)
      return next
    })

  const review = async () => {
    const ok = await propose({ kind: 'keeper_assign', moves: [...moves].map(([unitId, keeperId]) => ({ unitId, keeperId })) }, siteId)
    if (ok) setMoves(new Map())
  }

  const noneCount = data ? data.unassigned.filter((x) => x.stocked).length : 0
  const weekCover = data?.coversThisWeek?.[0]
  const scoreFor = (id) => data?.scores.find((s) => s.keeperId === id)

  return (
    <Layout
      title={t('keepers.title')}
      eyebrow={data ? t('keepers.row.eyebrow', { site: data.site.name, count: data.stocked + data.unassigned.filter((x) => !x.stocked).length, keepers: data.columns.length }) : t('keepers.eyebrowShort')}
      actions={
        <>
          <LimeButton icon={SlidersHorizontal} disabled={busy || !siteId} onClick={() => propose({ kind: 'keeper_rebalance', siteId, row: row || undefined }, siteId)}>
            {t('keepers.row.autoBalance')}
          </LimeButton>
          <GradientButton icon={CalendarDays} reverse onClick={() => setCover({ keeperId: null })}>
            {t('keepers.planCover')}
          </GradientButton>
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={siteId || ''}
            onChange={(e) => router.push({ pathname: '/cage-keepers/row', query: { site: e.target.value } }, undefined, { shallow: true })}
            aria-label={t('keepers.list.site')}
            className="h-9 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] text-text"
          >
            {(locations || []).map((l) => (
              <option key={l.id || l._id} value={l.id || l._id}>
                {l.name}
              </option>
            ))}
          </select>
          {rows && rows.length > 0 && (
            <Tabs
              variant="chip"
              label={t('keepers.row.rows')}
              value={row}
              onChange={(r) => go({ row: r })}
              tabs={rows.slice(0, 40).map((r) => ({ value: r.row, label: r.row ? `${t('keepers.list.row', { row: r.row })} · ${r.units}` : `${t('keepers.row.noRow')} · ${r.units}` }))}
            />
          )}
          <GhostButton size="sm" href="/cage-keepers" className="ml-auto">
            {t('keepers.row.back')}
          </GhostButton>
        </div>

        {data === undefined ? (
          <p className="text-sm text-muted" role="status">{t('keepers.loading')}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className={`flex flex-col gap-3.5 rounded-2xl px-[18px] py-4 ${noneCount ? 'border border-alert/35' : 'border border-line bg-surface'}`}>
                <span className={`text-[28px] font-semibold leading-8 ${noneCount ? 'text-alert' : 'text-text'}`}>{noneCount}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-text">{t('keepers.row.kpiNone')}</span>
                  <span className="text-xs text-muted">{t('keepers.row.kpiNoneHint')}</span>
                </span>
              </div>
              <div className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface px-[18px] py-4">
                <span className="text-[28px] font-semibold leading-8 text-text">
                  {data.logged}
                  <span className="text-faint">/{data.stocked}</span>
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-text">{t('keepers.row.kpiLogged')}</span>
                  <span className="text-xs text-muted">{t('keepers.row.kpiLoggedHint', { count: data.stocked - data.logged, deadline: data.deadline })}</span>
                </span>
              </div>
              <div className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface px-[18px] py-4">
                <span className="text-[28px] font-semibold leading-8 text-cover">{data.coversThisWeek.length}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-text">{t('keepers.row.kpiCover')}</span>
                  <span className="text-xs text-muted">
                    {weekCover
                      ? t('keepers.row.kpiCoverHint', { cover: weekCover.cover, keeper: weekCover.keeper, from: shortDate(weekCover.fromDate, lang), to: shortDate(weekCover.toDate, lang) })
                      : t('keepers.row.kpiCoverNone')}
                  </span>
                </span>
              </div>
            </div>

            {moves.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-text py-2.5 pl-4 pr-3" role="status">
                <span className="grow text-[13px] font-semibold text-bg">{t('keepers.row.staged', { count: moves.size })}</span>
                <button type="button" onClick={() => setMoves(new Map())} className="rounded-pill border border-bg/25 px-3 py-[7px] text-xs font-medium text-bg">
                  {t('keepers.row.undoMoves')}
                </button>
                <button type="button" onClick={review} disabled={busy} className="rounded-pill bg-lime px-3 py-[7px] text-xs font-semibold text-ink disabled:opacity-50">
                  {t('keepers.row.review')}
                </button>
              </div>
            )}

            <div className="flex gap-3 overflow-x-auto pb-2 lg:items-start">
              <section className="flex w-[200px] shrink-0 flex-col gap-2 rounded-[18px] border-[1.5px] border-dashed border-alert/45 p-3" aria-label={t('keepers.list.noKeeper')}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text">{t('keepers.list.noKeeper')}</span>
                  <span className="text-sm font-semibold text-alert">{unassigned.length}</span>
                </div>
                {unassigned.map((c) => (
                  <UnitCard key={c.id} card={c} columns={columns} onMove={stage} onDrag={setDragging} lang={lang} t={t} sub={c.stockingDate ? t('keepers.row.stocked', { date: shortDate(c.stockingDate, lang), count: c.fish ?? 0 }) : null} />
                ))}
                <p className="text-xs leading-4 text-faint">{t('keepers.row.dragHint')}</p>
              </section>

              {columns.map((col) => {
                const away = col.away
                const pct = col.stocked ? Math.round((col.logged / col.stocked) * 100) : 0
                const tone = away ? 'text-cover' : col.logged === col.stocked ? 'text-good' : 'text-warn'
                const bar = away ? 'bg-cover' : col.logged === col.stocked ? 'bg-good' : 'bg-warn'
                const expanded = open.has(col.keeperId)
                const shown = expanded ? col.cards : col.cards.slice(0, SHOWN)
                return (
                  <section
                    key={col.keeperId}
                    aria-label={col.name}
                    onDragOver={(e) => dragging && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragging) stage(dragging, col.keeperId)
                      setDragging(null)
                    }}
                    className={`flex min-w-[260px] grow basis-0 flex-col gap-2 rounded-[18px] bg-surface p-3 ${away ? 'border-[1.5px] border-dashed border-cover/45' : 'border border-line'}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar name={col.name} size={34} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold text-text">{col.name}</span>
                        <span className={`truncate text-xs ${away ? 'text-cover' : 'text-muted'}`}>
                          {away
                            ? t('keepers.row.away', { from: shortDate(away.fromDate, lang), to: shortDate(away.toDate, lang), name: away.coverName })
                            : t('keepers.row.colSub', { count: col.cards.length, fish: Math.round(col.fish / 1000), kg: col.kgPerDay ?? '–' })}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 py-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted">{t('keepers.row.today')}</span>
                        <span className={`font-semibold ${tone}`}>{away ? t('keepers.list.coverLogging', { name: away.coverName }) : t('keepers.list.loggedOf', { logged: col.logged, count: col.stocked })}</span>
                      </div>
                      <span className="h-1 overflow-hidden rounded-pill bg-line-strong" aria-hidden>
                        <span className={`block h-full ${bar}`} style={{ width: `${away ? 100 : pct}%` }} />
                      </span>
                    </div>
                    {shown.map((c) => (
                      <UnitCard key={c.id} card={c} columns={columns} onMove={stage} onDrag={setDragging} lang={lang} t={t} home={col.keeperId} deadline={data.deadline} />
                    ))}
                    <button
                      type="button"
                      onClick={() => setOpen((s) => new Set(expanded ? [...s].filter((x) => x !== col.keeperId) : [...s, col.keeperId]))}
                      className={`self-start text-xs text-faint hover:text-text ${FOCUS}`}
                    >
                      {[
                        col.cards.length > SHOWN ? (expanded ? t('keepers.row.less') : t('keepers.row.more', { count: col.cards.length - SHOWN })) : null,
                        away ? t('keepers.row.backOn', { date: shortDate(away.toDate, lang) }) : col.backupName ? t('keepers.row.backup', { name: col.backupName }) : t('keepers.row.noBackup'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </button>
                    {!away && (
                      <button type="button" onClick={() => setCover({ keeperId: col.keeperId })} className={`self-start text-xs font-semibold text-cover hover:underline ${FOCUS}`}>
                        {t('keepers.row.planCoverFor', { name: col.name.split(' ')[0] })}
                      </button>
                    )}
                  </section>
                )
              })}
            </div>

            <section className="overflow-hidden rounded-[18px] border border-line bg-surface" aria-label={t('keepers.score.title')}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-[18px] py-3.5">
                <h2 className="text-[15px] font-semibold text-text">{t('keepers.score.title')}</h2>
                <span className="text-xs text-muted">{t('keepers.score.subtitle')}</span>
              </div>
              {!data.farm ? (
                <p className="px-[18px] py-4 text-sm text-muted">{t('keepers.score.pending')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left">
                    <thead>
                      <tr className="text-xs text-faint">
                        <th className="w-[220px] px-[18px] py-2.5 font-normal">{t('keepers.score.keeper')}</th>
                        <th className="px-3 py-2.5 font-normal">{t('keepers.score.onTime')}</th>
                        <th className="px-3 py-2.5 font-normal">{t('keepers.score.survival')}</th>
                        <th className="px-3 py-2.5 font-normal">{t('keepers.score.fcr')}</th>
                        <th className="px-3 py-2.5 font-normal">{t('keepers.score.samplings')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map((col) => {
                        const s = scoreFor(col.keeperId)
                        return (
                          <tr key={col.keeperId} className="border-t border-line text-sm text-text">
                            <td className="px-[18px] py-3 font-semibold">{col.name}</td>
                            <td className="px-3 py-3">{s ? <Delta value={s.onTimePct} farm={data.farm.onTimePct} unit="%" t={t} /> : '–'}</td>
                            <td className="px-3 py-3">{s ? <Delta value={s.survivalPct} farm={data.farm.survivalPct} unit="%" t={t} /> : '–'}</td>
                            <td className="px-3 py-3">{s ? <Delta value={s.fcr} farm={data.farm.fcr} lowerBetter worst={s.worstFcrUnit} t={t} /> : '–'}</td>
                            <td className="px-3 py-3">{s ? t('keepers.score.sampled', { done: s.sampled, count: s.stocked }) : '–'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="px-[18px] pb-3 text-xs text-faint">{t('keepers.score.asOf', { date: shortDate(data.farm.asOf, lang) })}</p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <PlanCoverSheet open={!!cover} keeperId={cover?.keeperId} onClose={() => setCover(null)} busy={busy} onSubmit={async (input) => (await propose(input, siteId)) && setCover(null)} />
      {modal}
    </Layout>
  )
}

/** A number with its gap to the farm average, worded to coach: "+6", "avg", "better", "B-12 high". */
function Delta({ value, farm, unit = '', lowerBetter = false, worst, t }) {
  if (value == null) return '–'
  const shown = unit === '%' ? `${value}%` : value.toFixed(2)
  if (farm == null) return shown
  const d = Math.round((value - farm) * (unit === '%' ? 1 : 100)) / (unit === '%' ? 1 : 100)
  const better = lowerBetter ? d < -0.02 : d >= 2
  const worse = lowerBetter ? d > 0.05 : d <= -2
  let note = t('keepers.score.avg')
  let tone = 'text-muted'
  if (better) {
    note = lowerBetter ? t('keepers.score.better') : `+${d}`
    tone = 'text-good'
  } else if (worse) {
    note = lowerBetter && worst ? t('keepers.score.high', { unit: worst }) : `${d}`.replace('-', '−')
    tone = 'text-warn'
  }
  return (
    <span>
      {shown} <span className={`text-xs ${tone}`}>{note}</span>
    </span>
  )
}

function UnitCard({ card, columns, onMove, onDrag, lang, t, home, deadline, sub }) {
  const late = card.stocked && !card.loggedAt
  const detail =
    sub ||
    [
      card.day != null ? t('keepers.row.day', { count: card.day }) : null,
      card.abwG != null ? `${card.abwG} g` : null,
      card.deadYesterday ? t('keepers.row.deadYesterday', { count: card.deadYesterday }) : null,
    ]
      .filter(Boolean)
      .join(' · ')
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDrag(card.id)
      }}
      onDragEnd={() => onDrag(null)}
      className={`flex cursor-grab items-center gap-2 rounded-md bg-bg px-3 py-[11px] active:cursor-grabbing ${late && home ? 'border border-warn/40' : 'border border-line'} ${card.staged ? 'ring-1 ring-cover' : ''}`}
    >
      <div className="flex min-w-0 grow flex-col">
        <span className="text-sm font-semibold text-text">{card.name}</span>
        <span className="truncate text-xs text-muted">{detail}</span>
      </div>
      {home && card.stocked && (
        <span className={`shrink-0 text-xs ${card.loggedAt ? 'text-good' : 'text-warn'}`}>
          {card.loggedAt ? clock(card.loggedAt, lang) : t('keepers.row.due', { deadline })}
        </span>
      )}
      <select
        value=""
        onChange={(e) => e.target.value && onMove(card.id, e.target.value)}
        aria-label={t('keepers.row.moveTo', { unit: card.name })}
        className="w-6 shrink-0 cursor-pointer appearance-none rounded border-0 bg-transparent p-0 text-center text-xs text-faint focus:ring-2 focus:ring-cyan"
        title={t('keepers.row.moveTo', { unit: card.name })}
      >
        <option value="">⋯</option>
        {columns
          .filter((c) => c.keeperId !== home)
          .map((c) => (
            <option key={c.keeperId} value={c.keeperId}>
              {c.name}
            </option>
          ))}
      </select>
    </div>
  )
}
