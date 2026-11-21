import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { api } from '../convex/_generated/api'
import { cleanError, kindOf } from '../lib/offlineOutbox'
import { saveOrQueue } from '../lib/outboxSenders'
import { useOnline, useOutbox } from '../hooks/useOutbox'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { useReferenceList } from '../hooks/useReferenceList'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useDialogA11y } from '../hooks/useDialogA11y'
import { useLocation } from '../contexts/LocationContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import FormLayout, { hiddenCoreKeys, useFormLayout } from './FormLayout'
import { customPayload } from './CustomFields'
import OutboxPanel from './OutboxPanel'
import QrScanner from './QrScanner'
import { Field, Input, Select } from './ui'
import { MORTALITY_CAUSES } from '../lib/farmHealth'
import { parseCageScan } from '../lib/qrTarget'
import { queryDate, queryNumber, queryValue } from '../lib/anowaDraftCard'
import { useLocale, useT } from '../lib/i18n/context'

/*
 * Paper 55 "Mobile, Daily entry" (H45-0 dark, MGE-0 light): one cage at a
 * time on a phone. The same save path as the desktop batch (one-line
 * dailyRecords.createBatch through the offline outbox), the same checks and
 * the same scanned-cage links (?cage=<id>, plus Ask Anowa's drafted values).
 */

const isoDay = (d = new Date()) => d.toISOString().split('T')[0]
const daysBefore = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() - n)
  return isoDay(d)
}
const idOf = (x) => x?.id || x?._id
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const optNum = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v))
const blank = (v) => v === '' || v == null
const round1 = (n) => Math.round(n * 10) / 10
const usableFeedTypes = (rows) => (rows || []).filter((f) => f.active !== false && !f.deleted_at)
const NO_ROWS = []
/** Chips shown after the current cage; the picker sheet reaches the rest. */
const CHIP_COUNT = 8
/** Rows the cage picker renders at once; typing narrows a large farm. */
const PICKER_LIMIT = 60
/** Dissolved oxygen this close above its minimum shows amber. */
const DO_WATCH_MG_L = 1

const DEFAULTS = { date: isoDay(), cageId: '', drafts: {} }
const emptyDraft = () => ({
  feedQty: '',
  feedTypeId: '',
  mortality: '',
  mortalityCause: 'unknown',
  notes: '',
  poorAppetite: false,
  dissolvedOxygen: '',
  temperatureC: '',
  ph: '',
})

/* Paper 55 glyphs: 24px viewBox, 2px round strokes, currentColor. */
function Glyph({ d, size, className = '', children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {d ? <path d={d} /> : children}
    </svg>
  )
}
const MINUS = 'M5 12h14'
const PLUS = 'M12 5v14M5 12h14'

