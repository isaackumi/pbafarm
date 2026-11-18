import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select } from '../components/ui'
import { useToast } from '../components/Toast'
import { kg, rationText } from '../components/RationSuggestion'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { usePermission } from '../hooks/usePermission'
import { errorMessage } from '../lib/errorMessage'
import { FISH_SPECIES } from '../lib/fishSpecies'
import { useT } from '../lib/i18n/context'
import { RATION_LIMITS, bandProblems } from '../convex/lib/ration'

/**
 * Feeding plans (PROD-015): feed tables per species (ABW band → % body
 * weight/day, feedings, pellet size) and today's suggested ration per unit.
 */
export default function FeedingPlansPage() {
  const t = useT()
  return (
    <ProtectedRoute permission="production.view">
      <Layout title={t('feedingPlan.title')}>
        <FeedingPlans />
      </Layout>
    </ProtectedRoute>
  )
}

const speciesLabel = (p) => p.speciesName || FISH_SPECIES.find((s) => s.value === p.speciesKey)?.label || p.speciesKey

function FeedingPlans() {
  const t = useT()
  const { canUseApp } = useAuth()
  const { locationArgs } = useLocation()
  const locationId = locationArgs?.locationId
  const rations = useQuery(api.feedingPlans.rations, canUseApp ? (locationId ? { locationId } : {}) : 'skip')
  const plans = useQuery(api.feedingPlans.list, canUseApp ? {} : 'skip')

  return (
    <div className="space-y-6">
      <PageHeader
        showTitle={false}
        breadcrumbs={[{ label: t('nav.item.dashboard'), href: '/dashboard' }, { label: t('feedingPlan.title') }]}
        description={t('feedingPlan.intro')}
      />
      <Card padding={false}>
        <div className="p-5 sm:p-6">
          <CardHeader
            title={t('feedingPlan.todayTitle')}
            subtitle={
              rations
                ? t('feedingPlan.totalLine', { kg: kg(rations.totalKgPerDay), planned: rations.planned, total: rations.rows.length })
                : undefined
            }
          />
        </div>
        {rations === undefined ? (
          <p className="px-6 pb-6 text-sm text-muted">{t('common.loading')}</p>
        ) : rations.rows.length === 0 ? (
          <EmptyState title={t('feedingPlan.noUnits')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted bg-foam/60">
                  <th className="px-5 py-3 font-semibold">{t('feedingPlan.col.unit')}</th>
                  <th className="px-5 py-3 font-semibold">{t('feedingPlan.col.species')}</th>
                  <th className="px-5 py-3 font-semibold text-right">{t('feedingPlan.col.fish')}</th>
                  <th className="px-5 py-3 font-semibold text-right">{t('feedingPlan.col.abw')}</th>
                  <th className="px-5 py-3 font-semibold text-right">{t('feedingPlan.col.bodyWeightPct')}</th>
                  <th className="px-5 py-3 font-semibold text-right">{t('feedingPlan.col.kgPerDay')}</th>
                  <th className="px-5 py-3 font-semibold">{t('feedingPlan.col.how')}</th>
                </tr>
              </thead>
              <tbody>
                {rations.rows.map((r) => (
                  <tr key={r.cageId} className="border-t border-foam-deep">
                    <td className="px-5 py-3 font-medium text-chart-ink">{r.cageName}</td>
                    <td className="px-5 py-3">{r.speciesKey ? speciesLabel({ speciesKey: r.speciesKey, speciesName: plans?.find((p) => p.speciesKey === r.speciesKey)?.speciesName }) : '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{Number(r.count).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{r.abwG != null ? `${kg(r.abwG)} g` : '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{r.ration.ok ? `${r.ration.bodyWeightPct}%` : '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium">{r.ration.ok ? kg(r.ration.kgPerDay) : '—'}</td>
                    <td className="px-5 py-3 text-muted">{rationText(t, r.ration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <FeedTables plans={plans} />
    </div>
  )
}

const emptyBand = (minAbwG) => ({ minAbwG, bodyWeightPct: 3, feedingsPerDay: 2, pelletMm: 2 })

function FeedTables({ plans }) {
  const t = useT()
  const { showToast } = useToast()
  const canEdit = usePermission('org.settings.manage')
  const save = useMutation(api.feedingPlans.save)
  const reset = useMutation(api.feedingPlans.reset)
  const [speciesKey, setSpeciesKey] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  const current = useMemo(() => plans?.find((p) => p.speciesKey === speciesKey) ?? plans?.[0], [plans, speciesKey])
  useEffect(() => {
    if (current) setDraft({ name: current.name ?? speciesLabel(current), bands: current.bands ?? [emptyBand(0)] })
  }, [current])

  const problems = useMemo(() => (draft ? bandProblems(draft.bands.map(numeric)) : []), [draft])

  if (plans === undefined) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (!current || !draft) return null

  const setBand = (i, key, value) =>
    setDraft((d) => ({ ...d, bands: d.bands.map((b, k) => (k === i ? { ...b, [key]: value } : b)) }))
  const run = async (fn, done) => {
    setBusy(true)
    try {
      await fn()
      showToast('success', done)
    } catch (err) {
      showToast('error', errorMessage(err, t('feedingPlan.saveFailed')))
    } finally {
      setBusy(false)
    }
  }
  const sourceText = t(`feedingPlan.source.${current.source}`)

  return (
    <Card className="space-y-4">
      <CardHeader title={t('feedingPlan.tablesTitle')} subtitle={t('feedingPlan.tablesIntro')} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('feedingPlan.col.species')} htmlFor="fp-species" className="min-w-56">
          <Select id="fp-species" value={current.speciesKey} onChange={(e) => setSpeciesKey(e.target.value)}>
            {plans.map((p) => (
              <option key={p.speciesKey} value={p.speciesKey}>
                {speciesLabel(p)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-sm text-muted pb-2">{sourceText}</p>
      </div>
      {canEdit && (
        <Field label={t('feedingPlan.planName')} htmlFor="fp-name">
          <Input
            id="fp-name"
            value={draft.name}
            maxLength={RATION_LIMITS.nameLength}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </Field>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 pr-3 font-semibold">{t('feedingPlan.col.fromAbw')}</th>
              <th className="py-2 pr-3 font-semibold">{t('feedingPlan.col.bodyWeightPct')}</th>
              <th className="py-2 pr-3 font-semibold">{t('feedingPlan.col.feedings')}</th>
              <th className="py-2 pr-3 font-semibold">{t('feedingPlan.col.pellet')}</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {draft.bands.map((b, i) => (
              <tr key={i} className="border-t border-foam-deep">
                {['minAbwG', 'bodyWeightPct', 'feedingsPerDay', 'pelletMm'].map((key) => (
                  <td key={key} className="py-2 pr-3">
                    {canEdit ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        aria-label={t(`feedingPlan.col.${COL[key]}`)}
                        className="w-28 tabular-nums"
                        value={b[key]}
                        disabled={key === 'minAbwG' && i === 0}
                        onChange={(e) => setBand(i, key, e.target.value)}
                      />
                    ) : (
                      <span className="tabular-nums">{b[key]}</span>
                    )}
                  </td>
                ))}
                {canEdit && (
                  <td className="py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('feedingPlan.removeBand')}
                      disabled={draft.bands.length === 1}
                      onClick={() => setDraft((d) => ({ ...d, bands: d.bands.filter((_, k) => k !== i) }))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && problems.length > 0 && (
        <div role="alert" className="text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3 space-y-1">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={draft.bands.length >= RATION_LIMITS.bandsPerTable}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                bands: [...d.bands, emptyBand((Number(d.bands[d.bands.length - 1]?.minAbwG) || 0) * 2 || 10)],
              }))
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('feedingPlan.addBand')}
          </Button>
          <Button
            disabled={busy || problems.length > 0}
            onClick={() =>
              run(
                () => save({ speciesKey: current.speciesKey, name: draft.name, bands: draft.bands.map(numeric) }),
                t('feedingPlan.saved'),
              )
            }
          >
            <Save className="h-4 w-4" aria-hidden />
            {t('feedingPlan.save')}
          </Button>
          {current.source === 'saved' && (
            <Button variant="ghost" disabled={busy} onClick={() => run(() => reset({ speciesKey: current.speciesKey }), t('feedingPlan.resetDone'))}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {current.hasDefault ? t('feedingPlan.resetToDefault') : t('feedingPlan.remove')}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

const COL = { minAbwG: 'fromAbw', bodyWeightPct: 'bodyWeightPct', feedingsPerDay: 'feedings', pelletMm: 'pellet' }

function numeric(b) {
  return {
    minAbwG: Number(b.minAbwG) || 0,
    bodyWeightPct: Number(b.bodyWeightPct) || 0,
    feedingsPerDay: Number(b.feedingsPerDay) || 0,
    pelletMm: Number(b.pelletMm) || 0,
  }
}
