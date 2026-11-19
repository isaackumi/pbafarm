import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/router'
import { Trash2, Plus, Copy, QrCode, ScanLine, TriangleAlert, Check, Upload } from 'lucide-react'
import { useConvex } from 'convex/react'
import { api } from '../convex/_generated/api'
import { cleanError } from '../lib/offlineOutbox'
import { saveOrQueue } from '../lib/outboxSenders'
import { useOnline } from '../hooks/useOutbox'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { useReferenceList } from '../hooks/useReferenceList'
import { useLocation } from '../contexts/LocationContext'
import OutboxPanel from './OutboxPanel'
import FormLayout, { hiddenCoreKeys, useFormLayout } from './FormLayout'
import RationSuggestion from './RationSuggestion'
import {
  Field,
  Input,
  Select,
  IfPermitted,
  GradientButton,
  GhostButton,
  Segmented,
  Toggle,
  StatusDot,
  PageTitle,
} from './ui'
import { ActionBar } from './ui/ActionBar'
import { formatDate, formatNumber } from '../lib/format'
import DependencyEmpty from './DependencyEmpty'
import FeedTypeField from './FeedTypeField'
import LocationMetaField from './LocationMetaField'
import { useToast } from './Toast'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useAuth } from '../contexts/AuthContext'
import { MORTALITY_CAUSES } from '../lib/farmHealth'
import { parseCageScan } from '../lib/qrTarget'
import QrScanner from './QrScanner'
import { usePermission } from '../hooks/usePermission'
import { customPayload } from './CustomFields'
import { useT } from '../lib/i18n/context'

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
  mortalityOnly: false,
  allowNegative: false,
  overrideReason: '',
}

const idOf = (x) => x?.id || x?._id
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const optNum = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v))
const usableFeedTypes = (rows) => (rows || []).filter((f) => f.active !== false && !f.deleted_at)
const NO_RECORDS = []

