import { useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Button, EmptyState, LoadingState } from '../../components/ui'
import { UnitsHeaderActions, useUnitsEyebrow } from '../../components/units/UnitsHeader'
import UnitViewSwitch, { FilterSelect } from '../../components/units/UnitViewSwitch'
import UnitCard, { unitSignal } from '../../components/units/UnitCard'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { localToday } from '../../lib/format'
import { useTerm } from '../../hooks/useTerm'
import { useT } from '../../lib/i18n/context'

function Board({ data, latest }) {
  const t = useT()
  const router = useRouter()
  const wqByUnit = useMemo(() => new Map((latest || []).map((r) => [r.unitId, r])), [latest])
  const today = localToday()
  const queryGroup = typeof router.query.group === 'string' ? router.query.group : ''
  const [group, setGroup] = useState(null)
  const [species, setSpecies] = useState('')
  const [alertsOnly, setAlertsOnly] = useState(false)
  const groupValue = group ?? queryGroup

  const allUnits = useMemo(
    () => (data ? data.sections.flatMap((s) => s.units.map((u) => ({ ...u, groupKey: s.groupId || 'none' }))) : []),
    [data],
  )
  const speciesOptions = useMemo(
    () => [...new Set(allUnits.map((u) => u.species).filter(Boolean))].sort(),
    [allUnits],
  )
  const alerting = useMemo(
    () => new Set(allUnits.filter((u) => unitSignal(u, wqByUnit.get(u._id), today, t).alert).map((u) => u._id)),
    [allUnits, wqByUnit, today, t],
  )
  const units = allUnits.filter(
    (u) =>
      (!groupValue || u.groupKey === groupValue) &&
      (!species || u.species === species) &&
      (!alertsOnly || alerting.has(u._id)),
  )

  if (data === undefined) return <LoadingState label={t('unitsUi.loading')} />

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <UnitViewSwitch />
        <div className="flex flex-wrap gap-2">
          {data.sections.length > 1 && (
            <FilterSelect label={t('unitsUi.filterGroup')} value={groupValue} onChange={setGroup}>
              <option value="">{t('unitsUi.allGroups')}</option>
              {data.sections.map((s) => (
                <option key={s.groupId || 'none'} value={s.groupId || 'none'}>
                  {s.name}
                </option>
              ))}
            </FilterSelect>
          )}
          {speciesOptions.length > 0 && (
            <FilterSelect label={t('unitsUi.filterSpecies')} value={species} onChange={setSpecies}>
              <option value="">{t('unitsUi.anySpecies')}</option>
              {speciesOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </FilterSelect>
          )}
          <button
            type="button"
            aria-pressed={alertsOnly}
            onClick={() => setAlertsOnly((v) => !v)}
            className={`rounded-pill border px-[14px] py-2 text-sm leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              alertsOnly ? 'border-alert bg-surface-2 text-alert' : 'border-[var(--pill-red-border)] text-alert hover:bg-surface-2'
            }`}
          >
            {t('unitsUi.alertsOnly', { count: alerting.size })}
          </button>
        </div>
      </div>

      {allUnits.length === 0 ? (
        <EmptyState
          title={t('unitsUi.emptyTitle')}
          description={t('unitsUi.emptyBody')}
          action={<Button href="/create-cage">{t('unitsUi.newCage')}</Button>}
        />
      ) : units.length === 0 ? (
        <p className="text-sm text-muted">{t('unitsUi.noMatch')}</p>
      ) : (
        <ul className="flex flex-wrap gap-4" aria-label={t('unitsUi.view.board')}>
          {units.map((u) => (
            <li key={u._id} className="w-full sm:w-auto">
              <UnitCard u={u} wq={wqByUnit.get(u._id)} today={today} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function UnitsBoardPage() {
  const t = useT()
  const term = useTerm()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const data = useQuery(api.units.board, user ? locationArgs : 'skip')
  const latest = useQuery(api.waterQuality.latestByUnit, user ? locationArgs : 'skip')
  const eyebrow = useUnitsEyebrow(data)
  return (
    <Layout
      title={term.text(t('unitsUi.title'))}
      eyebrow={eyebrow}
      actions={<UnitsHeaderActions />}
    >
      <div className="flex flex-col gap-7">
        <Board data={data} latest={latest} />
      </div>
    </Layout>
  )
}

export default function UnitsPage() {
  return (
    <ProtectedRoute>
      <UnitsBoardPage />
    </ProtectedRoute>
  )
}
