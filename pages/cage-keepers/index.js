import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { Settings2, X } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { ErrorState, GhostButton, GradientButton } from '../../components/ui'
import KeeperHeatmap from '../../components/keepers/KeeperHeatmap'
import KeeperList from '../../components/keepers/KeeperList'
import AnowaBrief from '../../components/keepers/AnowaBrief'
import AssignPicker from '../../components/keepers/AssignPicker'
import PlanCoverSheet from '../../components/keepers/PlanCoverSheet'
import KeeperSettings from '../../components/keepers/KeeperSettings'
import LimeButton from '../../components/keepers/LimeButton'
import { BalanceIcon, CoverCalendarIcon } from '../../components/keepers/icons'
import { useKeeperDraft } from '../../components/keepers/KeeperDraft'
import { api } from '../../convex/_generated/api'
import { useLocation } from '../../contexts/LocationContext'
import { usePermission } from '../../hooks/usePermission'
import { localToday } from '../../lib/format'
import { useT } from '../../lib/i18n/context'

const PAGE = 25

/**
 * Cage keepers at scale (Paper 57): Anowa's brief with one-tap fixes, the
 * heatmap of every unit today, and the exceptions list. Built for 1,000
 * units and hundreds of keepers: the server sends the squares and one page of
 * the list; every change is an Anowa draft the manager confirms.
 */
export default function CageKeepersPage() {
  const t = useT()
  return (
    <ProtectedRoute permission="production.keepers.manage">
      <Board t={t} />
    </ProtectedRoute>
  )
}

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

