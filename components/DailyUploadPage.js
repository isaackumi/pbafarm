import React, { useState, useEffect, useMemo } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'
import { dailyRecordService } from '../lib/databaseService'
import {
  Button,
  FormCard,
  FormActions,
  FormSection,
  Field,
  Input,
  Select,
} from './ui'
import DependencyEmpty from './DependencyEmpty'
import FeedTypeField from './FeedTypeField'
import LocationMetaField from './LocationMetaField'
import { useToast } from './Toast'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useAuth } from '../contexts/AuthContext'
import { MORTALITY_CAUSES } from '../lib/farmHealth'

const today = () => new Date().toISOString().split('T')[0]

const newLine = (cageId = '', feedTypeId = '') => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  cageId,
  feedTypeId,
  feedAmount: '',
  mortality: '',
  mortalityCause: 'unknown',
  notes: '',
})

const DEFAULTS = {
  date: today(),
  defaultFeedTypeId: '',
  lines: [],
  allowNegative: false,
  overrideReason: '',
}

const idOf = (x) => x?.id || x?._id

const DailyUploadPage = () => {
  const [cages, setCages] = useState([])
  const [feedTypes, setFeedTypes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lookupsReady, setLookupsReady] = useState(false)
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const { formData, setFormData, handleChange, clear } = usePersistedForm(
    'daily-entry-batch',
    DEFAULTS,
  )
  const lines = Array.isArray(formData.lines) ? formData.lines : []

  useEffect(() => {
    loadLookups()
  }, [])

  const loadLookups = async () => {
    try {
      const [cageRes, feedRes] = await Promise.all([
        cageService.getActiveCages(),
        feedTypeService.getAllFeedTypes(),
      ])
      if (cageRes.data) setCages(cageRes.data)
      if (feedRes.data) {
        setFeedTypes(
          (feedRes.data || []).filter((f) => f.active !== false && !f.deleted_at),
        )
      }
    } catch (err) {
      console.error('Error loading lookups:', err)
    } finally {
      setLookupsReady(true)
    }
  }

  const setLines = (updater) =>
    setFormData((prev) => {
      const current = Array.isArray(prev.lines) ? prev.lines : []
      return { ...prev, lines: typeof updater === 'function' ? updater(current) : updater }
    })

  const updateLine = (key, field, value) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)))

  const removeLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key))

  const selectedCageIds = new Set(lines.map((l) => l.cageId).filter(Boolean))

  const toggleCage = (cageId) => {
    if (selectedCageIds.has(cageId)) {
      setLines((ls) => ls.filter((l) => l.cageId !== cageId))
    } else {
      setLines((ls) => [...ls, newLine(cageId, formData.defaultFeedTypeId)])
    }
  }

  const selectAllCages = () => {
    const missing = cages.map(idOf).filter((id) => !selectedCageIds.has(id))
    setLines((ls) => [
      ...ls,
      ...missing.map((id) => newLine(id, formData.defaultFeedTypeId)),
    ])
  }

  const applyDefaultFeedToAll = () => {
    if (!formData.defaultFeedTypeId) return
    setLines((ls) => ls.map((l) => ({ ...l, feedTypeId: formData.defaultFeedTypeId })))
  }

  const cageName = (id) => cages.find((c) => idOf(c) === id)?.name || 'Unknown cage'

  // Total kg requested per feed type vs stock on hand
  const stockCheck = useMemo(() => {
    const need = {}
    for (const l of lines) {
      const kg = Number(l.feedAmount) || 0
      if (l.feedTypeId && kg > 0) need[l.feedTypeId] = (need[l.feedTypeId] || 0) + kg
    }
    return Object.entries(need).map(([feedTypeId, kg]) => {
      const ft = feedTypes.find((f) => idOf(f) === feedTypeId)
      const onHand = Number(ft?.current_stock ?? ft?.currentStock ?? 0)
      return { feedTypeId, name: ft?.name || 'Feed', need: kg, onHand, short: onHand < kg }
    })
  }, [lines, feedTypes])
  const shortages = stockCheck.filter((s) => s.short)
  const overrideActive = hasRole('admin') && formData.allowNegative

  const totals = lines.reduce(
    (acc, l) => ({
      feed: acc.feed + (Number(l.feedAmount) || 0),
      mort: acc.mort + (Number(l.mortality) || 0),
    }),
    { feed: 0, mort: 0 },
  )

  const validate = () => {
    if (!formData.date) return 'Choose a date'
    if (!lines.length) return 'Select at least one cage'
    const seen = new Set()
    for (const [i, l] of lines.entries()) {
      const label = `Line ${i + 1}${l.cageId ? ` (${cageName(l.cageId)})` : ''}`
      if (!l.cageId) return `${label}: choose a cage`
      if (seen.has(l.cageId)) return `${label}: cage is listed twice`
      seen.add(l.cageId)
      const kg = Number(l.feedAmount) || 0
      const mort = Number(l.mortality) || 0
      if (kg < 0 || mort < 0) return `${label}: values cannot be negative`
      if (kg > 0 && !l.feedTypeId) return `${label}: choose a feed type`
      if (!Number.isInteger(mort)) return `${label}: mortality must be a whole number`
    }
    if (shortages.length && !overrideActive) {
      return shortages
        .map((s) => `Insufficient ${s.name}: have ${s.onHand.toFixed(1)} kg, need ${s.need.toFixed(1)} kg`)
        .join('. ')
    }
    if (formData.allowNegative && !String(formData.overrideReason || '').trim()) {
      return 'Admin override requires a reason'
    }
    return ''
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const problem = validate()
    setError(problem)
    if (problem) return

    setLoading(true)
    try {
      const response = await dailyRecordService.createBatch({
        date: formData.date,
        records: lines.map((l) => {
          const kg = Number(l.feedAmount) || 0
          const mort = Number(l.mortality) || 0
          return {
            cageId: l.cageId,
            feedAmount: kg,
            feedTypeId: l.feedTypeId || undefined,
            mortality: mort,
            mortalityCause: mort > 0 ? l.mortalityCause || 'unknown' : undefined,
            notes: l.notes?.trim() || undefined,
          }
        }),
        allowNegative: overrideActive || undefined,
        overrideReason: overrideActive ? formData.overrideReason : undefined,
      })
      if (response.error) throw response.error

      const count = lines.length
      clear()
      setFormData({ ...DEFAULTS, date: today(), defaultFeedTypeId: formData.defaultFeedTypeId })
      showToast(`${count} daily record${count === 1 ? '' : 's'} saved — stock updated on ledger`, 'success')
      loadLookups()
    } catch (err) {
      console.error('Error saving daily records:', err)
      const msg = (err.message || 'Error saving daily records').replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0]
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  const isInsufficientError = /insufficient/i.test(error || '')

  return (
    <FormCard
      title="Daily entry (batch)"
      subtitle="Pick the cages, fill one line per cage, then save them all at once. Drafts are kept if you refresh."
    >
      {error && (
        <div className="mb-5 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3">
          {error}
          {isInsufficientError && (
            <DependencyEmpty
              className="mt-3 border-signal/20 bg-white/60"
              message="Add stock via a purchase, then save again."
              createKind="purchase"
              createLabel="Record a purchase"
              createProps={{ defaultFeedTypeId: shortages[0]?.feedTypeId }}
              onCreated={() => {
                setError('')
                loadLookups()
                showToast('Purchase recorded — stock updated', 'success')
              }}
            />
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <FormSection title="Date & defaults">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <LocationMetaField />
            </div>
            <Field label="Date" htmlFor="date" required hint="Applies to every line in this batch">
              <Input
                id="date"
                type="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                required
              />
            </Field>
            <div className="space-y-2">
              <FeedTypeField
                id="defaultFeedTypeId"
                name="defaultFeedTypeId"
                label="Default feed type"
                hint="New lines start with this feed type."
                value={formData.defaultFeedTypeId}
                onChange={handleChange}
                feedTypes={feedTypes}
                ready={lookupsReady}
                onFeedTypesChanged={loadLookups}
                onCreated={(result) => {
                  loadLookups()
                  if (result?.kind === 'feedType' && result.id) {
                    setFormData((prev) => ({ ...prev, defaultFeedTypeId: result.id }))
                  }
                }}
              />
              {formData.defaultFeedTypeId && lines.length > 0 && (
                <Button variant="ghost" size="sm" onClick={applyDefaultFeedToAll}>
                  Apply to all lines
                </Button>
              )}
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Cages"
          description="Tap cages to add or remove a line for each."
        >
          {lookupsReady && cages.length === 0 ? (
            <DependencyEmpty
              message="Daily entry needs an active cage. Create a cage, then stock it (and approve if required) so the cage becomes active."
              createKind="cage"
              createLabel="Create a cage"
              secondaryCreateKind="stocking"
              secondaryCreateLabel="Stock a cage"
              onCreated={(result) => {
                loadLookups()
                if (result?.kind === 'stocking') {
                  showToast(
                    'Stocking created. After approval (if required), the cage will appear here.',
                    'success',
                  )
                }
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {cages.map((cage) => {
                  const id = idOf(cage)
                  const on = selectedCageIds.has(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleCage(id)}
                      aria-pressed={on}
                      className={`min-h-10 px-3 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                        on
                          ? 'bg-lagoon-950 text-white border-transparent dark:bg-[#e4e4e7] dark:text-[#18181b]'
                          : 'bg-surface text-chart-ink border-foam-deep hover:border-lagoon-700'
                      }`}
                    >
                      {cage.name}
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={selectAllCages} disabled={!cages.length}>
                  Select all
                </Button>
                {lines.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setLines([])}>
                    Clear all
                  </Button>
                )}
              </div>
            </>
          )}
        </FormSection>

        <FormSection
          title={`Lines${lines.length ? ` (${lines.length})` : ''}`}
          description="Feed amounts deduct stock through the inventory ledger. Leave feed or mortality blank for 0."
        >
          {lines.length === 0 ? (
            <p className="text-sm text-muted">No cages selected yet.</p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, i) => {
                const mort = Number(line.mortality) || 0
                return (
                  <div
                    key={line.key}
                    className="rounded-xl border border-foam-deep p-4 grid grid-cols-2 md:grid-cols-12 gap-3 items-end"
                  >
                    <Field label={`#${i + 1} Cage`} htmlFor={`cage-${line.key}`} className="col-span-2 md:col-span-3">
                      <Select
                        id={`cage-${line.key}`}
                        value={line.cageId}
                        onChange={(e) => updateLine(line.key, 'cageId', e.target.value)}
                      >
                        <option value="">Choose a cage…</option>
                        {cages.map((c) => {
                          const id = idOf(c)
                          const taken = id !== line.cageId && selectedCageIds.has(id)
                          return (
                            <option key={id} value={id} disabled={taken}>
                              {c.name}
                            </option>
                          )
                        })}
                      </Select>
                    </Field>
                    <Field label="Feed type" htmlFor={`feed-${line.key}`} className="col-span-2 md:col-span-3">
                      <Select
                        id={`feed-${line.key}`}
                        value={line.feedTypeId}
                        onChange={(e) => updateLine(line.key, 'feedTypeId', e.target.value)}
                      >
                        <option value="">—</option>
                        {feedTypes.map((f) => (
                          <option key={idOf(f)} value={idOf(f)}>
                            {f.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Feed (kg)" htmlFor={`kg-${line.key}`} className="md:col-span-2">
                      <Input
                        id={`kg-${line.key}`}
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        placeholder="0"
                        value={line.feedAmount}
                        onChange={(e) => updateLine(line.key, 'feedAmount', e.target.value)}
                        className="font-data"
                      />
                    </Field>
                    <Field label="Mortality" htmlFor={`mort-${line.key}`} className="md:col-span-2">
                      <Input
                        id={`mort-${line.key}`}
                        type="number"
                        inputMode="numeric"
                        step="1"
                        min="0"
                        placeholder="0"
                        value={line.mortality}
                        onChange={(e) => updateLine(line.key, 'mortality', e.target.value)}
                        className="font-data"
                      />
                    </Field>
                    <div className="col-span-2 md:col-span-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(line.key)}
                        aria-label={`Remove line ${i + 1}`}
                      >
                        <Trash2 className="w-4 h-4" />
                        Remove
                      </Button>
                    </div>
                    {mort > 0 && (
                      <Field label="Mortality cause" htmlFor={`cause-${line.key}`} className="col-span-2 md:col-span-3">
                        <Select
                          id={`cause-${line.key}`}
                          value={line.mortalityCause || 'unknown'}
                          onChange={(e) => updateLine(line.key, 'mortalityCause', e.target.value)}
                        >
                          {MORTALITY_CAUSES.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                    <Field
                      label="Notes"
                      htmlFor={`notes-${line.key}`}
                      className={`col-span-2 ${mort > 0 ? 'md:col-span-9' : 'md:col-span-12'}`}
                    >
                      <Input
                        id={`notes-${line.key}`}
                        value={line.notes}
                        onChange={(e) => updateLine(line.key, 'notes', e.target.value)}
                        placeholder="Observations, weather, unusual events…"
                      />
                    </Field>
                  </div>
                )
              })}
              <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, newLine('', formData.defaultFeedTypeId)])}>
                <Plus className="w-4 h-4" />
                Add line
              </Button>
            </div>
          )}

          {stockCheck.length > 0 && (
            <div className="mt-5 rounded-xl border border-foam-deep p-4 text-sm space-y-1">
              <p className="font-semibold text-chart-ink">Feed for this batch</p>
              {stockCheck.map((s) => (
                <p key={s.feedTypeId} className={s.short ? 'text-signal' : 'text-muted'}>
                  {s.name}: <span className="font-data">{s.need.toFixed(1)} kg</span> of{' '}
                  <span className="font-data">{s.onHand.toFixed(1)} kg</span> on hand
                  {s.short ? ' — not enough stock' : ''}
                </p>
              ))}
            </div>
          )}

          {shortages.length > 0 && (
            <DependencyEmpty
              className="mt-4"
              message="Not enough stock for this batch. Record a purchase first."
              createKind="purchase"
              createLabel="Record a purchase"
              createProps={{ defaultFeedTypeId: shortages[0].feedTypeId }}
              onCreated={() => {
                setError('')
                loadLookups()
                showToast('Purchase recorded — stock updated', 'success')
              }}
            />
          )}

          {hasRole('admin') && shortages.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-chart-ink">
                <input
                  type="checkbox"
                  name="allowNegative"
                  checked={Boolean(formData.allowNegative)}
                  onChange={handleChange}
                  className="rounded border-zinc-300"
                />
                Admin override (allow insufficient stock)
              </label>
              {formData.allowNegative && (
                <Field label="Override reason" htmlFor="overrideReason" required>
                  <Input
                    id="overrideReason"
                    name="overrideReason"
                    value={formData.overrideReason || ''}
                    onChange={handleChange}
                    required
                    placeholder="Why is this override needed?"
                  />
                </Field>
              )}
            </div>
          )}
        </FormSection>

        <FormActions>
          {lines.length > 0 && (
            <p className="text-sm text-muted mr-auto font-data">
              {lines.length} cage{lines.length === 1 ? '' : 's'} · {totals.feed.toFixed(1)} kg feed ·{' '}
              {totals.mort} mortality
            </p>
          )}
          <Button
            type="submit"
            disabled={
              loading ||
              lines.length === 0 ||
              (shortages.length > 0 && !overrideActive)
            }
            size="lg"
          >
            {loading
              ? 'Saving…'
              : `Save ${lines.length || ''} record${lines.length === 1 ? '' : 's'}`.replace('  ', ' ')}
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}

export default DailyUploadPage