const DailyUploadPage = () => {
  const router = useRouter()
  const convex = useConvex()
  const [loading, setLoading] = useState(false)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState('')
  const [errorLine, setErrorLine] = useState(null)
  const online = useOnline()
  const [scanOpen, setScanOpen] = useState(false)
  // Blank feed is "not recorded", not 0 kg: the first Save asks (Q-016).
  const [confirmBlank, setConfirmBlank] = useState(false)
  const prefilledFor = useRef(null)
  const { showToast } = useToast()
  const t = useT()
  const { hasRole, user } = useAuth()
  const canOverride = usePermission('inventory.adjust')
  const userId = user?.id
  const { formData, setFormData, handleChange, clear } = usePersistedForm(
    'daily-entry-batch',
    DEFAULTS,
    { storage: 'local' },
  )
  const lines = Array.isArray(formData.lines) ? formData.lines : []
  const unit = formData.feedUnit === 'bags' ? 'bags' : 'kg'
  const layout = useFormLayout('production.daily')

  // Live lists, kept on the device for entry with no signal (MOBILE-003).
  const { activeLocationId, locationArgs } = useLocation()
  const cageRef = useReferenceList('cages', api.cages.getActive, locationArgs)
  const feedRef = useReferenceList('feedTypes', api.feed.listFeedTypes, {}, usableFeedTypes)
  const cages = cageRef.list
  const feedTypes = feedRef.list
  const lookupsReady = cageRef.ready && feedRef.ready
  // Feed on hand at the active site (the server checks stock per site).
  const levels = useOptionalQuery(
    api.inventory.listStockLevels,
    user && activeLocationId ? { locationId: activeLocationId } : 'skip',
  )
  const siteStockById = useMemo(
    () => (levels ? new Map(levels.map((l) => [l.feed_type_id, Number(l.current_stock) || 0])) : null),
    [levels],
  )
  // Cages already logged on the date; updates live, including when the outbox sends.
  const logged = useOptionalQuery(
    api.dailyRecords.listForDate,
    user && formData.date ? { date: formData.date } : 'skip',
    NO_RECORDS,
  )
  const loggedCageIds = useMemo(() => new Set((logged || NO_RECORDS).map((r) => r.cage_id)), [logged])

  useEffect(() => {
    // A stale empty draft should open on today, not on the day it was started.
    setFormData((prev) =>
      (prev.lines || []).length === 0 ? { ...prev, date: isoDay() } : prev,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- lines -------------------------------------------------------------

  const setLines = (updater) => {
    setConfirmBlank(false)
    setFormData((prev) => {
      const current = Array.isArray(prev.lines) ? prev.lines : []
      return { ...prev, lines: typeof updater === 'function' ? updater(current) : updater }
    })
  }

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
    if (!lookupsReady || !router.isReady) return
    const raw = [router.query.cage, router.query.cages].flat().filter(Boolean).join(',')
    // Apply each link once, including a new one opened while already on this page.
    if (!raw || prefilledFor.current === raw) return
    prefilledFor.current = raw
    const known = new Set(cages.map(idOf))
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter((id) => known.has(id) && !loggedCageIds.has(id))
    if (ids.length) addCages(ids)
  }, [lookupsReady, router.isReady, router.query, cages, addCages, loggedCageIds])

  const toggleCage = (cageId) => {
    if (selectedCageIds.has(cageId)) {
      setLines((ls) => ls.filter((l) => l.cageId !== cageId))
    } else {
      addCages([cageId])
    }
  }

  const openCages = cages.filter((c) => !loggedCageIds.has(idOf(c)))

  const onScan = (text) => {
    setScanOpen(false)
    const hit = parseCageScan(text, cages)
    if (!hit) {
      showToast(t('common.noCageMatchesLabel'), 'error')
      return
    }
    const fresh = hit.cageIds.filter((id) => !loggedCageIds.has(id))
    if (!fresh.length) {
      showToast(t('daily.alreadyLogged', { name: cageName(hit.cageIds[0]), date: formData.date }), 'info')
      return
    }
    addCages(fresh)
    showToast(t('common.added', { names: fresh.map(cageName).join(', ') }), 'success')
  }

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
  const mortalityOnly = Boolean(formData.mortalityOnly)
  const kgOf = (line) =>
    mortalityOnly
      ? 0
      : unit === 'bags'
        ? num(line.feedQty) * bagSize(line.feedTypeId)
        : num(line.feedQty)

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
      const data = await convex.query(api.dailyRecords.listForDate, { date: prevDate })
      const active = new Set(cages.map(idOf))
      const rows = (data || []).filter(
        (r) => active.has(r.cage_id) && !loggedCageIds.has(r.cage_id),
      )
      if (!rows.length) {
        showToast(t('daily.nothingToCopy', { date: prevDate }), 'info')
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
      showToast(t('daily.copied', { count: rows.length, date: prevDate }), 'success')
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
      const onHand = siteStockById?.has(feedTypeId)
        ? siteStockById.get(feedTypeId)
        : num(ft?.current_stock ?? ft?.currentStock)
      return { feedTypeId, name: ft?.name || 'Feed', need: kg, onHand, short: onHand < kg }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, feedTypeById, unit, siteStockById])
  const shortages = stockCheck.filter((s) => s.short)
  const overrideActive = canOverride && formData.allowNegative

  const blankFeedLines = mortalityOnly
    ? []
    : lines.filter((l) => l.cageId && (l.feedQty === '' || l.feedQty == null))

  const totals = lines.reduce(
    (acc, l) => ({ feed: acc.feed + kgOf(l), mort: acc.mort + num(l.mortality) }),
    { feed: 0, mort: 0 },
  )

  const validate = () => {
    if (!formData.date) return [t('daily.chooseDate'), null]
    if (!lines.length) return [t('entry.selectAtLeastOne'), null]
    const seen = new Set()
    for (const [i, l] of lines.entries()) {
      const label = l.cageId
        ? t('daily.lineLabelCage', { n: i + 1, name: cageName(l.cageId) })
        : t('daily.lineLabel', { n: i + 1 })
      if (!l.cageId) return [t('daily.errChooseCage', { label }), i]
      if (seen.has(l.cageId)) return [t('daily.errTwice', { label }), i]
      seen.add(l.cageId)
      if (loggedCageIds.has(l.cageId)) {
        return [t('daily.errAlreadyLogged', { label, date: formData.date }), i]
      }
      const kg = kgOf(l)
      const mort = num(l.mortality)
      if (kg < 0 || mort < 0) return [t('daily.errNegative', { label }), i]
      if (kg > 0 && !l.feedTypeId) return [t('daily.errFeedType', { label }), i]
      if (!Number.isInteger(mort)) return [t('daily.errWholeMortality', { label }), i]
    }
    if (shortages.length && !overrideActive) {
      return [
        shortages
          .map((s) => t('daily.notEnough', { name: s.name, onHand: s.onHand.toFixed(1), need: s.need.toFixed(1) }))
          .join('. '),
        null,
      ]
    }
    if (formData.allowNegative && !String(formData.overrideReason || '').trim()) {
      return [t('daily.overrideNeedsReason'), null]
    }
    return ['', null]
  }

  // ---- submit ------------------------------------------------------------

  const resetForm = () => {
    clear()
    setFormData({
      ...DEFAULTS,
      date: isoDay(),
      defaultFeedTypeId: formData.defaultFeedTypeId,
      feedUnit: unit,
      showWater: formData.showWater,
      mortalityOnly: formData.mortalityOnly,
    })
  }

  // A field a layout condition hides is not saved (its value would be unseen).
  const withoutHidden = (line) => {
    const hidden = hiddenCoreKeys(layout.sections, line, line.custom)
    if (!hidden.size) return line
    const out = { ...line }
    for (const key of hidden) out[key] = key === 'mortalityCause' ? 'unknown' : ''
    return out
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const [problem, lineIdx] = validate()
    setError(problem)
    setErrorLine(lineIdx)
    if (problem) return
    if (blankFeedLines.length && !confirmBlank) {
      setConfirmBlank(true)
      return
    }

    const payload = {
      date: formData.date,
      records: lines.map((line) => {
        const l = withoutHidden(line)
        const kg = Math.round(kgOf(l) * 1000) / 1000
        const mort = num(l.mortality)
        return {
          cageId: l.cageId,
          feedAmount: kg,
          feedTypeId: mortalityOnly ? undefined : l.feedTypeId || undefined,
          mortality: mort,
          mortalityCause: mort > 0 ? l.mortalityCause || 'unknown' : undefined,
          notes: l.notes?.trim() || undefined,
          dissolvedOxygen: formData.showWater ? optNum(l.dissolvedOxygen) : undefined,
          temperatureC: formData.showWater ? optNum(l.temperatureC) : undefined,
          custom: customPayload(l.custom),
        }
      }),
      allowNegative: overrideActive || undefined,
      overrideReason: overrideActive ? formData.overrideReason : undefined,
    }
    const count = lines.length
    const summary = `${formData.date} · ${count} cage${count === 1 ? '' : 's'}${
      mortalityOnly ? ' · mortality only' : ''
    }`

    setLoading(true)
    try {
      const res = await saveOrQueue({ kind: 'daily-batch', payload, summary, userId })
      if (res.queued) {
        resetForm()
        showToast(t('common.queuedOffline'), 'info')
        return
      }
      if (res.error) throw res.error
      resetForm()
      showToast(
        mortalityOnly
          ? t('daily.savedMortality', { count })
          : t('daily.savedRecords', { count }),
        'success',
      )
    } catch (err) {
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

  /** One line's built-in inputs, keyed as in FORM_CATALOG['production.daily']; null = hidden by this form. */
  const lineFields = (line, i) => {
    const mort = num(line.mortality)
    const kg = kgOf(line)
    const blankFeed = Boolean(line.cageId) && (line.feedQty === '' || line.feedQty == null)
    return {
      feedQty: mortalityOnly ? null : (
        <Field
          label={unit === 'bags' ? t('daily.feedBags') : t('daily.feedKg')}
          htmlFor={`qty-${line.key}`}
          hint={unit === 'bags' && kg > 0 ? `${kg.toFixed(1)} kg` : undefined}
          error={confirmBlank && blankFeed ? t('daily.notRecorded') : undefined}
        >
          <Input
            id={`qty-${line.key}`}
            type="number"
            inputMode="decimal"
            enterKeyHint="next"
            step={unit === 'bags' ? '0.5' : '0.1'}
            min="0"
            placeholder={t('daily.notRecorded')}
            value={line.feedQty}
            onChange={(e) => updateLine(line.key, 'feedQty', e.target.value)}
            className="tabular-nums"
          />
        </Field>
      ),
      mortality: (
        <Field label={t('daily.mortality')} htmlFor={`mort-${line.key}`}>
          <Input
            id={`mort-${line.key}`}
            type="number"
            inputMode="numeric"
            enterKeyHint="next"
            step="1"
            min="0"
            placeholder="0"
            value={line.mortality}
            onChange={(e) => updateLine(line.key, 'mortality', e.target.value)}
            className="tabular-nums"
          />
        </Field>
      ),
      feedTypeId: mortalityOnly ? null : (
        <Field label={t('daily.feedType')} htmlFor={`feed-${line.key}`}>
          <Select
            id={`feed-${line.key}`}
            value={line.feedTypeId}
            onChange={(e) => updateLine(line.key, 'feedTypeId', e.target.value)}
          >
            <option value="">{t('daily.none')}</option>
            {feedTypes.map((f) => (
              <option key={idOf(f)} value={idOf(f)}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
      ),
      mortalityCause:
        mort > 0 ? (
          <Field label={t('daily.causeOfDeath')} htmlFor={`cause-${line.key}`}>
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
        ) : null,
      dissolvedOxygen: formData.showWater ? (
        <Field label={t('entry.doMgL')} htmlFor={`do-${line.key}`}>
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
      ) : null,
      temperatureC: formData.showWater ? (
        <Field label={t('entry.tempC')} htmlFor={`temp-${line.key}`}>
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
      ) : null,
      notes: (
        <details open={Boolean(line.notes) || undefined}>
          <summary className="inline-flex min-h-12 sm:min-h-9 cursor-pointer items-center text-sm text-muted hover:text-text select-none">
            {line.notes ? t('daily.note') : t('daily.addNote')}
          </summary>
          <label htmlFor={`notes-${line.key}`} className="sr-only">
            {t('daily.noteFor', { n: i + 1 })}
          </label>
          <Input
            id={`notes-${line.key}`}
            value={line.notes}
            onChange={(e) => updateLine(line.key, 'notes', e.target.value)}
            placeholder={t('daily.notePlaceholder')}
          />
        </details>
      ),
    }
  }

  const isInsufficientError = /not enough|insufficient|pas assez|insuffisant/i.test(error || '')

  const submitDisabled = loading || lines.length === 0 || (shortages.length > 0 && !overrideActive)
  const submitLabel = loading
    ? t('common.saving')
    : confirmBlank && blankFeedLines.length
      ? t('daily.saveAnyway')
      : lines.length
        ? t('daily.submitN', { count: lines.length })
        : t('daily.saveRecords')
  const isToday = formData.date === isoDay()
  const loggedCount = cages.filter((c) => loggedCageIds.has(idOf(c))).length

  /** Row status, right column of the 04 grid. */
  const lineStatus = (line, i) => {
    if (errorLine === i) return { tone: 'text-alert', label: t('daily.status.check') }
    if (!line.cageId) return { tone: 'text-faint', label: t('daily.status.pending') }
    if (!mortalityOnly && (line.feedQty === '' || line.feedQty == null)) {
      return { tone: confirmBlank ? 'text-warn' : 'text-faint', label: t('daily.status.pending') }
    }
    return { tone: 'text-good', label: t('daily.status.ready') }
  }

  // ---- render ------------------------------------------------------------

  return (
    <div className="flex flex-col gap-5 sm:gap-7">
      <PageTitle
        eyebrow={t('daily.eyebrow', { date: formatDate(formData.date) })}
        title={t('daily.title')}
        titleProps={{ 'data-tour': 'header-title' }}
        actions={
          <>
            <GradientButton
              type="submit"
              form="daily-entry-form"
              icon={Check}
              disabled={submitDisabled}
              className="hidden sm:inline-flex"
            >
              {submitLabel}
            </GradientButton>
            <IfPermitted permission="production.import">
              <GradientButton reverse href="/bulk-upload" icon={Upload}>
                {t('daily.uploadSheet')}
              </GradientButton>
            </IfPermitted>
          </>
        }
      />

      <OutboxPanel compact online={online} kinds={['daily-batch']} />

      {error && (
        <div
          role="alert"
          className="text-sm text-alert border border-[var(--pill-red-border)] bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] rounded-input py-3 px-4"
        >
          {error}
          {isInsufficientError && (
            <DependencyEmpty
              className="mt-3 bg-surface"
              message={t('daily.addStockMessage')}
              createKind="purchase"
              createLabel={t('daily.recordPurchase')}
              createProps={{ defaultFeedTypeId: shortages[0]?.feedTypeId }}
              onCreated={() => {
                setError('')
                showToast(t('daily.purchaseRecorded'), 'success')
              }}
            />
          )}
        </div>
      )}

      <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={onScan} />

      {/* Today's round (Paper 04): cages logged for the date, then quick actions. */}
      <section
        aria-labelledby="daily-round-title"
        className="flex flex-col gap-4 rounded-card border border-line bg-surface px-5 py-5 shadow-[var(--shadow-card)] sm:px-6 lg:flex-row lg:items-center lg:gap-6"
      >
        <div className="shrink-0 lg:w-60">
          <p id="daily-round-title" className="text-[13px] leading-4 text-muted">
            {isToday ? t('daily.round.today') : t('daily.round.forDate', { date: formatDate(formData.date) })}
          </p>
          <p className="mt-1 text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text tabular-nums">
            {loggedCount}{' '}
            <span className="text-[15px] font-normal leading-[18px] text-muted">
              {t('daily.round.ofCages', { total: cages.length })}
            </span>
          </p>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div
            role="progressbar"
            aria-label={t('daily.round.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={cages.length}
            aria-valuenow={loggedCount}
            className="h-1.5 w-full overflow-hidden rounded-pill bg-line-strong"
          >
            <div
              className="h-full rounded-pill"
              style={{
                width: `${cages.length ? Math.min(100, (loggedCount / cages.length) * 100) : 0}%`,
                backgroundImage: 'var(--gradient-bar)',
              }}
            />
          </div>
          <div className="flex justify-between gap-3 text-xs leading-4 text-faint tabular-nums">
            <span>{t('daily.round.inBatch', { count: lines.length })}</span>
            <span>{t('daily.round.open', { count: openCages.length })}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <GhostButton onClick={selectAllCages} disabled={!openCages.length} className="min-h-11 sm:min-h-0">
            {t('daily.selectAllOpen')}
          </GhostButton>
          <GhostButton
            icon={Copy}
            onClick={copyYesterday}
            disabled={copying || !cages.length}
            className="min-h-11 sm:min-h-0"
          >
            {copying ? t('daily.copying') : t('daily.sameAsYesterday')}
          </GhostButton>
          <GhostButton icon={ScanLine} onClick={() => setScanOpen(true)} className="min-h-11 sm:min-h-0">
            {t('entry.scanCage')}
          </GhostButton>
          <GhostButton icon={QrCode} href="/cages/qr-codes" className="min-h-11 sm:min-h-0">
            {t('daily.qrCodes')}
          </GhostButton>
        </div>
      </section>

      <form
        id="daily-entry-form"
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            e.currentTarget.requestSubmit()
          }
        }}
        className="flex flex-col gap-5 sm:gap-7"
      >
        <section
          aria-labelledby="daily-defaults-title"
          className="rounded-card border border-line bg-surface px-5 py-5 shadow-[var(--shadow-card)] sm:px-6"
        >
          <h2 id="daily-defaults-title" className="mb-4 text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">
            {t('daily.dateAndDefaults')}
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <LocationMetaField />
            </div>
            <Field label={t('entry.date')} htmlFor="date" required hint={t('common.appliesToEveryLine')}>
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
                label={t('daily.defaultFeedType')}
                hint={t('daily.defaultFeedHint')}
                value={formData.defaultFeedTypeId}
                onChange={handleChange}
                feedTypes={feedTypes}
                ready={lookupsReady}
                onCreated={(result) => {
                  if (result?.kind === 'feedType' && result.id) {
                    setFormData((prev) => ({ ...prev, defaultFeedTypeId: result.id }))
                  }
                }}
              />
              {formData.defaultFeedTypeId && lines.length > 0 && (
                <GhostButton size="sm" onClick={applyDefaultFeedToAll}>
                  {t('daily.applyToAll')}
                </GhostButton>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 md:col-span-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted">{t('daily.feedIn')}</span>
                <Segmented
                  label={t('daily.feedIn')}
                  options={[
                    { value: 'kg', label: 'kg' },
                    { value: 'bags', label: t('daily.bags') },
                  ]}
                  value={unit}
                  onChange={switchUnit}
                />
              </div>
              <label className="flex min-h-11 items-center gap-2.5 text-sm text-text">
                <Toggle
                  label={t('daily.recordWater')}
                  checked={Boolean(formData.showWater)}
                  onChange={(next) => setFormData((prev) => ({ ...prev, showWater: next }))}
                />
                {t('daily.recordWater')}
              </label>
              <label className="flex min-h-11 items-center gap-2.5 text-sm text-text">
                <Toggle
                  label={t('daily.mortalityOnly')}
                  checked={mortalityOnly}
                  onChange={(next) => setFormData((prev) => ({ ...prev, mortalityOnly: next }))}
                />
                {t('daily.mortalityOnly')}
              </label>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="daily-cages-title"
          className="rounded-card border border-line bg-surface px-5 py-5 shadow-[var(--shadow-card)] sm:px-6"
        >
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="daily-cages-title" className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">
              {t('common.cages')}
            </h2>
            <p className="text-xs text-faint">{t('common.tapCageToAdd')}</p>
          </div>
          {lookupsReady && cages.length === 0 ? (
            <DependencyEmpty
              message={t('daily.needsCage')}
              createKind="cage"
              createLabel={t('entry.createCage')}
              secondaryCreateKind="stocking"
              secondaryCreateLabel={t('daily.stockCage')}
              onCreated={(result) => {
                if (result?.kind === 'stocking') {
                  showToast(t('daily.stockingCreated'), 'success')
                }
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {cages.map((cage) => {
                const id = idOf(cage)
                const on = selectedCageIds.has(id)
                const done = loggedCageIds.has(id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleCage(id)}
                    disabled={done}
                    aria-pressed={on}
                    title={done ? t('daily.alreadyLoggedTitle', { date: formData.date }) : undefined}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border px-4 text-sm leading-[18px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:cursor-not-allowed ${
                      on
                        ? 'border-transparent bg-button font-semibold text-button-text'
                        : done
                          ? 'border-line text-muted'
                          : 'border-line-strong text-text hover:border-pearl-cyan'
                    }`}
                  >
                    {cage.name}
                    {done && (
                      <>
                        <span aria-hidden>✓</span>
                        <span className="sr-only">{t('daily.logged')}</span>
                      </>
                    )}
                  </button>
                )
              })}
              {lines.length > 0 && (
                <GhostButton tone="danger" onClick={() => setLines([])} className="min-h-11 sm:min-h-0">
                  {t('daily.clearAll')}
                </GhostButton>
              )}
            </div>
          )}
        </section>

        {/* Entry grid (Paper 04): one row per cage. Columns follow the org's form layout. */}
        <section
          aria-labelledby="daily-lines-title"
          className="overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3.5 sm:px-6">
            <h2 id="daily-lines-title" className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">
              {lines.length ? t('common.linesCount', { count: lines.length }) : t('common.lines')}
            </h2>
            <p className="text-xs text-faint">{t('daily.linesDescription')}</p>
          </div>
          {lines.length === 0 ? (
            <p className="border-b border-line px-5 py-4 text-sm text-muted sm:px-6">{t('common.noCagesSelected')}</p>
          ) : (
            lines.map((line, i) => {
              const mort = num(line.mortality)
              const kg = kgOf(line)
              const flagged = errorLine === i
              const status = lineStatus(line, i)
              const cage = line.cageId ? cages.find((c) => idOf(c) === line.cageId) : null
              return (
                <div
                  key={line.key}
                  className={`flex flex-col gap-3 border-b border-line px-5 py-3 sm:px-6 md:flex-row md:items-start md:gap-4 ${
                    flagged ? 'bg-[color-mix(in_oklab,var(--alert)_6%,transparent)]' : ''
                  }`}
                >
                  <div className="min-w-0 md:w-[150px] md:shrink-0 md:pt-6">
                    {line.cageId ? (
                      <>
                        <p className="truncate text-sm font-semibold leading-[18px] text-text">
                          <span className="mr-1.5 font-normal text-faint tabular-nums">{i + 1}.</span>
                          {cageName(line.cageId)}
                        </p>
                        {cage?.current_count != null && (
                          <p className="mt-0.5 text-xs leading-4 text-muted tabular-nums">
                            {t('daily.fishCount', { count: formatNumber(cage.current_count) })}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <label htmlFor={`cage-${line.key}`} className="sr-only">
                          {t('daily.lineCage', { n: i + 1 })}
                        </label>
                        <Select
                          id={`cage-${line.key}`}
                          value={line.cageId}
                          onChange={(e) => updateLine(line.key, 'cageId', e.target.value)}
                        >
                          <option value="">{t('daily.chooseCage')}</option>
                          {cages.map((c) => {
                            const id = idOf(c)
                            const taken = selectedCageIds.has(id) || loggedCageIds.has(id)
                            return (
                              <option key={id} value={id} disabled={taken}>
                                {c.name}
                              </option>
                            )
                          })}
                        </Select>
                      </>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    {line.cageId && !mortalityOnly && <RationSuggestion cageId={line.cageId} className="text-xs" />}
                    <FormLayout
                      formKey="production.daily"
                      layout={layout}
                      compact
                      fields={lineFields(line, i)}
                      coreValues={line}
                      custom={line.custom}
                      onCustomChange={(next) => updateLine(line.key, 'custom', next)}
                      locationId={cage?.location_id}
                      core={{ mortality: mort, feedAmount: kg, mortalityCause: line.mortalityCause }}
                      idPrefix={`cf-${line.key}`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 md:w-24 md:shrink-0 md:flex-col md:items-end md:pt-6">
                    <span className={`text-xs leading-4 ${status.tone}`}>{status.label}</span>
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      aria-label={
                        line.cageId
                          ? t('daily.removeLineCage', { n: i + 1, name: cageName(line.cageId) })
                          : t('daily.removeLine', { n: i + 1 })
                      }
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill text-muted hover:bg-surface-2 hover:text-alert focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:size-9"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {lines.length > 0 && (
            <div className="border-b border-line px-5 py-3 sm:px-6">
              <GhostButton
                icon={Plus}
                onClick={() => setLines((ls) => [...ls, newLine('', formData.defaultFeedTypeId)])}
                className="min-h-11 sm:min-h-0"
              >
                {t('daily.addLine')}
              </GhostButton>
            </div>
          )}

          {(stockCheck.length > 0 || shortages.length > 0) && (
            <div className="space-y-4 border-b border-line px-5 py-4 sm:px-6">
              {stockCheck.length > 0 && (
                <div className="space-y-1 text-sm">
                  <p className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">{t('daily.feedInBatch')}</p>
                  {stockCheck.map((s) => (
                    <p key={s.feedTypeId} className={`tabular-nums ${s.short ? 'text-alert' : 'text-muted'}`}>
                      {t('daily.stockLine', { name: s.name, need: s.need.toFixed(1), onHand: s.onHand.toFixed(1) })}
                      {siteStockById ? t('daily.atThisSite') : ''}
                      {s.short ? t('daily.notEnoughStockSuffix') : ''}
                    </p>
                  ))}
                </div>
              )}

              {shortages.length > 0 && (
                <DependencyEmpty
                  message={t('daily.notEnoughForBatch')}
                  createKind="purchase"
                  createLabel={t('daily.recordPurchase')}
                  createProps={{ defaultFeedTypeId: shortages[0].feedTypeId }}
                  onCreated={() => {
                    setError('')
                    showToast(t('daily.purchaseRecorded'), 'success')
                  }}
                />
              )}

              {canOverride && shortages.length > 0 && (
                <div className="space-y-3 rounded-input border border-[var(--pill-amber-border)] bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] p-4">
                  <label className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      name="allowNegative"
                      checked={Boolean(formData.allowNegative)}
                      onChange={handleChange}
                      className="h-4 w-4 rounded border-line-strong accent-[var(--cyan)]"
                    />
                    {t('daily.overrideLabel')}
                  </label>
                  {formData.allowNegative && (
                    <Field label={t('daily.reason')} htmlFor="overrideReason" required>
                      <Input
                        id="overrideReason"
                        name="overrideReason"
                        value={formData.overrideReason || ''}
                        onChange={handleChange}
                        required
                        placeholder={t('daily.reasonPlaceholder')}
                      />
                    </Field>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 sm:px-6">
            <p className="text-[13px] leading-4 text-muted tabular-nums">
              {lines.length
                ? t('daily.totals', { count: lines.length, feed: totals.feed.toFixed(1), dead: totals.mort })
                : t('common.noCagesSelected')}
            </p>
            <p className="hidden text-[13px] leading-4 text-text sm:block">{t('daily.keyboardHint')}</p>
          </div>
        </section>

        <ActionBar>
          {confirmBlank && blankFeedLines.length > 0 && (
            <p role="alert" className="flex basis-full items-start gap-2 text-sm text-warn">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {t('daily.noFeedFor', { names: blankFeedLines.map((l) => cageName(l.cageId)).join(', ') })}
              </span>
            </p>
          )}
          <div className="mr-auto flex min-w-0 items-center gap-2.5">
            <StatusDot tone={lines.length ? 'good' : 'neutral'} size={8} />
            <p className="text-sm text-text tabular-nums">
              {lines.length
                ? t('daily.totals', { count: lines.length, feed: totals.feed.toFixed(1), dead: totals.mort })
                : t('common.noCagesSelected')}
            </p>
          </div>
          <GradientButton type="submit" variant="solid" icon={Check} disabled={submitDisabled}>
            {submitLabel}
          </GradientButton>
        </ActionBar>
      </form>
    </div>
  )
}

export default DailyUploadPage
