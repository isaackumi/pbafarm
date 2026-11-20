import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { Plus } from 'lucide-react'
import { Button, KpiStrip, LoadingState, Pill, Textarea } from './ui'
import { localToday } from '../lib/format'

const today = () => localToday()
const CARD = 'flex min-w-0 flex-col rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]'
// Paper 52 destination pill and numeric cells.
const PILL_SELECT =
  'h-[30px] rounded-pill border border-line-strong bg-transparent px-3 text-[13px] leading-4 text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
const CELL_INPUT =
  'h-[30px] w-[80px] shrink-0 rounded-[8px] border border-line-strong bg-bg px-2 text-right text-[14px] leading-[18px] text-text tabular-nums placeholder:text-faint focus:border-cyan focus:outline-none'
const DOTS = ['bg-pearl-pink', 'bg-pearl-cyan', 'bg-muted', 'bg-warn', 'bg-good']
const newGrade = (cageId = '') => ({
  key: Math.random().toString(36).slice(2),
  cageId,
  quantity: '',
  abw: '',
  batchNumber: '',
})

/**
 * Grade every fish in a cage into size grades (doc 05 §7.3). Each grade
 * becomes a child batch in the cage it goes to; culls are recorded as deaths;
 * fish the grades do not account for are recorded as unaccounted.
 */
