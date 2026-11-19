import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { ScanLine, Trash2 } from 'lucide-react'
import { cleanError } from '../lib/offlineOutbox'
import { saveOrQueue } from '../lib/outboxSenders'
import { useOnline } from '../hooks/useOutbox'
import { useAuth } from '../contexts/AuthContext'
import OutboxPanel from './OutboxPanel'
import { parseCageScan } from '../lib/qrTarget'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { useReferenceList } from '../hooks/useReferenceList'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { Button, Field, FormCard, FormSection, Input, StickyActions } from './ui'
import DependencyEmpty from './DependencyEmpty'
import QrScanner from './QrScanner'
import { useToast } from './Toast'
import CustomFields, { customPayload } from './CustomFields'
import { useT } from '../lib/i18n/context'

const isoDay = (d = new Date()) => d.toISOString().split('T')[0]
const idOf = (x) => x?.id || x?._id

const newLine = (cageId) => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  cageId,
  fishCount: '',
  totalWeight: '',
  dissolvedOxygen: '',
  temperatureC: '',
  secchiCm: '',
})

const DEFAULTS = { date: isoDay(), showWater: false, lines: [] }

const optNum = (v) =>
  v === '' || v == null || !Number.isFinite(Number(v)) ? undefined : Number(v)

/** ABW in grams from a line, or null while incomplete. */
export const lineAbw = (line) => {
  const n = Number(line.fishCount)
  const w = Number(line.totalWeight)
  return n > 0 && w > 0 ? w / n : null
}

/**
 * Bi-weekly sampling for many cages in one pass (MOBILE-005): tap or scan the
 * cages, type fish counted and their weight for each, save once. `?cage=` and
 * `?cages=` (cage page, QR labels) pre-select cages. The draft stays on the
 * device until saved.
 */
