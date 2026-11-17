import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/router'
import { Trash2, Plus, Copy, CloudOff, RefreshCw, QrCode } from 'lucide-react'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'
import { dailyRecordService } from '../lib/databaseService'
import {
  enqueue,
  listOutbox,
  removeFromOutbox,
  flushOutbox,
  isNetworkError,
  cleanError,
} from '../lib/offlineOutbox'
import {
  Button,
  FormCard,
  FormActions,
  FormSection,
  Field,
  Input,
  Select,
  TabBar,
} from './ui'
import DependencyEmpty from './DependencyEmpty'
import FeedTypeField from './FeedTypeField'
import LocationMetaField from './LocationMetaField'
import Waterline from './Waterline'
import { useToast } from './Toast'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useAuth } from '../contexts/AuthContext'
import { MORTALITY_CAUSES } from '../lib/farmHealth'

const isoDay = (d = new Date()) => d.toISOString().split('T')[0]
const dayBefore = (iso) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return isoDay(d)
}

const newLine = (cageId = '', feedTypeId = '', extra = {}) => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  cageId,
  feedTypeId,
  feedQty: '',
  mortality: '',
  mortalityCause: 'unknown',
  notes: '',
  dissolvedOxygen: '',
  temperatureC: '',
  ...extra,
})

const DEFAULTS = {
  date: isoDay(),
  defaultFeedTypeId: '',
  feedUnit: 'kg',
  showWater: false,
  lines: [],
  allowNegative: false,
  overrideReason: '',
}

const idOf = (x) => x?.id || x?._id
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const optNum = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v))