function Board({ t }) {
  const { locations } = useLocation()
  const canAsk = usePermission('ai.use')
  const [filter, setFilter] = useState('attention')
  const [search, setSearch] = useState('')
  const [siteId, setSiteId] = useState(null)
  const [limit, setLimit] = useState(PAGE)
  const q = useDebounced(search.trim())
  const asOf = localToday()
  const board = useQuery(api.keepers.board.board, {
    asOf,
    filter,
    limit,
    ...(q ? { search: q } : {}),
    ...(siteId ? { siteId } : {}),
  })
  const { propose, busy, modal } = useKeeperDraft()
  const [squares, setSquares] = useState(() => new Set())
  const [rowsSel, setRowsSel] = useState(() => new Map())
  const [assign, setAssign] = useState(null)
  const [cover, setCover] = useState(null)
  const [settings, setSettings] = useState(false)

  useEffect(() => setLimit(PAGE), [filter, q, siteId])

  const onSelect = useCallback((ids, additive, toggle) => {
    setSquares((prev) => {
      if (toggle) {
        const next = new Set(prev)
        for (const id of ids) next.has(id) ? next.delete(id) : next.add(id)
        return next
      }
      if (!additive && ids.length === 1 && prev.size === 1 && prev.has(ids[0])) return new Set()
      return new Set(additive ? [...prev, ...ids] : ids)
    })
  }, [])

  // The site of the selected squares (assign picks keepers there).
  const squareSite = useMemo(() => {
    if (!board || !squares.size) return null
    const site = board.sites.find((s) => s.units.some((u) => squares.has(u.id)))
    return site?.id || null
  }, [board, squares])

  const toggleRow = (r) =>
    setRowsSel((prev) => {
      const next = new Map(prev)
      next.has(r.id) ? next.delete(r.id) : next.set(r.id, r)
      return next
    })
  const selRows = [...rowsSel.values()]
  const selKeepers = selRows.filter((r) => r.kind === 'keeper')
  const selUnits = selRows.reduce((n, r) => n + r.units, 0)

  const fix = async (key) => {
    const b = board?.brief
    if (key === 'none') {
      const who = b?.none.suggest || []
      if (who.length && b.none.unitIds.length) {
        // Exactly what the brief says: this group, alternating between the suggested keepers.
        await propose({ kind: 'keeper_assign', moves: b.none.unitIds.map((unitId, i) => ({ unitId, keeperId: who[i % who.length].id })) }, b.none.siteId || undefined)
      } else {
        await propose({ kind: 'keeper_rebalance', unassignedOnly: true, ...(b?.none.siteId ? { siteId: b.none.siteId } : {}) })
      }
    }
    else if (key === 'over') await propose({ kind: 'keeper_rebalance' })
    else if (key === 'due') await propose({ kind: 'keeper_nudge' })
    else if (key === 'away') setCover({ keeperId: null })
  }

  const pick = async (keeper, backup) => {
    const ok = await propose(
      { kind: 'keeper_assign', unitIds: assign.unitIds.slice(0, 200), keeperId: keeper.id, ...(backup ? { backupId: backup.id } : {}) },
      assign.siteId || undefined,
    )
    if (ok) {
      setAssign(null)
      setSquares(new Set())
    }
  }

  const eyebrow = board
    ? t('keepers.eyebrow', {
        site: siteId ? locations?.find((l) => (l.id || l._id) === siteId)?.name || '' : t('keepers.allSites'),
        units: board.sites.reduce((n, s) => n + s.units.length, 0),
        count: board.keepersTotal,
      })
    : t('keepers.eyebrowShort')

  if (board === null) return <ErrorState title={t('keepers.error')} />

  return (
    <Layout
      title={t('keepers.title')}
      eyebrow={eyebrow}
      actions={
        <>
          <LimeButton icon={BalanceIcon} onClick={() => propose({ kind: 'keeper_rebalance' })} disabled={busy}>
            {t('keepers.assignWithAnowa')}
          </LimeButton>
          <GradientButton icon={CoverCalendarIcon} ring="sky" onClick={() => setCover({ keeperId: null })}>
            {t('keepers.planCover')}
          </GradientButton>
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <AnowaBrief board={board} onFix={fix} canAsk={canAsk} />

        {board?.truncated && <p className="text-sm text-warn">{t('keepers.truncated')}</p>}

        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <section className="flex w-full shrink-0 flex-col gap-4 rounded-[20px] border border-line bg-surface px-5 py-[18px] xl:w-[470px]" aria-label={t('keepers.heatmap.title')}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-[15px] font-semibold leading-5 text-text">{t('keepers.heatmap.title')}</h2>
                <p className="text-xs leading-4 text-muted">{t('keepers.heatmap.hint')}</p>
              </div>
              <button type="button" onClick={() => setSettings(true)} aria-label={t('keepers.settings.title')} className="rounded-pill p-1.5 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                <Settings2 size={16} aria-hidden />
              </button>
            </div>
            {board === undefined ? (
              <p className="text-sm text-muted" role="status">{t('keepers.loading')}</p>
            ) : board.sites.length === 0 ? (
              <p className="text-sm text-muted">{t('keepers.heatmap.empty')}</p>
            ) : (
              <KeeperHeatmap sites={board.sites} deadline={board.deadline} names={board.names} selected={squares} onSelect={onSelect} />
            )}
            {squares.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-text py-2.5 pl-4 pr-3 text-bg">
                <span className="grow text-[13px] font-semibold leading-4">{t('keepers.heatmap.selected', { count: squares.size })}</span>
                <button type="button" onClick={() => setSquares(new Set())} className="rounded-pill border border-bg/25 px-3 py-[7px] text-xs font-medium">
                  <X size={12} className="mr-1 inline" aria-hidden />
                  {t('keepers.clear')}
                </button>
                <button
                  type="button"
                  onClick={() => setAssign({ unitIds: [...squares], siteId: squareSite })}
                  className="rounded-pill bg-lime px-3 py-[7px] text-xs font-semibold text-ink"
                >
                  {t('keepers.heatmap.assign')}
                </button>
              </div>
            )}
          </section>

          <div className="min-w-0 grow">
            <KeeperList
              board={board}
              filter={filter}
              onFilter={setFilter}
              search={search}
              onSearch={setSearch}
              siteId={siteId}
              onSite={setSiteId}
              locations={locations}
              selected={new Set(rowsSel.keys())}
              onToggle={toggleRow}
              onMore={() => setLimit((l) => Math.min(200, l + PAGE))}
              onAssignGap={(r) => setAssign({ unitIds: r.unitIds, siteId: r.siteId })}
              bulk={
                selRows.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-text py-2.5 pl-4 pr-3">
                    <span className="grow text-[13px] font-semibold leading-4 text-bg">{t('keepers.bulk.selected', { count: selRows.length, units: selUnits })}</span>
                    <button
                      type="button"
                      disabled={busy || !selKeepers.length}
                      onClick={async () => (await propose({ kind: 'keeper_nudge', keeperIds: selKeepers.map((r) => r.id) })) && setRowsSel(new Map())}
                      className="rounded-pill border border-bg/25 px-3 py-[7px] text-xs font-medium leading-4 text-bg disabled:opacity-50"
                    >
                      {t('keepers.bulk.nudge')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () =>
                        (await propose(
                          selKeepers.length
                            ? { kind: 'keeper_rebalance', keeperIds: selKeepers.map((r) => r.id) }
                            : { kind: 'keeper_rebalance', unassignedOnly: true },
                        )) && setRowsSel(new Map())
                      }
                      className="rounded-pill bg-lime px-3 py-[7px] text-xs font-semibold leading-4 text-ink disabled:opacity-50"
                    >
                      {t('keepers.bulk.rebalance')}
                    </button>
                  </div>
                )
              }
            />
          </div>
        </div>

        <div className="flex justify-end">
          <GhostButton size="sm" href="/my-cages">
            {t('keepers.openMyCages')}
          </GhostButton>
        </div>
      </div>

      <AssignPicker open={!!assign} unitCount={assign?.unitIds.length || 0} siteId={assign?.siteId} onClose={() => setAssign(null)} onPick={pick} busy={busy} />
      <PlanCoverSheet
        open={!!cover}
        keeperId={cover?.keeperId}
        onClose={() => setCover(null)}
        busy={busy}
        onSubmit={async (input) => (await propose(input)) && setCover(null)}
      />
      <KeeperSettings open={settings} onClose={() => setSettings(false)} />
      {modal}
    </Layout>
  )
}