/** Bottom sheet shell (dialog semantics, focus trap, Escape). */
function Sheet({ open, onClose, title, children, labelledBy }) {
  const ref = useDialogA11y({ open, onClose })
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <button type="button" aria-hidden tabIndex={-1} className="absolute inset-0 bg-[var(--backdrop)]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative flex max-h-[85vh] w-full flex-col gap-3 rounded-t-[24px] border-t border-line bg-surface px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={labelledBy} className="text-[17px] font-semibold leading-[22px] text-text">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function DailyEntryMobile() {
  const router = useRouter()
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const { showToast } = useToast()
  const { user } = useAuth()
  const userId = user?.id
  const online = useOnline()
  const { items: outboxItems, sending, send } = useOutbox()
  const layout = useFormLayout('production.daily')

  const { formData, setFormData } = usePersistedForm('daily-entry-mobile', DEFAULTS, { storage: 'local' })
  const date = formData.date || isoDay()
  const drafts = formData.drafts && typeof formData.drafts === 'object' ? formData.drafts : {}

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmBlank, setConfirmBlank] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [justSaved, setJustSaved] = useState(() => new Set())
  const prefilledFor = useRef(null)

  // Live lists, kept on the device for entry with no signal (MOBILE-003).
  const { activeLocationId, locationArgs } = useLocation()
  const cageRef = useReferenceList('cages', api.cages.getActive, locationArgs)
  const feedRef = useReferenceList('feedTypes', api.feed.listFeedTypes, {}, usableFeedTypes)
  const cages = cageRef.list
  const feedTypes = feedRef.list
  const lookupsReady = cageRef.ready && feedRef.ready
  const feedTypeById = useMemo(() => new Map(feedTypes.map((f) => [idOf(f), f])), [feedTypes])

  const logged = useOptionalQuery(api.dailyRecords.listForDate, user ? { date } : 'skip', NO_ROWS)
  // Done = logged on the server, waiting in this device's outbox, or just saved.
  const doneIds = useMemo(() => {
    const s = new Set((logged || NO_ROWS).map((r) => r.cage_id))
    for (const item of outboxItems) {
      if (kindOf(item) !== 'daily-batch' || item.payload?.date !== date) continue
      for (const r of item.payload?.records || []) s.add(r.cageId)
    }
    for (const id of justSaved) s.add(id)
    return s
  }, [logged, outboxItems, date, justSaved])
  const queuedCount = outboxItems.filter((i) => kindOf(i) === 'daily-batch').length
  const refused = outboxItems.some((i) => kindOf(i) === 'daily-batch' && i.lastError)

  const openCages = useMemo(() => cages.filter((c) => !doneIds.has(idOf(c))), [cages, doneIds])

  // ---- current cage --------------------------------------------------------

  const setCurrent = (cageId) => {
    setError('')
    setConfirmBlank(false)
    setFormData((prev) => ({ ...prev, cageId }))
  }
  const cageId = formData.cageId && cages.some((c) => idOf(c) === formData.cageId) ? formData.cageId : ''
  const cage = cageId ? cages.find((c) => idOf(c) === cageId) : null
  const cageName = (id) => cages.find((c) => idOf(c) === id)?.name || t('dailyMobile.unknownCage')

  // Start on the first open cage (or keep the draft's cage while it is open).
  useEffect(() => {
    if (!lookupsReady) return
    // A scanned link picks the cage first (the effect below).
    if ((router.query.cage || router.query.cages) && !prefilledFor.current) return
    if (cageId && !doneIds.has(cageId)) return
    const first = openCages[0]
    if (first && idOf(first) !== cageId) setCurrent(idOf(first))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupsReady, openCages, cageId])

  // A stale empty draft opens on today, not on the day it was started.
  useEffect(() => {
    setFormData((prev) =>
      Object.keys(prev.drafts || {}).length === 0 ? { ...prev, date: isoDay() } : prev,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // QR codes and cage pages link here as ?cage=<id> (or ?cages=a,b): open the first open one.
  useEffect(() => {
    if (!lookupsReady || !router.isReady) return
    const raw = [router.query.cage, router.query.cages].flat().filter(Boolean).join(',')
    if (!raw || prefilledFor.current === raw) return
    prefilledFor.current = raw
    const known = new Set(cages.map(idOf))
    const ids = raw.split(',').map((s) => s.trim()).filter((id) => known.has(id))
    const fresh = ids.filter((id) => !doneIds.has(id))
    if (!fresh.length) {
      if (ids.length) showToast(t('daily.alreadyLogged', { name: cageName(ids[0]), date }), 'info')
      if ((!cageId || doneIds.has(cageId)) && openCages[0]) setCurrent(idOf(openCages[0]))
      return
    }
    // Ask Anowa's Edit (artboard 48) also passes the drafted values for one cage.
    const q = router.query
    const extra = {}
    if (queryNumber(q, 'mortality')) extra.mortality = queryNumber(q, 'mortality')
    if (queryNumber(q, 'feed')) extra.feedQty = queryNumber(q, 'feed')
    if (queryValue(q, 'cause', 30)) extra.mortalityCause = queryValue(q, 'cause', 30)
    if (queryValue(q, 'notes', 500)) extra.notes = queryValue(q, 'notes', 500)
    const feedType = queryValue(q, 'feedType', 64)
    if (feedType && feedTypes.some((f) => idOf(f) === feedType)) extra.feedTypeId = feedType
    const qDate = queryDate(q, 'date')
    setError('')
    setConfirmBlank(false)
    setFormData((prev) => ({
      ...prev,
      ...(qDate ? { date: qDate } : {}),
      cageId: fresh[0],
      drafts: Object.keys(extra).length
        ? { ...(prev.drafts || {}), [fresh[0]]: { ...emptyDraft(), ...(prev.drafts || {})[fresh[0]], ...extra } }
        : prev.drafts || {},
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupsReady, router.isReady, router.query, cages])

  // ---- this cage's context: plan, history, thresholds ----------------------

  const ration = useOptionalQuery(api.feedingPlans.rationForCage, user && cageId ? { cageId } : 'skip')
  const recent = useOptionalQuery(
    api.dailyRecords.list,
    user && cageId ? { cageId, dateFrom: daysBefore(date, 7), dateTo: daysBefore(date, 1), limit: 7 } : 'skip',
  )
  const thresholds = useOptionalQuery(api.waterQuality.thresholds, user ? {} : 'skip')
  const levels = useOptionalQuery(
    api.inventory.listStockLevels,
    user && activeLocationId ? { locationId: activeLocationId } : 'skip',
  )

  const planKg = ration?.ration?.ok ? round1(ration.ration.kgPerDay) : null
  const avgDead = recent && recent.length ? Math.round(recent.reduce((s, r) => s + num(r.mortality), 0) / recent.length) : null
  const lastFeedType = recent?.find((r) => r.feed_type_id && feedTypeById.has(r.feed_type_id))?.feed_type_id

  const stored = cageId ? drafts[cageId] : null
  const draft = { ...emptyDraft(), ...(stored || {}) }
  // The cage's own feed: drafted, else what it was fed last, else the only feed type.
  const feedTypeId = draft.feedTypeId || lastFeedType || (feedTypes.length === 1 ? idOf(feedTypes[0]) : '')
  const feedType = feedTypeById.get(feedTypeId)
  const bagKg = Number(feedType?.bag_size_kg) || 20
  const planBags = Math.max(1, Math.round((planKg || bagKg) / bagKg))

  const update = (patch) => {
    if (!cageId) return
    setError('')
    setConfirmBlank(false)
    setFormData((prev) => {
      const all = prev.drafts || {}
      return { ...prev, drafts: { ...all, [cageId]: { ...emptyDraft(), ...all[cageId], ...patch } } }
    })
  }
  const step = (field, delta, decimals) => {
    const next = Math.max(0, num(draft[field]) + delta)
    update({ [field]: String(decimals ? round1(next) : Math.round(next)) })
  }

  // The org's form layout (CUSTOM-001) can hide core fields, also by condition.
  const inLayout = useMemo(
    () => new Set(layout.sections.flatMap((s) => s.fields.map((f) => f.ref))),
    [layout.sections],
  )
  const hidden = hiddenCoreKeys(layout.sections, draft, draft.custom)
  const shows = (key) => inLayout.has(`core:${key}`) && !hidden.has(key)

  const unitType = cage?.unit_type || 'cage'
  const range = (param) => thresholds?.byUnitType?.[unitType]?.[param]
  /**
   * Tile tone: 'alert' outside the unit's threshold (WQ-001), 'warn' for
   * dissolved oxygen within 1 mg/L of its floor (Paper 55 shows 4.6 amber),
   * else null.
   */
  const tone = (param, value) => {
    const r = range(param)
    if (blank(value) || !r) return null
    const v = Number(value)
    if ((r.min != null && v < r.min) || (r.max != null && v > r.max)) return 'alert'
    if (param === 'dissolvedOxygen' && r.min != null && v < r.min + DO_WATCH_MG_L) return 'warn'
    return null
  }

  // ---- next cage -----------------------------------------------------------

  const order = cages.map(idOf)
  const at = order.indexOf(cageId)
  const after = at < 0 ? order : [...order.slice(at + 1), ...order.slice(0, at)]
  const nextOpenId = after.find((id) => id !== cageId && !doneIds.has(id)) || ''
  const chipIds = after.filter((id) => id !== cageId).slice(0, CHIP_COUNT)

  // ---- save ----------------------------------------------------------------

  const kg = num(draft.feedQty)
  const mort = num(draft.mortality)
  const blankFeed = shows('feedQty') && blank(draft.feedQty)
  const onHand = (() => {
    const site = levels?.find((l) => l.feed_type_id === feedTypeId)
    if (site) return Number(site.current_stock) || 0
    return num(feedType?.current_stock ?? feedType?.currentStock)
  })()

  const validate = () => {
    const label = cageName(cageId)
    if (doneIds.has(cageId)) return t('daily.errAlreadyLogged', { label, date })
    if (kg < 0 || mort < 0) return t('daily.errNegative', { label })
    if (kg > 0 && !feedTypeId) return t('daily.errFeedType', { label })
    if (!Number.isInteger(mort)) return t('daily.errWholeMortality', { label })
    if (kg > 0 && feedType && onHand < kg) {
      return t('daily.notEnough', { name: feedType.name, onHand: onHand.toFixed(1), need: kg.toFixed(1) })
    }
    return ''
  }

  const save = async () => {
    const problem = validate()
    setError(problem)
    if (problem) return
    if (blankFeed && !confirmBlank) {
      setConfirmBlank(true)
      return
    }
    const v = { ...draft }
    // A field the layout hides is not saved (its value would be unseen).
    for (const key of hidden) v[key] = key === 'mortalityCause' ? 'unknown' : ''
    const notes = [draft.poorAppetite ? t('dailyMobile.poorAppetite') : '', v.notes?.trim()].filter(Boolean).join('. ')
    const savedId = cageId
    const name = cageName(cageId)
    const payload = {
      date,
      records: [
        {
          cageId,
          feedAmount: Math.round(num(v.feedQty) * 1000) / 1000,
          feedTypeId: feedTypeId || undefined,
          mortality: mort,
          mortalityCause: mort > 0 ? v.mortalityCause || 'unknown' : undefined,
          notes: notes || undefined,
          dissolvedOxygen: optNum(v.dissolvedOxygen),
          temperatureC: optNum(v.temperatureC),
          custom: customPayload(v.custom),
        },
      ],
    }
    setLoading(true)
    try {
      const res = await saveOrQueue({ kind: 'daily-batch', payload, summary: `${date} · ${name}`, userId })
      if (res.error) throw res.error
      // pH is not on the daily record: it goes in as a water reading (WQ-001).
      const ph = optNum(v.ph)
      let phFailed = ''
      if (ph !== undefined) {
        const wq = await saveOrQueue({ kind: 'water-quality', payload: { unitId: savedId, ph }, summary: `${name} · pH ${ph}`, userId })
        if (wq.error) phFailed = cleanError(wq.error)
      }
      setJustSaved((s) => new Set(s).add(savedId))
      setFormData((prev) => {
        const rest = { ...(prev.drafts || {}) }
        delete rest[savedId]
        return { ...prev, drafts: rest, cageId: nextOpenId || prev.cageId }
      })
      setConfirmBlank(false)
      if (phFailed) showToast(phFailed, 'error')
      showToast(
        res.queued
          ? t('common.queuedOffline')
          : nextOpenId
            ? t('dailyMobile.savedNext', { name, next: cageName(nextOpenId) })
            : t('dailyMobile.saved', { name }),
        res.queued ? 'info' : 'success',
      )
    } catch (err) {
      const msg = cleanError(err)
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  const sendNow = async () => {
    const { sent, failed } = await send()
    if (sent) showToast(t('dailyMobile.sent', { count: sent }), 'success')
    if (failed) showToast(t('dailyMobile.sendFailed', { count: failed }), 'error')
    if (!sent && !failed) showToast(t('dailyMobile.noSignal'), 'info')
  }

  const onScan = (text) => {
    setScanOpen(false)
    const hit = parseCageScan(text, cages)
    if (!hit) {
      showToast(t('common.noCageMatchesLabel'), 'error')
      return
    }
    const fresh = hit.cageIds.filter((id) => !doneIds.has(id))
    if (!fresh.length) {
      showToast(t('daily.alreadyLogged', { name: cageName(hit.cageIds[0]), date }), 'info')
      return
    }
    setCurrent(fresh[0])
    setPickerOpen(false)
  }

  // ---- render --------------------------------------------------------------

  const dateLabel = useMemo(() => {
    const d = new Date(`${date}T12:00:00Z`)
    if (Number.isNaN(d.getTime())) return date
    return new Intl.DateTimeFormat(formatLocale || locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)
  }, [date, formatLocale, locale])
  const who = user?.full_name || user?.name || ''

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push('/dashboard')
  }

  const photoField = (layout.defs || []).some((d) => d.type === 'photo' && !d.archived)
  const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
  const circle = `flex shrink-0 items-center justify-center rounded-pill border border-line-strong text-text disabled:opacity-40 ${ring}`
  const card = 'rounded-[24px] border border-line bg-surface shadow-[var(--shadow-card)]'
  const bareNumber =
    'bg-transparent p-0 text-center !font-semibold !text-text placeholder:!text-faint placeholder:!opacity-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan rounded-md'

  const saveLabel = loading
    ? t('common.saving')
    : confirmBlank && blankFeed
      ? t('daily.saveAnyway')
      : cageId && nextOpenId
        ? t('dailyMobile.saveNext', { name: cageName(cageId), next: cageName(nextOpenId) })
        : cageId
          ? t('dailyMobile.save', { name: cageName(cageId) })
          : t('daily.saveRecords')

  const tile = (key, label, step, value, toneOf) => {
    const empty = blank(value)
    return (
      <label
        htmlFor={`m-${key}`}
        className={`flex min-w-0 flex-1 basis-0 flex-col gap-1 rounded-[18px] bg-surface px-[14px] py-3 focus-within:ring-2 focus-within:ring-cyan ${
          empty ? 'border-[1.5px] border-dashed border-line-strong' : 'border border-line'
        }`}
      >
        <span className="text-xs leading-4 text-muted">{label}</span>
        <input
          id={`m-${key}`}
          type="number"
          inputMode="decimal"
          step={step}
          min="0"
          enterKeyHint="next"
          placeholder="–"
          value={value ?? ''}
          onChange={(e) => update({ [key]: e.target.value })}
          aria-invalid={toneOf === 'alert' || undefined}
          className={`w-full min-w-0 bg-transparent p-0 text-[22px] !font-semibold leading-[26px] placeholder:!text-faint placeholder:!opacity-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none ${
            toneOf === 'alert' ? '!text-alert' : toneOf === 'warn' ? '!text-warn' : '!text-text'
          }`}
        />
      </label>
    )
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = q ? cages.filter((c) => String(c.name || '').toLowerCase().includes(q)) : cages
    // Open cages first: the round is about what is left.
    return [...rows.filter((c) => !doneIds.has(idOf(c))), ...rows.filter((c) => doneIds.has(idOf(c)))]
  }, [cages, search, doneIds])

  return (
    <div className="flex flex-col pt-[max(4px,env(safe-area-inset-top))] normal-nums" data-paper="55-mobile-daily-entry">
      {/* Header: back, title with date and member, history. */}
      <div className="flex items-center justify-between pb-3">
        <button type="button" onClick={goBack} aria-label={t('dailyMobile.back')} className={`size-11 ${circle}`}>
          <Glyph d="M15 6l-6 6 6 6" size={18} />
        </button>
        <div className="flex min-w-0 flex-col items-center gap-[2px] px-2 text-center">
          <h1 className="text-[17px] font-semibold leading-[22px] text-text" data-tour="header-title">
            {t('dailyMobile.title')}
          </h1>
          <p className="max-w-full truncate text-xs leading-4 text-muted">
            {who ? t('dailyMobile.dateBy', { date: dateLabel, name: who }) : dateLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/daily-data')}
          aria-label={t('dailyMobile.history')}
          className={`size-11 ${circle}`}
        >
          <Glyph d="M12 8v4l3 2M21 12a9 9 0 11-9-9" size={18} />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {/* Sync state (MOBILE-002): what this device still holds. */}
        {(!online || queuedCount > 0) && (
          <div
            role="status"
            className="flex items-center gap-[10px] rounded-pill border border-[var(--warn-tint-border)] bg-[var(--entry-sync-bg)] px-[14px] py-[10px]"
          >
            <Glyph d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4" size={16} className={`text-warn ${sending ? 'animate-spin' : ''}`} />
            <span className="min-w-0 flex-1 text-[13px] leading-4 text-text">
              {queuedCount > 0 ? t('dailyMobile.waiting', { count: queuedCount }) : t('dailyMobile.savedOnDevice')}
            </span>
            {online ? (
              <button
                type="button"
                onClick={sendNow}
                disabled={sending}
                className={`-my-[14px] -mr-2 min-h-11 rounded-pill px-2 text-xs leading-4 text-warn ${ring}`}
              >
                {sending ? t('dailyMobile.sending') : t('dailyMobile.sendNow')}
              </button>
            ) : (
              <span className="text-xs leading-4 text-warn">{t('dailyMobile.offline')}</span>
            )}
          </div>
        )}
        {refused && <OutboxPanel compact online={online} kinds={['daily-batch']} />}

        {/* Cage chips: the current cage opens the picker; the next cages are one tap. */}
        {lookupsReady && cages.length === 0 ? (
          <p className="rounded-[18px] border border-line bg-surface px-4 py-3 text-sm text-muted">{t('daily.needsCage')}</p>
        ) : (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-haspopup="dialog"
              aria-label={cageId ? t('dailyMobile.changeCage', { name: cageName(cageId) }) : t('daily.chooseCage')}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-pill bg-button px-4 text-sm font-semibold leading-[18px] text-button-text ${ring}`}
            >
              {cageId ? cageName(cageId) : t('daily.chooseCage')}
              <Glyph d="M6 9l6 6 6-6" size={14} />
            </button>
            {chipIds.map((id) => {
              const done = doneIds.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  disabled={done}
                  onClick={() => setCurrent(id)}
                  title={done ? t('daily.alreadyLoggedTitle', { date }) : undefined}
                  className={`flex h-11 shrink-0 items-center rounded-pill border border-line-strong px-4 text-sm leading-[18px] disabled:cursor-default ${
                    done ? 'text-muted' : 'text-text'
                  } ${ring}`}
                >
                  {cageName(id)}
                  {done && (
                    <>
                      <span aria-hidden>&nbsp;✓</span>
                      <span className="sr-only">{t('daily.logged')}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Feed given: plan, feed type, stepper and quick amounts. */}
        {shows('feedQty') && (
          <section aria-labelledby="m-feed-title" className={`flex flex-col gap-3 p-[18px] ${card}`}>
            <div className="flex items-start justify-between gap-3">
              <h2 id="m-feed-title" className="text-sm font-semibold leading-[18px] text-text">
                <label htmlFor="m-feed">{t('dailyMobile.feedGiven')}</label>
              </h2>
              <p className="flex min-w-0 items-center text-xs leading-4 text-muted">
                {planKg != null && (
                  <span className="shrink-0 whitespace-nowrap">
                    {t('dailyMobile.plan', { kg: planKg.toLocaleString(formatLocale || locale) })}
                    {shows('feedTypeId') ? <span aria-hidden>&nbsp;·&nbsp;</span> : null}
                  </span>
                )}
                {shows('feedTypeId') && (
                  <>
                    <label htmlFor="m-feed-type" className="sr-only">
                      {t('daily.feedType')}
                    </label>
                    <select
                      id="m-feed-type"
                      value={feedTypeId}
                      onChange={(e) => update({ feedTypeId: e.target.value })}
                      className={`-my-[13px] min-h-11 min-w-0 max-w-[140px] cursor-pointer appearance-none truncate bg-transparent p-0 text-right text-xs leading-4 !text-muted ${ring} rounded-md`}
                    >
                      <option value="">{t('dailyMobile.chooseFeed')}</option>
                      {feedTypes.map((f) => (
                        <option key={idOf(f)} value={idOf(f)}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => step('feedQty', -1, true)}
                disabled={kg <= 0}
                aria-label={t('dailyMobile.lessFeed')}
                className={`size-14 ${circle}`}
              >
                <Glyph d={MINUS} size={22} />
              </button>
              <div className="flex items-baseline gap-[6px]">
                <input
                  id="m-feed"
                  type="number"
                  inputMode="decimal"
                  enterKeyHint="next"
                  step="0.1"
                  min="0"
                  placeholder="0"
                  value={draft.feedQty}
                  onChange={(e) => update({ feedQty: e.target.value })}
                  aria-describedby={confirmBlank && blankFeed ? 'm-blank' : undefined}
                  style={{ width: `${Math.max(1, String(draft.feedQty || '0').length)}ch` }}
                  className={`text-[52px] leading-[56px] tracking-[-0.03em] ${bareNumber}`}
                />
                <span className="text-lg leading-[22px] text-muted">kg</span>
              </div>
              <div className="rounded-pill bg-[image:var(--gradient-sky)] p-[1.5px]">
                <button
                  type="button"
                  onClick={() => step('feedQty', 1, true)}
                  aria-label={t('dailyMobile.moreFeed')}
                  className={`flex size-[53px] items-center justify-center rounded-pill bg-surface text-[var(--entry-plus-ink)] ${ring}`}
                >
                  <Glyph d={PLUS} size={22} />
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => update({ feedQty: String(round1(planBags * bagKg)) })}
                className={`relative flex-1 basis-0 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] rounded-pill bg-surface-2 px-2 py-2 text-[13px] leading-4 text-text ${ring}`}
                aria-label={t('dailyMobile.bagsAria', { count: planBags, kg: round1(planBags * bagKg) })}
              >
                {t('dailyMobile.bags', { count: planBags })}
              </button>
              <button
                type="button"
                onClick={() => planKg != null && update({ feedQty: String(planKg) })}
                disabled={planKg == null}
                className={`relative flex-1 basis-0 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] rounded-pill bg-surface-2 px-2 py-2 text-[13px] leading-4 text-text disabled:text-faint ${ring}`}
                aria-label={t('dailyMobile.asPlanAria')}
              >
                {t('dailyMobile.asPlan')}
              </button>
              <button
                type="button"
                aria-pressed={Boolean(draft.poorAppetite)}
                onClick={() => update({ poorAppetite: !draft.poorAppetite })}
                className={`relative flex-1 basis-0 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] whitespace-nowrap rounded-pill px-2 py-2 text-[13px] leading-4 ${
                  draft.poorAppetite ? 'bg-button font-semibold text-button-text' : 'bg-surface-2 text-text'
                } ${ring}`}
              >
                {t('dailyMobile.poorAppetite')}
              </button>
            </div>
          </section>
        )}

        {/* Mortality: 7-day average and details (cause, note, photo fields). */}
        {shows('mortality') && (
          <section
            aria-labelledby="m-mort-title"
            className={`flex items-center justify-between gap-2 py-[14px] pr-[14px] pl-[18px] ${card}`}
          >
            <div className="flex min-w-0 flex-col gap-[2px]">
              <h2 id="m-mort-title" className="text-sm font-semibold leading-[18px] text-text">
                <label htmlFor="m-mort">{t('daily.mortality')}</label>
              </h2>
              <p className="text-xs leading-4 text-muted">
                {t('dailyMobile.avg7', { count: avgDead ?? '\u2013' })}
                <span aria-hidden> · </span>
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  aria-haspopup="dialog"
                  className={`-my-[14px] inline-flex min-h-11 items-center rounded-sm text-muted underline-offset-2 hover:text-text hover:underline ${ring}`}
                >
                  {photoField ? t('dailyMobile.addPhoto') : t('dailyMobile.addDetails')}
                </button>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-[14px]">
              <button
                type="button"
                onClick={() => step('mortality', -1)}
                disabled={mort <= 0}
                aria-label={t('dailyMobile.fewerDead')}
                className={`size-12 ${circle}`}
              >
                <Glyph d={MINUS} size={20} />
              </button>
              <input
                id="m-mort"
                type="number"
                inputMode="numeric"
                enterKeyHint="next"
                step="1"
                min="0"
                placeholder="0"
                value={draft.mortality}
                onChange={(e) => update({ mortality: e.target.value })}
                className={`w-10 shrink-0 text-[32px] leading-9 tracking-[-0.02em] ${bareNumber}`}
              />
              <button type="button" onClick={() => step('mortality', 1)} aria-label={t('dailyMobile.moreDead')} className={`size-12 ${circle}`}>
                <Glyph d={PLUS} size={20} />
              </button>
            </div>
          </section>
        )}

        {/* Water: DO and temperature on the record, pH as a water reading. */}
        <div className="flex gap-2">
          {shows('dissolvedOxygen') &&
            tile('dissolvedOxygen', t('dailyMobile.doMgL'), '0.1', draft.dissolvedOxygen, tone('dissolvedOxygen', draft.dissolvedOxygen))}
          {shows('temperatureC') &&
            tile('temperatureC', t('dailyMobile.tempC'), '0.1', draft.temperatureC, tone('temperatureC', draft.temperatureC))}
          {tile('ph', t('dailyMobile.ph'), '0.1', draft.ph, tone('ph', draft.ph))}
        </div>

        {confirmBlank && blankFeed && (
          <p id="m-blank" role="alert" className="text-[13px] leading-[18px] text-warn">
            {t('daily.noFeedFor', { names: cageName(cageId) })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[13px] leading-[18px] text-alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={loading || !cageId}
          className="flex h-[54px] shrink-0 items-center justify-center gap-[10px] rounded-pill bg-lime px-4 text-base font-semibold leading-5 text-[var(--entry-save-ink)] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <Glyph d="M5 12l5 5L20 7" size={18} className="text-[#0a0b0c]" />
          <span className="truncate">{saveLabel}</span>
        </button>
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title={t('dailyMobile.pickCage')} labelledBy="m-picker-title">
        <div className="flex gap-2">
          <label htmlFor="m-cage-search" className="sr-only">
            {t('dailyMobile.searchCages')}
          </label>
          <Input
            id="m-cage-search"
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('dailyMobile.searchCages')}
            className="min-h-11 flex-1"
          />
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-pill border border-line-strong px-4 text-sm text-text ${ring}`}
          >
            <Glyph d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16" size={18} />
            {t('entry.scanCage')}
          </button>
        </div>
        <p className="text-xs leading-4 text-muted tabular-nums">
          {t('dailyMobile.openOfTotal', { open: openCages.length, total: cages.length })}
        </p>
        <ul className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4" aria-label={t('common.cages')}>
          {filtered.slice(0, PICKER_LIMIT).map((c) => {
            const id = idOf(c)
            const done = doneIds.has(id)
            return (
              <li key={id}>
                <button
                  type="button"
                  disabled={done}
                  aria-current={id === cageId ? 'true' : undefined}
                  onClick={() => {
                    setCurrent(id)
                    setPickerOpen(false)
                    setSearch('')
                  }}
                  className={`flex min-h-12 w-full items-center justify-between gap-3 border-b border-line text-left text-sm ${
                    done ? 'text-muted' : 'text-text'
                  } ${id === cageId ? 'font-semibold' : ''} ${ring}`}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {done ? `✓ ${t('daily.logged')}` : drafts[id] ? t('dailyMobile.inDraft') : ''}
                  </span>
                </button>
              </li>
            )
          })}
          {filtered.length > PICKER_LIMIT && (
            <li className="py-3 text-xs text-muted">{t('dailyMobile.keepTyping', { count: filtered.length - PICKER_LIMIT })}</li>
          )}
          {filtered.length === 0 && <li className="py-3 text-sm text-muted">{t('dailyMobile.noMatch')}</li>}
        </ul>
        <button
          type="button"
          onClick={() => setPickerOpen(false)}
          className={`min-h-11 rounded-pill border border-line-strong text-sm text-text ${ring}`}
        >
          {t('dailyMobile.close')}
        </button>
      </Sheet>

      <Sheet open={detailsOpen} onClose={() => setDetailsOpen(false)} title={t('dailyMobile.detailsTitle', { name: cage?.name || '' })} labelledBy="m-details-title">
        <div className="grid min-h-0 grid-cols-1 gap-4 overflow-y-auto">
          <FormLayout
            formKey="production.daily"
            layout={layout}
            fields={{
              mortalityCause:
                mort > 0 ? (
                  <Field label={t('daily.causeOfDeath')} htmlFor="m-cause">
                    <Select id="m-cause" value={draft.mortalityCause || 'unknown'} onChange={(e) => update({ mortalityCause: e.target.value })}>
                      {MORTALITY_CAUSES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null,
              notes: (
                <Field label={t('daily.note')} htmlFor="m-notes">
                  <Input
                    id="m-notes"
                    value={draft.notes}
                    onChange={(e) => update({ notes: e.target.value })}
                    placeholder={t('daily.notePlaceholder')}
                  />
                </Field>
              ),
            }}
            coreValues={draft}
            custom={draft.custom}
            onCustomChange={(next) => update({ custom: next })}
            locationId={cage?.location_id}
            core={{ mortality: mort, feedAmount: kg, mortalityCause: draft.mortalityCause }}
            idPrefix="m-cf"
          />
        </div>
        <button
          type="button"
          onClick={() => setDetailsOpen(false)}
          className={`min-h-11 rounded-pill bg-button text-sm font-semibold text-button-text ${ring}`}
        >
          {t('dailyMobile.done')}
        </button>
      </Sheet>

      <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={onScan} />
    </div>
  )
}