export default function GradingForm({ initialCageId = '', formId = 'grading-form', aside = null }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const cages = useQuery(api.cages.list, user ? {} : 'skip')
  const grade = useMutation(api.batches.grade)

  const [cageId, setCageId] = useState(initialCageId)
  const [date, setDate] = useState(today())
  const [grades, setGrades] = useState([newGrade(initialCageId), newGrade()])
  const [culls, setCulls] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const list = useMemo(() => cages || [], [cages])
  const source = list.find((c) => String(c.id) === String(cageId))
  const available = source?.current_count ?? 0
  const graded = grades.reduce((s, g) => s + (Number(g.quantity) || 0), 0) + (Number(culls) || 0)
  const gap = available - graded
  // A grade can go back into the graded cage or into an empty one.
  const targets = list.filter((c) => String(c.id) === String(cageId) || (c.current_count ?? 0) === 0)
  const setGrade = (key, patch) => setGrades((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)))

  const submit = async (e) => {
    e.preventDefault()
    if (saving) return
    setError('')
    const filled = grades.filter((g) => g.cageId || g.quantity || g.abw)
    if (!cageId) return setError('Choose the cage being graded')
    if (!filled.length) return setError('Add at least one grade')
    if (filled.some((g) => !g.cageId || !(Number.isInteger(Number(g.quantity)) && Number(g.quantity) > 0) || !(Number(g.abw) > 0))) {
      return setError('Each grade needs a cage, a whole number of fish and an average weight')
    }
    if (new Set(filled.map((g) => g.cageId)).size !== filled.length) return setError('Each cage can take one grade')
    setSaving(true)
    try {
      const r = await grade({
        cageId,
        date,
        outputs: filled.map((g) => ({
          cageId: g.cageId,
          quantity: Number(g.quantity),
          abw: Number(g.abw),
          batchNumber: g.batchNumber.trim() || undefined,
        })),
        culls: Number(culls) || 0,
        reason: reason.trim() || undefined,
      })
      showToast(
        'success',
        r.unaccounted
          ? `Graded into ${r.childBatchIds.length} batches; ${r.unaccounted.toLocaleString()} fish unaccounted`
          : `Graded into ${r.childBatchIds.length} batches`,
      )
      router.push(`/batches/${r.childBatchIds[0]}`)
    } catch (err) {
      const message = errorMessage(err, 'Could not save the grading')
      setError(message)
      showToast('error', message)
    } finally {
      setSaving(false)
    }
  }

  const filledGrades = grades.filter((g) => Number(g.quantity) > 0)
  const gradedFish = filledGrades.reduce((sum, g) => sum + Number(g.quantity), 0)
  const gradedMass = filledGrades.reduce((sum, g) => sum + Number(g.quantity) * (Number(g.abw) || 0), 0)
  const avgAbw = gradedFish ? gradedMass / gradedFish : null

  if (cages === undefined) {
    return (
      <div className="flex flex-col gap-[28px]">
        <div className={CARD}>
          <LoadingState label="Loading cages…" />
        </div>
        {aside}
      </div>
    )
  }

  return (
    <form id={formId} onSubmit={submit} className="flex flex-col gap-[28px]">
      {/* Paper 52 KPI strip: the cage being graded and how the counts add up. */}
      <KpiStrip
        items={[
          {
            key: 'source',
            label: 'Source',
            value: source ? source.name : '—',
            suffix: source ? `${available.toLocaleString()} fish` : undefined,
          },
          {
            key: 'counted',
            label: 'Fish counted',
            value: graded.toLocaleString(),
            suffix: source ? `of ~${available.toLocaleString()}` : undefined,
          },
          {
            key: 'abw',
            label: 'Avg weight',
            value: avgAbw == null ? '—' : `${Math.round(avgAbw).toLocaleString()} g`,
            suffix: gradedMass ? `${(gradedMass / 1e6).toFixed(2)} t biomass` : undefined,
          },
          {
            key: 'gap',
            label: 'Unaccounted',
            value: source ? Math.max(0, gap).toLocaleString() : '—',
            valueTone: source && gap < 0 ? 'alert' : undefined,
            suffix: source && gap < 0 ? `${(-gap).toLocaleString()} over` : undefined,
            suffixTone: 'alert',
          },
        ]}
      />

      <div className="flex flex-col items-start gap-5 xl:flex-row">
        <div className="flex w-full min-w-0 flex-col gap-5 xl:w-[700px] xl:shrink-0">
          {/* Size-class split (Paper GB1-0) */}
          <section className="flex flex-col rounded-card border border-line bg-surface shadow-[var(--shadow-card)]" aria-labelledby="gr-split-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="gr-split-title" className="text-[17px] font-semibold leading-[22px] text-text">
                  Size-class split
                </h2>
                <label htmlFor="gr-cage" className="sr-only">
                  Cage being graded
                </label>
                <select
                  id="gr-cage"
                  required
                  value={cageId}
                  onChange={(e) => {
                    setCageId(e.target.value)
                    setGrades((gs) => gs.map((g, i) => (i === 0 ? { ...g, cageId: e.target.value } : g)))
                  }}
                  className={PILL_SELECT}
                >
                  <option value="">Choose a cage</option>
                  {list
                    .filter((c) => (c.current_count ?? 0) > 0)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({(c.current_count ?? 0).toLocaleString()} fish)
                      </option>
                    ))}
                </select>
                <label htmlFor="gr-date" className="sr-only">
                  Date
                </label>
                <input
                  id="gr-date"
                  type="date"
                  required
                  value={date}
                  max={today()}
                  onChange={(e) => setDate(e.target.value)}
                  className={PILL_SELECT}
                />
              </div>
              <button
                type="button"
                disabled={grades.length >= 20}
                onClick={() => setGrades((gs) => [...gs, newGrade()])}
                className="inline-flex items-center gap-[6px] rounded-sm text-[13px] leading-4 text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
              >
                <Plus size={14} strokeWidth={2} aria-hidden />
                Add class
              </button>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                <div className="flex items-center gap-6 px-6 py-3 text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint" aria-hidden>
                  <div className="grow basis-0">Class</div>
                  <div className="w-[80px] shrink-0 text-right">Count</div>
                  <div className="w-[80px] shrink-0 text-right">Avg wt</div>
                  <div className="w-[150px] shrink-0">Destination</div>
                </div>
                <ul>
                  {grades.map((g, i) => (
                    <li key={g.key} className="flex items-center gap-6 border-t border-line px-6 py-4">
                      <div className="flex min-w-0 grow basis-0 items-center gap-3">
                        <span className={`size-[10px] shrink-0 rounded-pill ${DOTS[i % DOTS.length]}`} aria-hidden />
                        <div className="flex min-w-0 flex-col gap-[2px]">
                          <p className="text-[14px] leading-[18px] text-text">Grade {i + 1}</p>
                          <div className="flex items-center gap-2 text-xs leading-4 text-muted">
                            <label htmlFor={`gr-bn-${g.key}`} className="sr-only">
                              Batch number (optional)
                            </label>
                            <input
                              id={`gr-bn-${g.key}`}
                              value={g.batchNumber}
                              placeholder="Batch number (optional)"
                              onChange={(e) => setGrade(g.key, { batchNumber: e.target.value })}
                              className="w-full min-w-0 max-w-[180px] rounded-[4px] bg-transparent px-1 text-xs leading-4 text-muted placeholder:text-faint focus:text-text focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
                            />
                            <span aria-hidden>·</span>
                            <button
                              type="button"
                              disabled={grades.length === 1}
                              onClick={() => setGrades((gs) => gs.filter((x) => x.key !== g.key))}
                              className="shrink-0 rounded-sm hover:text-alert focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                      <label htmlFor={`gr-qty-${g.key}`} className="sr-only">
                        Grade {i + 1} fish
                      </label>
                      <input
                        id={`gr-qty-${g.key}`}
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        placeholder="0"
                        value={g.quantity}
                        onChange={(e) => setGrade(g.key, { quantity: e.target.value })}
                        className={CELL_INPUT}
                      />
                      <label htmlFor={`gr-abw-${g.key}`} className="sr-only">
                        Grade {i + 1} average weight (g)
                      </label>
                      <input
                        id={`gr-abw-${g.key}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.1"
                        placeholder="g"
                        value={g.abw}
                        onChange={(e) => setGrade(g.key, { abw: e.target.value })}
                        className={CELL_INPUT}
                      />
                      <div className="flex w-[150px] shrink-0">
                        <label htmlFor={`gr-to-${g.key}`} className="sr-only">
                          Grade {i + 1} goes to
                        </label>
                        <select
                          id={`gr-to-${g.key}`}
                          value={g.cageId}
                          onChange={(e) => setGrade(g.key, { cageId: e.target.value })}
                          className={`${PILL_SELECT} max-w-full`}
                        >
                          <option value="">Choose a cage</option>
                          {targets.map((c) => (
                            <option key={c.id} value={c.id}>
                              {String(c.id) === String(cageId) ? `Stay in ${c.name}` : `Move to ${c.name}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-6 rounded-b-card border-t border-line bg-[color-mix(in_oklab,var(--bg)_50%,var(--surface))] px-6 py-4">
                  <div className="flex grow basis-0 flex-wrap items-center gap-2 text-[13px] leading-4 text-muted">
                    <span>Total ·</span>
                    <label htmlFor="gr-culls" className="sr-only">
                      Culled (recorded as deaths)
                    </label>
                    <input
                      id="gr-culls"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={culls}
                      onChange={(e) => setCulls(e.target.value)}
                      className="h-[26px] w-16 rounded-[8px] border border-line-strong bg-bg px-2 text-right text-[13px] leading-4 text-text tabular-nums focus:border-cyan focus:outline-none"
                    />
                    <span>culls logged as mortality</span>
                  </div>
                  <div className="w-[80px] shrink-0 text-right text-[14px] font-semibold leading-[18px] text-text tabular-nums">
                    {graded.toLocaleString()}
                  </div>
                  <div className="w-[80px] shrink-0 text-right text-[14px] font-semibold leading-[18px] text-text tabular-nums">
                    {avgAbw == null ? '—' : `${Math.round(avgAbw).toLocaleString()} g`}
                  </div>
                  <div className="flex w-[150px] shrink-0">
                    {source &&
                      (gap === 0 ? (
                        <Pill tone="green">Counts balance</Pill>
                      ) : gap > 0 ? (
                        <Pill tone="amber">{gap.toLocaleString()} unaccounted</Pill>
                      ) : (
                        <Pill tone="red">{(-gap).toLocaleString()} over</Pill>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4 rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold leading-[18px] text-text">
                <label htmlFor="gr-reason">Notes</label>
              </h2>
              <p className="text-xs leading-4 text-muted">Each grade becomes its own batch, linked to the batch it came from.</p>
            </div>
            <Textarea id="gr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            {source && (
              <p className={`text-[13px] leading-4 tabular-nums ${gap < 0 ? 'text-alert' : 'text-muted'}`}>
                {graded.toLocaleString()} of {available.toLocaleString()} fish graded or culled
                {gap > 0 ? `; ${gap.toLocaleString()} will be recorded as unaccounted` : ''}
                {gap < 0 ? `; ${(-gap).toLocaleString()} more than on record` : ''}
              </p>
            )}
            {error && (
              <p className="text-sm text-alert" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end sm:hidden">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save grading'}
              </Button>
            </div>
          </section>
        </div>
        {aside}
      </div>
    </form>
  )
}