const DailyUploadPage = () => {
  const router = useRouter()
  const [cages, setCages] = useState([])
  const [feedTypes, setFeedTypes] = useState([])
  const [loggedCageIds, setLoggedCageIds] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState('')
  const [errorLine, setErrorLine] = useState(null)
  const [lookupsReady, setLookupsReady] = useState(false)
  const [outbox, setOutbox] = useState([])
  const [online, setOnline] = useState(true)
  const prefilled = useRef(false)
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const { formData, setFormData, handleChange, clear } = usePersistedForm(
    'daily-entry-batch',
    DEFAULTS,
    { storage: 'local' },
  )
  const lines = Array.isArray(formData.lines) ? formData.lines : []
  const unit = formData.feedUnit === 'bags' ? 'bags' : 'kg'

  const loadLookups = useCallback(async () => {
    const CACHE_KEY = 'pbafarm:daily-entry:lookups'
    try {
      const [cageRes, feedRes] = await Promise.all([
        cageService.getActiveCages(),
        feedTypeService.getAllFeedTypes(),
      ])
      const ok = !cageRes.error && !feedRes.error
      if (ok) {
        const nextCages = cageRes.data || []
        const nextFeed = (feedRes.data || []).filter(
          (f) => f.active !== false && !f.deleted_at,
        )
        setCages(nextCages)
        setFeedTypes(nextFeed)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ cages: nextCages, feedTypes: nextFeed }))
        } catch {
          // storage blocked; the live lists still work
        }
        return
      }
      // No signal: fall back to the last lists this device saw.
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      if (cached) {
        setCages(cached.cages || [])
        setFeedTypes(cached.feedTypes || [])
      }
    } catch (err) {
      console.error('Error loading lookups:', err)
    } finally {
      setLookupsReady(true)
    }
  }, [])

  const loadLogged = useCallback(async (date) => {
    if (!date) return
    const { data } = await dailyRecordService.listForDate(date)
    setLoggedCageIds(new Set((data || []).map((r) => r.cage_id)))
  }, [])

  useEffect(() => {
    loadLookups()
    // A stale empty draft should open on today, not on the day it was started.
    setFormData((prev) =>
      (prev.lines || []).length === 0 ? { ...prev, date: isoDay() } : prev,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadLogged(formData.date)
  }, [formData.date, loadLogged])

  // ---- lines -------------------------------------------------------------

  const setLines = (updater) =>
    setFormData((prev) => {
      const current = Array.isArray(prev.lines) ? prev.lines : []
      return { ...prev, lines: typeof updater === 'function' ? updater(current) : updater }
    })

  const updateLine = (key, field, value) => {
    setErrorLine(null)
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)))
  }

  const removeLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key))

  const selectedCageIds = new Set(lines.map((l) => l.cageId).filter(Boolean))

  const addCages = useCallback(
    (ids) =>
      setLines((ls) => {
        const have = new Set(ls.map((l) => l.cageId))
        const add = ids.filter((id) => id && !have.has(id))
        return [...ls, ...add.map((id) => newLine(id, formData.defaultFeedTypeId))]
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formData.defaultFeedTypeId],
  )

  // QR codes and cage pages link here as ?cage=<id> (or ?cages=a,b).
  useEffect(() => {
    if (prefilled.current || !lookupsReady || !router.isReady) return
    prefilled.current = true
    const raw = [router.query.cage, router.query.cages].flat().filter(Boolean).join(',')
    if (!raw) return
    const known = new Set(cages.map(idOf))
    const ids = raw.split(',').map((s) => s.trim()).filter((id) => known.has(id))
    if (ids.length) addCages(ids)
  }, [lookupsReady, router.isReady, router.query, cages, addCages])

  const toggleCage = (cageId) => {
    if (selectedCageIds.has(cageId)) {
      setLines((ls) => ls.filter((l) => l.cageId !== cageId))
    } else {
      addCages([cageId])
    }
  }

  const openCages = cages.filter((c) => !loggedCageIds.has(idOf(c)))

  const selectAllCages = () => addCages(openCages.map(idOf))

  const applyDefaultFeedToAll = () => {
    if (!formData.defaultFeedTypeId) return
    setLines((ls) => ls.map((l) => ({ ...l, feedTypeId: formData.defaultFeedTypeId })))
  }

  const feedTypeById = useMemo(
    () => new Map(feedTypes.map((f) => [idOf(f), f])),
    [feedTypes],
  )
  const bagSize = (feedTypeId) =>
    Number(feedTypeById.get(feedTypeId)?.bag_size_kg) || 20
  const kgOf = (line) =>
    unit === 'bags' ? num(line.feedQty) * bagSize(line.feedTypeId) : num(line.feedQty)

  const switchUnit = (next) => {
    if (next === unit) return
    // Convert what's typed so switching never changes the amount fed.
    setFormData((prev) => ({
      ...prev,
      feedUnit: next,
      lines: (prev.lines || []).map((l) => {
        if (l.feedQty === '' || l.feedQty == null) return l
        const size = bagSize(l.feedTypeId)
        const v = num(l.feedQty)
        const converted = next === 'bags' ? v / size : v * size
        return { ...l, feedQty: String(Math.round(converted * 100) / 100) }
      }),
    }))
  }

  // "Same as yesterday": copy each cage's feed type and amount from the day before.
  const copyYesterday = async () => {
    setCopying(true)
    try {
      const prevDate = dayBefore(formData.date)
      const { data, error: err } = await dailyRecordService.listForDate(prevDate)
      if (err) throw err
      const active = new Set(cages.map(idOf))
      const rows = (data || []).filter(
        (r) => active.has(r.cage_id) && !loggedCageIds.has(r.cage_id),
      )
      if (!rows.length) {
        showToast(`Nothing logged on ${prevDate} to copy`, 'info')
        return
      }
      setLines((ls) => {
        const byCage = new Map(ls.map((l) => [l.cageId, l]))
        for (const r of rows) {
          const kg = num(r.feed_amount)
          const qty =
            unit === 'bags' ? Math.round((kg / bagSize(r.feed_type_id)) * 100) / 100 : kg
          const patch = {
            feedTypeId: r.feed_type_id || '',
            feedQty: kg > 0 ? String(qty) : '',
          }
          const existing = byCage.get(r.cage_id)
          byCage.set(
            r.cage_id,
            existing ? { ...existing, ...patch } : newLine(r.cage_id, '', patch),
          )
        }
        return [...byCage.values()]
      })
      showToast(`Copied feed for ${rows.length} cage${rows.length === 1 ? '' : 's'} from ${prevDate}`, 'success')
    } catch (err) {
      showToast(cleanError(err), 'error')
    } finally {
      setCopying(false)
    }
  }

  const cageName = (id) => cages.find((c) => idOf(c) === id)?.name || 'Unknown cage'

  // ---- checks ------------------------------------------------------------

  const stockCheck = useMemo(() => {
    const need = {}
    for (const l of lines) {
      const kg = kgOf(l)
      if (l.feedTypeId && kg > 0) need[l.feedTypeId] = (need[l.feedTypeId] || 0) + kg
    }
    return Object.entries(need).map(([feedTypeId, kg]) => {
      const ft = feedTypeById.get(feedTypeId)
      const onHand = num(ft?.current_stock ?? ft?.currentStock)
      return { feedTypeId, name: ft?.name || 'Feed', need: kg, onHand, short: onHand < kg }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, feedTypeById, unit])
  const shortages = stockCheck.filter((s) => s.short)
  const overrideActive = hasRole('admin') && formData.allowNegative

  const totals = lines.reduce(
    (acc, l) => ({ feed: acc.feed + kgOf(l), mort: acc.mort + num(l.mortality) }),
    { feed: 0, mort: 0 },
  )

  const validate = () => {
    if (!formData.date) return ['Choose a date', null]
    if (!lines.length) return ['Select at least one cage', null]
    const seen = new Set()
    for (const [i, l] of lines.entries()) {
      const label = `Line ${i + 1}${l.cageId ? ` (${cageName(l.cageId)})` : ''}`
      if (!l.cageId) return [`${label}: choose a cage`, i]
      if (seen.has(l.cageId)) return [`${label}: cage is listed twice`, i]
      seen.add(l.cageId)
      if (loggedCageIds.has(l.cageId)) {
        return [`${label}: already logged for ${formData.date}. Remove the line or change the date.`, i]
      }
      const kg = kgOf(l)
      const mort = num(l.mortality)
      if (kg < 0 || mort < 0) return [`${label}: values cannot be negative`, i]
      if (kg > 0 && !l.feedTypeId) return [`${label}: choose a feed type`, i]
      if (!Number.isInteger(mort)) return [`${label}: mortality must be a whole number`, i]
    }
    if (shortages.length && !overrideActive) {
      return [
        shortages
          .map((s) => `Not enough ${s.name}: ${s.onHand.toFixed(1)} kg on hand, ${s.need.toFixed(1)} kg needed`)
          .join('. '),
        null,
      ]
    }
    if (formData.allowNegative && !String(formData.overrideReason || '').trim()) {
      return ['Admin override needs a reason', null]
    }
    return ['', null]
  }

  // ---- offline outbox ----------------------------------------------------

  const refreshOutbox = useCallback(() => setOutbox(listOutbox()), [])

  const sendQueued = useCallback(async () => {
    if (!listOutbox().length) return
    const { sent, failed } = await flushOutbox((payload) =>
      dailyRecordService.createBatch(payload),
    )
    refreshOutbox()
    if (sent) {
      showToast(`Sent ${sent} saved batch${sent === 1 ? '' : 'es'}`, 'success')
      loadLookups()
      loadLogged(formData.date)
    }
    if (failed) showToast(`${failed} saved batch${failed === 1 ? '' : 'es'} need attention`, 'error')
  }, [refreshOutbox, showToast, loadLookups, loadLogged, formData.date])

  useEffect(() => {
    refreshOutbox()
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    const goOnline = () => {
      setOnline(true)
      sendQueued()
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    window.addEventListener('pbafarm:outbox', refreshOutbox)
    if (navigator.onLine) sendQueued()
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('pbafarm:outbox', refreshOutbox)
    }
  }, [refreshOutbox, sendQueued])

  // ---- submit ------------------------------------------------------------

  const resetForm = () => {
    clear()
    setFormData({
      ...DEFAULTS,
      date: isoDay(),
      defaultFeedTypeId: formData.defaultFeedTypeId,
      feedUnit: unit,
      showWater: formData.showWater,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const [problem, lineIdx] = validate()
    setError(problem)
    setErrorLine(lineIdx)
    if (problem) return

    const payload = {
      date: formData.date,
      records: lines.map((l) => {
        const kg = Math.round(kgOf(l) * 1000) / 1000
        const mort = num(l.mortality)
        return {
          cageId: l.cageId,
          feedAmount: kg,
          feedTypeId: l.feedTypeId || undefined,
          mortality: mort,
          mortalityCause: mort > 0 ? l.mortalityCause || 'unknown' : undefined,
          notes: l.notes?.trim() || undefined,
          dissolvedOxygen: formData.showWater ? optNum(l.dissolvedOxygen) : undefined,
          temperatureC: formData.showWater ? optNum(l.temperatureC) : undefined,
        }
      }),
      allowNegative: overrideActive || undefined,
      overrideReason: overrideActive ? formData.overrideReason : undefined,
    }
    const count = lines.length
    const summary = `${formData.date} · ${count} cage${count === 1 ? '' : 's'}`

    const queueIt = () => {
      enqueue(payload, summary)
      resetForm()
      showToast('No connection. Saved on this device and will send when you are back online', 'info')
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      queueIt()
      return
    }

    setLoading(true)
    try {
      const response = await dailyRecordService.createBatch(payload)
      if (response.error) throw response.error
      resetForm()
      showToast(`Saved ${count} daily record${count === 1 ? '' : 's'}. Stock updated`, 'success')
      loadLookups()
      loadLogged(formData.date)
    } catch (err) {
      if (isNetworkError(err)) {
        queueIt()
        return
      }
      console.error('Error saving daily records:', err)
      const msg = cleanError(err)
      const m = /^Line (\d+)/.exec(msg)
      setErrorLine(m ? Number(m[1]) - 1 : null)
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  const isInsufficientError = /not enough|insufficient/i.test(error || '')

  // ---- render ------------------------------------------------------------

  return (
    <FormCard
      title="Daily entry"
      subtitle="Pick the cages, fill one line each, then save them together. Your draft stays on this device."
    >
      {(!online || outbox.length > 0) && (
        <div className="mb-5 rounded-lg border border-foam-deep bg-foam p-3 text-sm space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <CloudOff size={16} className="text-muted shrink-0" aria-hidden />
            <span className="text-chart-ink">
              {!online ? 'Offline. Entries will be saved on this device. ' : ''}
              {outbox.length > 0 &&
                `${outbox.length} batch${outbox.length === 1 ? '' : 'es'} waiting to send`}
            </span>
            {online && outbox.length > 0 && (
              <Button variant="secondary" size="sm" onClick={sendQueued} className="ml-auto">
                <RefreshCw size={14} aria-hidden />
                Send now
              </Button>
            )}
          </div>
          {outbox
            .filter((i) => i.lastError)
            .map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 text-signal">
                <span>
                  {i.summary}: {i.lastError}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    removeFromOutbox(i.id)
                    refreshOutbox()
                  }}
                >
                  Discard
                </Button>
              </div>
            ))}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-5 text-sm text-signal border border-signal/20 bg-signal/10 rounded-lg p-3"
        >
          {error}
          {isInsufficientError && (
            <DependencyEmpty
              className="mt-3 border-signal/20 bg-surface"
              message="Add stock with a purchase, then save again."
              createKind="purchase"
              createLabel="Record a purchase"
              createProps={{ defaultFeedTypeId: shortages[0]?.feedTypeId }}
              onCreated={() => {
                setError('')
                loadLookups()
                showToast('Purchase recorded. Stock updated', 'success')
              }}
            />
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <FormSection title="Date and defaults">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <LocationMetaField />
            </div>
            <Field label="Date" htmlFor="date" required hint="Applies to every line">
              <Input
                id="date"
                type="date"
                name="date"
                max={isoDay()}
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
                hint="New lines start with this feed"
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
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 md:col-span-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted">Feed in</span>
                <TabBar
                  tabs={[
                    { id: 'kg', label: 'kg' },
                    { id: 'bags', label: 'Bags' },
                  ]}
                  active={unit}
                  onChange={switchUnit}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-chart-ink min-h-11">
                <input
                  type="checkbox"
                  name="showWater"
                  checked={Boolean(formData.showWater)}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-input-border"
                />
                Record water quality (DO, temperature)
              </label>
            </div>
          </div>
        </FormSection>

        <FormSection title="Cages" description="Tap a cage to add a line for it">
          {lookupsReady && cages.length === 0 ? (
            <DependencyEmpty
              message="Daily entry needs an active cage. Create a cage, then stock it (and approve if required) so it becomes active."
              createKind="cage"
              createLabel="Create a cage"
              secondaryCreateKind="stocking"
              secondaryCreateLabel="Stock a cage"
              onCreated={(result) => {
                loadLookups()
                if (result?.kind === 'stocking') {
                  showToast('Stocking created. After approval the cage appears here', 'success')
                }
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {cages.map((cage) => {
                  const id = idOf(cage)
                  const on = selectedCageIds.has(id)
                  const logged = loggedCageIds.has(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleCage(id)}
                      disabled={logged}
                      aria-pressed={on}
                      title={logged ? `Already logged for ${formData.date}` : undefined}
                      className={`min-h-11 min-w-[5.5rem] px-3 pt-2 pb-1.5 rounded-lg border text-left text-sm transition-colors disabled:cursor-not-allowed ${
                        on
                          ? 'bg-lagoon-950 text-white border-transparent dark:bg-[#e4e4e7] dark:text-[#18181b]'
                          : logged
                            ? 'bg-foam text-muted border-foam-deep'
                            : 'bg-surface text-chart-ink border-foam-deep hover:border-lake'
                      }`}
                    >
                      <span className="block font-medium leading-5">{cage.name}</span>
                      {logged ? (
                        <span className="block text-xs leading-4">Logged</span>
                      ) : (
                        <Waterline
                          count={cage.current_count}
                          capacity={cage.capacity}
                          inverted={on}
                          className="mt-1"
                        />
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={selectAllCages}
                  disabled={!openCages.length}
                >
                  Select all open
                </Button>
                <Button variant="secondary" size="sm" onClick={copyYesterday} disabled={copying || !cages.length}>
                  <Copy size={14} aria-hidden />
                  {copying ? 'Copying…' : 'Same as yesterday'}
                </Button>
                {lines.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setLines([])}>
                    Clear all
                  </Button>
                )}
                <Button variant="ghost" size="sm" href="/cages/qr-codes" className="ml-auto">
                  <QrCode size={14} aria-hidden />
                  Cage QR codes
                </Button>
              </div>
              {loggedCageIds.size > 0 && (
                <p className="mt-2 text-xs text-muted tabular-nums">
                  {loggedCageIds.size} of {cages.length} cages already logged for {formData.date}
                </p>
              )}
            </>
          )}
        </FormSection>

        <FormSection
          title={`Lines${lines.length ? ` (${lines.length})` : ''}`}
          description="Feed deducts stock through the inventory ledger. Leave a field blank for 0"
        >
          {lines.length === 0 ? (
            <p className="text-sm text-muted">No cages selected yet</p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, i) => {
                const mort = num(line.mortality)
                const kg = kgOf(line)
                const flagged = errorLine === i
                return (
                  <div
                    key={line.key}
                    className={`rounded-xl border p-4 grid grid-cols-2 md:grid-cols-12 gap-3 items-end ${
                      flagged ? 'border-signal bg-signal/5' : 'border-foam-deep'
                    }`}
                  >
                    <Field label={`${i + 1}. Cage`} htmlFor={`cage-${line.key}`} className="col-span-2 md:col-span-3">
                      <Select
                        id={`cage-${line.key}`}
                        value={line.cageId}
                        onChange={(e) => updateLine(line.key, 'cageId', e.target.value)}
                      >
                        <option value="">Choose a cage</option>
                        {cages.map((c) => {
                          const id = idOf(c)
                          const taken =
                            (id !== line.cageId && selectedCageIds.has(id)) || loggedCageIds.has(id)
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
                        <option value="">None</option>
                        {feedTypes.map((f) => (
                          <option key={idOf(f)} value={idOf(f)}>
                            {f.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label={unit === 'bags' ? 'Feed (bags)' : 'Feed (kg)'}
                      htmlFor={`qty-${line.key}`}
                      hint={unit === 'bags' && kg > 0 ? `${kg.toFixed(1)} kg` : undefined}
                      className="md:col-span-2"
                    >
                      <Input
                        id={`qty-${line.key}`}
                        type="number"
                        inputMode="decimal"
                        step={unit === 'bags' ? '0.5' : '0.1'}
                        min="0"
                        placeholder="0"
                        value={line.feedQty}
                        onChange={(e) => updateLine(line.key, 'feedQty', e.target.value)}
                        className="tabular-nums"
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
                        className="tabular-nums"
                      />
                    </Field>
                    <div className="col-span-2 md:col-span-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(line.key)}
                        aria-label={`Remove line ${i + 1}`}
                      >
                        <Trash2 size={16} aria-hidden />
                        Remove
                      </Button>
                    </div>
                    {mort > 0 && (
                      <Field label="Cause of death" htmlFor={`cause-${line.key}`} className="col-span-2 md:col-span-3">
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
                    {formData.showWater && (
                      <>
                        <Field label="DO (mg/L)" htmlFor={`do-${line.key}`} className="md:col-span-2">
                          <Input
                            id={`do-${line.key}`}
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0"
                            value={line.dissolvedOxygen ?? ''}
                            onChange={(e) => updateLine(line.key, 'dissolvedOxygen', e.target.value)}
                            className="tabular-nums"
                          />
                        </Field>
                        <Field label="Temp (°C)" htmlFor={`temp-${line.key}`} className="md:col-span-2">
                          <Input
                            id={`temp-${line.key}`}
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            value={line.temperatureC ?? ''}
                            onChange={(e) => updateLine(line.key, 'temperatureC', e.target.value)}
                            className="tabular-nums"
                          />
                        </Field>
                      </>
                    )}
                    <Field label="Notes" htmlFor={`notes-${line.key}`} className="col-span-2 md:col-span-12">
                      <Input
                        id={`notes-${line.key}`}
                        value={line.notes}
                        onChange={(e) => updateLine(line.key, 'notes', e.target.value)}
                        placeholder="Feeding response, weather, anything unusual"
                      />
                    </Field>
                  </div>
                )
              })}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setLines((ls) => [...ls, newLine('', formData.defaultFeedTypeId)])}
              >
                <Plus size={14} aria-hidden />
                Add line
              </Button>
            </div>
          )}

          {stockCheck.length > 0 && (
            <div className="mt-5 rounded-lg border border-foam-deep p-4 text-sm space-y-1">
              <p className="font-medium text-chart-ink">Feed in this batch</p>
              {stockCheck.map((s) => (
                <p key={s.feedTypeId} className={`tabular-nums ${s.short ? 'text-signal' : 'text-muted'}`}>
                  {s.name}: {s.need.toFixed(1)} kg of {s.onHand.toFixed(1)} kg on hand
                  {s.short ? ', not enough stock' : ''}
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
                showToast('Purchase recorded. Stock updated', 'success')
              }}
            />
          )}

          {hasRole('admin') && shortages.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3 dark:bg-amber-500/10 dark:border-amber-500/30">
              <label className="flex items-center gap-2 text-sm text-chart-ink">
                <input
                  type="checkbox"
                  name="allowNegative"
                  checked={Boolean(formData.allowNegative)}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-input-border"
                />
                Admin override: allow saving without enough stock
              </label>
              {formData.allowNegative && (
                <Field label="Reason" htmlFor="overrideReason" required>
                  <Input
                    id="overrideReason"
                    name="overrideReason"
                    value={formData.overrideReason || ''}
                    onChange={handleChange}
                    required
                    placeholder="Why is this needed"
                  />
                </Field>
              )}
            </div>
          )}
        </FormSection>

        <FormActions>
          {lines.length > 0 && (
            <p className="text-sm text-muted mr-auto tabular-nums">
              {lines.length} cage{lines.length === 1 ? '' : 's'}, {totals.feed.toFixed(1)} kg feed,{' '}
              {totals.mort} dead
            </p>
          )}
          <Button
            type="submit"
            disabled={loading || lines.length === 0 || (shortages.length > 0 && !overrideActive)}
            size="lg"
          >
            {loading
              ? 'Saving…'
              : lines.length
                ? `Save ${lines.length} record${lines.length === 1 ? '' : 's'}`
                : 'Save records'}
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}

export default DailyUploadPage