export default function BiweeklyBatchEntry() {
  const router = useRouter()
  const { showToast } = useToast()
  const t = useT()
  const { user } = useAuth()
  const online = useOnline()
  const { locationArgs } = useLocation()
  // No signal: the cage list this user last saw on this device.
  const { list: cages, ready } = useReferenceList('cages', api.cages.getActive, locationArgs)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [errorLine, setErrorLine] = useState(null)
  const [scanOpen, setScanOpen] = useState(false)
  const prefilledFor = useRef(null)
  const { formData, setFormData, handleChange, clear } = usePersistedForm(
    'biweekly-entry-batch',
    DEFAULTS,
    { storage: 'local' },
  )
  const lines = Array.isArray(formData.lines) ? formData.lines : []

  useEffect(() => {
    setFormData((prev) => ((prev.lines || []).length === 0 ? { ...prev, date: isoDay() } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cageById = useMemo(() => new Map(cages.map((c) => [idOf(c), c])), [cages])
  const cageName = (id) => cageById.get(id)?.name || t('biweekly.unknownCage')
  const selected = new Set(lines.map((l) => l.cageId))

  const setLines = (updater) =>
    setFormData((prev) => {
      const current = Array.isArray(prev.lines) ? prev.lines : []
      return { ...prev, lines: typeof updater === 'function' ? updater(current) : updater }
    })

  const addCages = useCallback(
    (ids) =>
      setLines((ls) => {
        const have = new Set(ls.map((l) => l.cageId))
        return [...ls, ...ids.filter((id) => id && !have.has(id)).map(newLine)]
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Deep links: /biweekly-entry?cage=<id> or ?cages=a,b
  useEffect(() => {
    if (!ready || !router.isReady) return
    const raw = [router.query.cage, router.query.cages].flat().filter(Boolean).join(',')
    if (!raw || prefilledFor.current === raw) return
    prefilledFor.current = raw
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter((id) => cageById.has(id))
    if (ids.length) addCages(ids)
  }, [ready, router.isReady, router.query, cageById, addCages])

  const toggleCage = (id) => {
    if (selected.has(id)) setLines((ls) => ls.filter((l) => l.cageId !== id))
    else addCages([id])
  }

  const updateLine = (key, field, value) => {
    setErrorLine(null)
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)))
  }

  const onScan = (text) => {
    setScanOpen(false)
    const hit = parseCageScan(text, cages)
    if (!hit) {
      showToast(t('common.noCageMatchesLabel'), 'error')
      return
    }
    addCages(hit.cageIds)
    showToast(t('common.added', { names: hit.cageIds.map(cageName).join(', ') }), 'success')
  }

  const validate = () => {
    if (!formData.date) return [t('biweekly.chooseDate'), null]
    if (!lines.length) return [t('entry.selectAtLeastOne'), null]
    for (const [i, l] of lines.entries()) {
      const label = t('biweekly.lineLabel', { n: i + 1, name: cageName(l.cageId) })
      const n = Number(l.fishCount)
      if (!Number.isInteger(n) || n <= 0) return [t('biweekly.errCount', { label }), i]
      if (!(Number(l.totalWeight) > 0)) return [t('biweekly.errWeight', { label }), i]
    }
    return ['', null]
  }

  const totals = lines.reduce(
    (acc, l) => ({ fish: acc.fish + (Number(l.fishCount) || 0), done: acc.done + (lineAbw(l) ? 1 : 0) }),
    { fish: 0, done: 0 },
  )

  const handleSubmit = async (e) => {
    e.preventDefault()
    const [problem, idx] = validate()
    setError(problem)
    setErrorLine(idx)
    if (problem) return
    const payload = {
      date: formData.date,
      records: lines.map((l) => ({
        cageId: l.cageId,
        totalFishCount: Number(l.fishCount),
        totalWeight: Number(l.totalWeight),
        dissolvedOxygen: formData.showWater ? optNum(l.dissolvedOxygen) : undefined,
        temperatureC: formData.showWater ? optNum(l.temperatureC) : undefined,
        secchiCm: formData.showWater ? optNum(l.secchiCm) : undefined,
        custom: customPayload(l.custom),
      })),
    }
    const n = lines.length
    setSaving(true)
    try {
      const res = await saveOrQueue({
        kind: 'biweekly-batch',
        payload,
        summary: `${formData.date} · ${n} cage${n === 1 ? '' : 's'}`,
        userId: user?.id,
      })
      if (res.error) throw res.error
      clear()
      setFormData({ ...DEFAULTS, date: isoDay(), showWater: formData.showWater })
      showToast(
        res.queued
          ? t('common.queuedOffline')
          : t('biweekly.saved', { count: n }),
        res.queued ? 'info' : 'success',
      )
    } catch (err) {
      const msg = cleanError(err)
      const m = /^Line (\d+)/.exec(msg)
      setErrorLine(m ? Number(m[1]) - 1 : null)
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormCard
      title={t('biweekly.title')}
      subtitle={t('biweekly.subtitle')}
    >
      <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={onScan} />
      <OutboxPanel compact online={online} kinds={['biweekly-batch']} />

      {error && (
        <div
          role="alert"
          className="mb-5 text-sm text-alert border border-[var(--pill-red-border)] bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] rounded-input p-3"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <FormSection title={t('entry.date')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label={t('biweekly.samplingDate')} htmlFor="bw-date" required hint={t('common.appliesToEveryLine')}>
              <Input
                id="bw-date"
                type="date"
                name="date"
                max={isoDay()}
                value={formData.date}
                onChange={handleChange}
                required
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-text min-h-12 self-end">
              <input
                type="checkbox"
                name="showWater"
                checked={Boolean(formData.showWater)}
                onChange={handleChange}
                className="h-5 w-5 rounded border-line-strong accent-[var(--cyan)]"
              />
              {t('biweekly.recordWater')}
            </label>
          </div>
        </FormSection>

        <FormSection title={t('common.cages')} description={t('common.tapCageToAdd')}>
          {ready && cages.length === 0 ? (
            <DependencyEmpty
              message={t('biweekly.needsCage')}
              createKind="cage"
              createLabel={t('entry.createCage')}
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {cages.map((cage) => {
                  const id = idOf(cage)
                  const on = selected.has(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleCage(id)}
                      aria-pressed={on}
                      className={`min-h-12 min-w-[5.5rem] px-4 py-2 rounded-[18px] border text-left text-sm transition-colors ${
                        on
                          ? 'bg-button text-button-text border-transparent'
                          : 'bg-surface text-text border-line hover:border-line-strong'
                      }`}
                    >
                      <span className="block font-medium leading-5">{cage.name}</span>
                      {cage.current_weight != null && (
                        <span className={`block text-xs leading-4 tabular-nums ${on ? 'opacity-80' : 'text-muted'}`}>
                          {Number(cage.current_weight).toFixed(1)} g
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setScanOpen(true)}>
                  <ScanLine size={14} aria-hidden />
                  {t('entry.scanCage')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => addCages(cages.map(idOf))}
                  disabled={!cages.length}
                >
                  {t('entry.selectAll')}
                </Button>
              </div>
            </>
          )}
        </FormSection>

        <FormSection
          title={lines.length ? t('common.linesCount', { count: lines.length }) : t('common.lines')}
          description={t('biweekly.linesDescription')}
        >
          {lines.length === 0 ? (
            <p className="text-sm text-muted">{t('common.noCagesSelected')}</p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, i) => {
                const cage = cageById.get(line.cageId)
                const abw = lineAbw(line)
                const last = cage?.current_weight != null ? Number(cage.current_weight) : null
                return (
                  <div
                    key={line.key}
                    className={`rounded-input border p-3 sm:p-4 grid grid-cols-2 md:grid-cols-12 gap-x-3 gap-y-2 items-end ${
                      errorLine === i ? 'border-alert bg-[color-mix(in_oklab,var(--alert)_6%,transparent)]' : 'border-line'
                    }`}
                  >
                    <div className="col-span-2 md:col-span-12 flex items-center gap-2 min-h-12">
                      <p className="flex-1 min-w-0 truncate font-medium text-text">
                        <span className="text-muted tabular-nums mr-1.5">{i + 1}.</span>
                        {cageName(line.cageId)}
                      </p>
                      <p className="text-sm tabular-nums text-muted">
                        {abw != null ? (
                          <span className="text-text font-medium">{t('biweekly.abw', { value: abw.toFixed(1) })}</span>
                        ) : last != null ? (
                          t('biweekly.last', { value: last.toFixed(1) })
                        ) : null}
                      </p>
                      <button
                        type="button"
                        onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                        aria-label={t('entry.removeCage', { name: cageName(line.cageId) })}
                        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-input text-muted hover:bg-surface-2 hover:text-alert focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                      >
                        <Trash2 size={18} aria-hidden />
                      </button>
                    </div>
                    <Field label={t('biweekly.fishWeighed')} htmlFor={`bw-n-${line.key}`} className="md:col-span-3">
                      <Input
                        id={`bw-n-${line.key}`}
                        type="number"
                        inputMode="numeric"
                        enterKeyHint="next"
                        min="1"
                        step="1"
                        value={line.fishCount}
                        onChange={(e) => updateLine(line.key, 'fishCount', e.target.value)}
                        className="tabular-nums"
                      />
                    </Field>
                    <Field label={t('biweekly.totalWeightG')} htmlFor={`bw-w-${line.key}`} className="md:col-span-3">
                      <Input
                        id={`bw-w-${line.key}`}
                        type="number"
                        inputMode="decimal"
                        enterKeyHint="next"
                        min="0"
                        step="0.1"
                        value={line.totalWeight}
                        onChange={(e) => updateLine(line.key, 'totalWeight', e.target.value)}
                        className="tabular-nums"
                      />
                    </Field>
                    {formData.showWater && (
                      <>
                        <Field label={t('entry.doMgL')} htmlFor={`bw-do-${line.key}`} className="md:col-span-2">
                          <Input
                            id={`bw-do-${line.key}`}
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0"
                            value={line.dissolvedOxygen ?? ''}
                            onChange={(e) => updateLine(line.key, 'dissolvedOxygen', e.target.value)}
                            className="tabular-nums"
                          />
                        </Field>
                        <Field label={t('entry.tempC')} htmlFor={`bw-t-${line.key}`} className="md:col-span-2">
                          <Input
                            id={`bw-t-${line.key}`}
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            value={line.temperatureC ?? ''}
                            onChange={(e) => updateLine(line.key, 'temperatureC', e.target.value)}
                            className="tabular-nums"
                          />
                        </Field>
                        <Field label={t('entry.secchiCm')} htmlFor={`bw-s-${line.key}`} className="col-span-2 md:col-span-2">
                          <Input
                            id={`bw-s-${line.key}`}
                            type="number"
                            inputMode="numeric"
                            step="1"
                            min="0"
                            value={line.secchiCm ?? ''}
                            onChange={(e) => updateLine(line.key, 'secchiCm', e.target.value)}
                            className="tabular-nums"
                          />
                        </Field>
                      </>
                    )}
                    <div className="col-span-2 md:col-span-12">
                      <CustomFields
                        entity="biweeklyRecords"
                        value={line.custom}
                        onChange={(next) => updateLine(line.key, 'custom', next)}
                        locationId={cage?.location_id}
                        core={{ totalFishCount: Number(line.fishCount) || 0, totalWeight: Number(line.totalWeight) || 0 }}
                        idPrefix={`cf-${line.key}`}
                      />
                    </div>
                    <div className="col-span-2 md:col-span-12">
                      <Button
                        variant="ghost"
                        size="sm"
                        href={`/biweekly-entry?mode=detailed&cage=${encodeURIComponent(line.cageId)}`}
                      >
                        {t('biweekly.severalSamples')}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </FormSection>

        <StickyActions>
          {lines.length > 0 && (
            <p className="text-sm text-muted mr-auto tabular-nums">
              {t('biweekly.ready', { done: totals.done, count: lines.length, fish: totals.fish })}
            </p>
          )}
          <Button type="submit" size="lg" disabled={saving || !lines.length} className="ml-auto">
            {saving
              ? t('common.saving')
              : lines.length
                ? t('biweekly.saveN', { count: lines.length })
                : t('biweekly.saveSamples')}
          </Button>
        </StickyActions>
      </form>
    </FormCard>
  )
}
