import React, { useCallback, useState, useEffect, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useToast } from './Toast'
import DependencyEmpty from './DependencyEmpty'
import LocationMetaField from './LocationMetaField'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useOnline } from '../hooks/useOutbox'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { useReferenceList } from '../hooks/useReferenceList'
import { useLocation } from '../contexts/LocationContext'
import { useAuth } from '../contexts/AuthContext'
import { cleanError } from '../lib/offlineOutbox'
import { saveOrQueue } from '../lib/outboxSenders'
import OutboxPanel from './OutboxPanel'
import {
  Button,
  Card,
  Field,
  FormActions,
  Input,
  Select,
  Textarea,
} from './ui'
import { localToday } from '../lib/format'
import { deriveHarvestTotals } from '../lib/harvestTotals'
import { usePermission } from '../hooks/usePermission'
import { CustomFieldValues, customPayload } from './CustomFields'
import FormLayout, { hiddenCoreKeys, useFormLayout } from './FormLayout'
import { useT } from '../lib/i18n/context'
import { DEFAULT_TILAPIA_GRADES, gradeRange } from '../convex/lib/species'

/** Grades when the organization has none configured for the cage's species (today's tilapia list). */
const SIZE_CATEGORIES = DEFAULT_TILAPIA_GRADES.map((g) => ({
  category: g.key,
  label: g.label,
  range: gradeRange(g),
}))

/**
 * Harvest grades for a cage (D-012): its species' configured grades, else the
 * organization's only species, else the standard tilapia list.
 */
function gradesFor(cage, speciesList) {
  const active = (speciesList || []).filter((s) => s.harvestGrades?.length)
  const species =
    (cage?.species && active.find((s) => s.key === cage.species)) ||
    (active.length === 1 ? active[0] : null)
  if (!species) return SIZE_CATEGORIES
  return species.harvestGrades.map((g) => ({ category: g.key, label: g.label, range: g.range || gradeRange(g) }))
}

const gradeTitle = (g) => `${g.label && g.label !== g.category ? g.label : g.category} (${g.range})`

const HARVEST_DEFAULTS = {
  harvestDate: localToday(),
  cageId: '',
  harvestType: 'complete',
  totalWeight: '',
  averageBodyWeight: '',
  estimatedCount: '',
  fcr: '',
  sizeBreakdown: SIZE_CATEGORIES.map((category) => ({
    category: category.category,
    range: category.range,
    weight: '',
  })),
  notes: '',
  withdrawalOverrideReason: '',
  custom: {},
}

const HarvestForm = ({ onComplete }) => {
  const { formData, setFormData, handleChange, clear } = usePersistedForm(
    'harvest-create',
    HARVEST_DEFAULTS,
  )
  const [loading, setLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const { showToast } = useToast()
  const { user } = useAuth()
  const online = useOnline()
  const isAdmin = usePermission('production.withdrawal.override')
  const t = useT()
  const speciesList = useQuery(api.species.list, user ? {} : 'skip')
  const layout = useFormLayout('production.harvest')
  const setCustom = useCallback((custom) => setFormData((prev) => ({ ...prev, custom })), [setFormData])

  // Active cages, kept on the device for harvests logged with no signal (MOBILE-003).
  const { locationArgs } = useLocation()
  const { list: cages, ready: cagesReady } = useReferenceList('cages', api.cages.getActive, locationArgs)

  // A treatment withdrawal period refuses the harvest (PROD-012); say so up front.
  const withdrawal =
    useOptionalQuery(
      api.traceability.withdrawalStatus,
      user && online && formData.cageId && formData.harvestDate
        ? { cageId: formData.cageId, date: formData.harvestDate }
        : 'skip',
    ) ?? null

  // FCR is computed from the records (PROD-009), never typed: show it with its
  // inputs. Asked for once typing pauses.
  const [fcrArgs, setFcrArgs] = useState(null)
  useEffect(() => {
    const weight = parseFloat(formData.totalWeight)
    const count = parseInt(formData.estimatedCount, 10)
    if (!formData.cageId || !formData.harvestDate || !(weight > 0)) {
      setFcrArgs(null)
      return
    }
    const timer = setTimeout(
      () =>
        setFcrArgs({
          cageId: formData.cageId,
          harvestDate: formData.harvestDate,
          totalWeight: weight,
          ...(count > 0 ? { estimatedCount: count } : {}),
          harvestType: formData.harvestType === 'partial' ? 'partial' : 'complete',
        }),
      400,
    )
    return () => clearTimeout(timer)
  }, [formData.cageId, formData.harvestDate, formData.totalWeight, formData.estimatedCount, formData.harvestType])
  const fcrCalc = useOptionalQuery(api.harvest.suggestFcr, user && fcrArgs ? fcrArgs : 'skip') ?? null
  useEffect(() => {
    const fcr = fcrCalc?.fcr != null ? String(fcrCalc.fcr) : ''
    setFormData((prev) => (prev.fcr === fcr ? prev : { ...prev, fcr }))
  }, [fcrCalc, setFormData])

  const handleSizeBreakdownChange = (index, value) => {
    const newSizeBreakdown = [...(formData.sizeBreakdown || [])]
    newSizeBreakdown[index] = { ...newSizeBreakdown[index], weight: value }
    setFormData((prev) => ({ ...prev, sizeBreakdown: newSizeBreakdown }))
  }

  const calculateTotalWeight = () => {
    return (formData.sizeBreakdown || []).reduce((sum, size) => {
      return sum + (parseFloat(size.weight) || 0)
    }, 0)
  }

  // Size grades are optional: blanks count as 0. Missing totals are filled in
  // where they can be worked out, and every problem is named in one message.
  const validateForm = () => {
    const problems = []
    if (!formData.cageId || !cages.some((c) => (c.id || c._id) === formData.cageId)) {
      problems.push(t('harvest.problem.pickCage'))
    }
    if (!formData.harvestDate) problems.push(t('harvest.problem.setDate'))

    const { badGrade, gradeSum, total, abw, count, next, mismatch } = deriveHarvestTotals(formData)
    if (badGrade) problems.push(t('harvest.problem.fixGrade', { grade: badGrade.category }))

    if (!(total > 0)) problems.push(t('harvest.problem.totalWeight'))
    if (!(abw > 0)) problems.push(t('harvest.problem.abw'))
    if (!(count > 0)) problems.push(t('harvest.problem.count'))
    if (mismatch) {
      problems.push(
        t('harvest.problem.gradeMismatch', { sum: gradeSum, total }),
      )
    }

    if (withdrawal?.blocked) {
      if (!isAdmin) {
        problems.push(t('harvest.problem.withdrawal', { until: withdrawal.until }))
      } else if (!formData.withdrawalOverrideReason?.trim()) {
        problems.push(t('harvest.problem.overrideReason', { until: withdrawal.until }))
      }
    }

    if (Object.keys(next).length) setFormData((prev) => ({ ...prev, ...next }))
    if (problems.length) {
      const msg = problems.join(', ')
      showToast(msg.charAt(0).toUpperCase() + msg.slice(1), 'error')
      return false
    }
    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return
    setShowPreview(true)
  }

  const handleConfirmSave = async () => {
    setLoading(true)
    try {
      const hidden = hiddenCoreKeys(layout.sections, formData, formData.custom)
      const harvestData = {
        cage_id: formData.cageId,
        harvest_date: formData.harvestDate,
        harvest_type: formData.harvestType,
        status: formData.harvestType === 'complete' ? 'completed' : 'in_progress',
        total_weight: parseFloat(formData.totalWeight),
        average_body_weight: parseFloat(formData.averageBodyWeight),
        estimated_count: parseInt(formData.estimatedCount, 10),
        // Server recomputes from the ledger; this is only the fallback for
        // cages with no stocking on record.
        ...(fcrCalc?.fcr != null ? { fcr: fcrCalc.fcr } : {}),
        size_breakdown: (hidden.has('sizeBreakdown') ? [] : formData.sizeBreakdown || []).map((size) => ({
          category: size.category,
          range: size.range,
          weight: parseFloat(size.weight) || 0,
        })),
        notes: hidden.has('notes') ? '' : formData.notes,
        custom: customPayload(formData.custom),
        ...(withdrawal?.blocked && formData.withdrawalOverrideReason?.trim()
          ? { withdrawal_override_reason: formData.withdrawalOverrideReason.trim() }
          : {}),
      }

      const { error, warnings, queued } = await saveOrQueue({
        kind: 'harvest',
        payload: JSON.parse(JSON.stringify(harvestData)),
        summary: `${formData.harvestDate} · ${selectedCageObject?.name || 'Cage'} · ${
          harvestData.total_weight
        } kg ${formData.harvestType}`,
        userId: user?.id,
      })
      if (error) throw error

      showToast(
        queued
          ? t('harvest.queued')
          : formData.harvestType === 'complete'
          ? t('harvest.savedComplete', { name: selectedCageObject?.name || t('harvest.theCage') })
          : t('harvest.savedPartial'),
        'success',
      )
      if (warnings?.length) showToast(warnings.join('. '), 'warning')
      clear()
      setFormData({
        ...HARVEST_DEFAULTS,
        harvestDate: localToday(),
        sizeBreakdown: grades.map((category) => ({
          category: category.category,
          range: category.range,
          weight: '',
        })),
      })
      setShowPreview(false)
      setLoading(false)
      if (onComplete) onComplete()
    } catch (error) {
      console.error('Error saving harvest record:', error)
      showToast(cleanError(error) || t('harvest.errorSaving'), 'error')
      setLoading(false)
      setShowPreview(false)
    }
  }

  const handleEdit = () => {
    setShowPreview(false)
  }

  const selectedCageObject = cages.find(
    (cage) => (cage.id || cage._id) === formData.cageId,
  )

  // The cage's species decides the size grades; weights typed for a grade
  // that still exists are kept when the cage changes.
  const grades = useMemo(
    () => gradesFor(selectedCageObject, speciesList),
    [selectedCageObject, speciesList],
  )
  const gradeKeys = grades.map((g) => g.category).join('|')
  useEffect(() => {
    setFormData((prev) => {
      const current = prev.sizeBreakdown || []
      if (current.map((s) => s.category).join('|') === gradeKeys) return prev
      const typed = new Map(current.map((s) => [s.category, s.weight]))
      return {
        ...prev,
        sizeBreakdown: grades.map((g) => ({
          category: g.category,
          range: g.range,
          weight: typed.get(g.category) ?? '',
        })),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeKeys])

  const calculateDoc = () => {
    if (!selectedCageObject || !selectedCageObject.stocking_date || !formData.harvestDate) {
      return 'N/A'
    }
    const stockingDate = new Date(selectedCageObject.stocking_date)
    const harvestDate = new Date(formData.harvestDate)
    const timeDiff = harvestDate.getTime() - stockingDate.getTime()
    const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))
    return dayDiff >= 0 ? dayDiff : 'N/A'
  }

  const cageDoc = calculateDoc()
  const sizeBreakdown =
    formData.sizeBreakdown?.length > 0
      ? formData.sizeBreakdown
      : HARVEST_DEFAULTS.sizeBreakdown
  const gradeLabel = (size) =>
    gradeTitle(grades.find((g) => g.category === size.category) || size)

  const previewRow = (label, value) => (
    <div className="flex justify-between gap-4 py-2 border-b border-line text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-text tabular-nums text-right">{value}</dd>
    </div>
  )

  const layoutFields = {
    cageId: (
      <Field label={t('harvest.cage')} htmlFor="harvest-cage" required>
        <Select
          id="harvest-cage"
          name="cageId"
          value={formData.cageId}
          onChange={handleChange}
          required
          disabled={cagesReady && cages.length === 0}
        >
          <option value="">
            {cagesReady && cages.length === 0
              ? t('harvest.noActiveCages')
              : t('harvest.selectCage')}
          </option>
          {cages.map((cage) => (
            <option key={cage.id || cage._id} value={cage.id || cage._id}>
              {cage.name}
            </option>
          ))}
        </Select>
        {cagesReady && cages.length === 0 && (
          <DependencyEmpty
            message={t('harvest.needsCage')}
            createKind="stocking"
            createLabel={t('harvest.createStocking')}
            secondaryCreateKind="cage"
            secondaryCreateLabel={t('entry.createCage')}
            onCreated={() => showToast(t('harvest.afterApproval'), 'success')}
          />
        )}
      </Field>
    ),
    harvestDate: (
      <Field label={t('harvest.date')} htmlFor="harvest-date" required>
        <Input
          id="harvest-date"
          type="date"
          name="harvestDate"
          value={formData.harvestDate}
          onChange={handleChange}
          required
        />
      </Field>
    ),
    harvestType: (
      <Field label={t('harvest.type')} htmlFor="harvest-type" required>
        <Select
          id="harvest-type"
          name="harvestType"
          value={formData.harvestType}
          onChange={handleChange}
          required
        >
          <option value="complete">{t('harvest.complete')}</option>
          <option value="partial">{t('harvest.partial')}</option>
        </Select>
      </Field>
    ),
    totalWeight: (
      <Field label={t('harvest.totalWeightKg')} htmlFor="harvest-total" required>
        <Input
          id="harvest-total"
          type="number"
          name="totalWeight"
          value={formData.totalWeight}
          onChange={handleChange}
          step="0.01"
          className="tabular-nums"
          required
        />
      </Field>
    ),
    averageBodyWeight: (
      <Field label={t('harvest.abwG')} htmlFor="harvest-abw" required>
        <Input
          id="harvest-abw"
          type="number"
          name="averageBodyWeight"
          value={formData.averageBodyWeight}
          onChange={handleChange}
          step="0.01"
          className="tabular-nums"
          required
        />
      </Field>
    ),
    estimatedCount: (
      <Field label={t('harvest.estimatedCount')} htmlFor="harvest-count" required>
        <Input
          id="harvest-count"
          type="number"
          name="estimatedCount"
          value={formData.estimatedCount}
          onChange={handleChange}
          className="tabular-nums"
          required
        />
      </Field>
    ),
    fcr: (
      <Field label={t('harvest.fcrLong')} htmlFor="harvest-fcr">
        <output
          id="harvest-fcr"
          aria-live="polite"
          className="block rounded-input border border-line bg-bg px-3 py-2 text-sm font-semibold tabular-nums text-text"
        >
          {fcrCalc?.fcr != null ? fcrCalc.fcr.toFixed(2) : '—'}
        </output>
        <p className="text-xs text-muted tabular-nums">
          {!fcrCalc
            ? t('harvest.fcrPending')
            : fcrCalc.fcr == null
              ? t('harvest.fcrNotEnough')
              : fcrCalc.gain_kg != null
                ? t('harvest.fcrComputed', {
                    feed: Number(fcrCalc.feed_kg),
                    gain: Number(fcrCalc.gain_kg),
                    since: fcrCalc.stocking_date,
                  })
                : t('harvest.fcrCalculated', {
                    fcr: fcrCalc.fcr.toFixed(2),
                    feed: Number(fcrCalc.feed_kg),
                    since: fcrCalc.stocking_date,
                    stocked: Number(fcrCalc.stocked_biomass_kg || 0),
                  })}
          {fcrCalc?.fcr != null && fcrCalc.method === 'interim' && <> {t('harvest.fcrInterim')}</>}
        </p>
      </Field>
    ),
    sizeBreakdown: (
      <div role="group" aria-label={t('harvest.sizeBreakdown')} className="space-y-3">
        <p className="text-xs text-muted tabular-nums">
          {t('harvest.gradesOptional')}
          {calculateTotalWeight() > 0 &&
            ` ${t(formData.totalWeight ? 'harvest.gradesAddUp' : 'harvest.gradesAddUpAsTotal', {
              sum: calculateTotalWeight(),
            })}`}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {sizeBreakdown.map((size, index) => (
            <Field
              key={size.category}
              label={gradeLabel(size)}
              htmlFor={`harvest-grade-${size.category}`}
            >
              <Input
                id={`harvest-grade-${size.category}`}
                type="number"
                value={size.weight}
                onChange={(e) => handleSizeBreakdownChange(index, e.target.value)}
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0"
                className="tabular-nums"
              />
            </Field>
          ))}
        </div>
      </div>
    ),
    notes: (
      <Field label={t('common.notes')} htmlFor="harvest-notes">
        <Textarea
          id="harvest-notes"
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          rows={3}
          placeholder={t('harvest.notesPlaceholder')}
        />
      </Field>
    ),
  }

  return (
    <Card>
      <OutboxPanel compact online={online} kinds={['harvest']} />
      {!showPreview ? (
        <form onSubmit={handleSubmit} noValidate className="space-y-8">
          <p className="text-sm text-muted">{t('harvest.draftsSurvive')}</p>
          <LocationMetaField />
          {withdrawal?.blocked && (
            <div
              role="alert"
              className="rounded-input border border-[var(--pill-red-border)] bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] px-4 py-3 text-sm text-text space-y-3"
            >
              <p>
                <span className="font-medium">{t('harvest.withdrawalUntil', { until: withdrawal.until })}</span>{' '}
                {withdrawal.treatments.map((t) => `${t.product} (${t.date})`).join(', ')}.{' '}
                {isAdmin
                  ? t('harvest.withdrawalAdmin')
                  : t('harvest.withdrawalOnlyAdmin')}
              </p>
              {isAdmin && (
                <Field label={t('harvest.overrideReason')} htmlFor="harvest-withdrawal-reason" required>
                  <Textarea
                    id="harvest-withdrawal-reason"
                    name="withdrawalOverrideReason"
                    value={formData.withdrawalOverrideReason || ''}
                    onChange={handleChange}
                    rows={2}
                    placeholder={t('harvest.overridePlaceholder')}
                  />
                </Field>
              )}
            </div>
          )}
          <FormLayout
            formKey="production.harvest"
            layout={layout}
            fields={layoutFields}
            coreValues={formData}
            custom={formData.custom}
            onCustomChange={setCustom}
            locationId={selectedCageObject?.location_id}
            core={{ harvestType: formData.harvestType, totalWeight: Number(formData.totalWeight) || 0 }}
            idPrefix="hv-cf"
          />

          <FormActions className="justify-end">
            <Button type="button" variant="secondary" onClick={() => onComplete()}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={loading || cages.length === 0}>
              {t('harvest.review')}
            </Button>
          </FormActions>
        </form>
      ) : (
        <div className="space-y-6">
          <h3 className="text-[17px] leading-[22px] font-semibold text-text">
            {t('harvest.checkBeforeSaving')}
          </h3>

          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            {previewRow(t('harvest.cage'), selectedCageObject?.name || t('harvest.na'))}
            {previewRow(t('harvest.date'), formData.harvestDate)}
            {selectedCageObject?.stocking_date &&
              previewRow(t('harvest.stockingDate'), selectedCageObject.stocking_date)}
            {previewRow(t('harvest.doc'), cageDoc === 'N/A' ? t('harvest.na') : cageDoc)}
            {previewRow(
              t('harvest.type'),
              formData.harvestType === 'complete' ? t('harvest.complete') : t('harvest.partial'),
            )}
            {previewRow(t('harvest.totalWeight'), `${formData.totalWeight} kg`)}
            {previewRow(t('harvest.abw'), `${formData.averageBodyWeight} g`)}
            {previewRow(t('harvest.estimatedCount'), formData.estimatedCount)}
            {previewRow('FCR', fcrCalc?.fcr != null ? fcrCalc.fcr.toFixed(2) : '—')}
          </dl>

          <p className="rounded-input border border-line bg-bg p-3 text-sm text-text tabular-nums">
            {formData.harvestType === 'complete'
              ? t('harvest.previewComplete', { name: selectedCageObject?.name || t('harvest.thisCage') })
              : t('harvest.previewPartial', {
                  count: Number(formData.estimatedCount || 0),
                  name: selectedCageObject?.name || t('harvest.thisCage'),
                })}
            {selectedCageObject?.current_count != null &&
              ` ${t('harvest.onRecord', { count: Number(selectedCageObject.current_count) })}`}
          </p>

          <div>
            <h4 className="text-base font-medium text-text mb-3">{t('harvest.sizeBreakdown')}</h4>
            <ul className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {sizeBreakdown.map((size) => (
                <li
                  key={size.category}
                  className="rounded-input border border-line bg-bg p-3 text-sm text-text"
                >
                  <span className="text-muted">{gradeLabel(size)}</span>
                  <span className="block font-medium tabular-nums">
                    {size.weight || '0'} kg
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <CustomFieldValues entity="harvestRecords" values={customPayload(formData.custom)} />

          {formData.notes && (
            <div>
              <h4 className="text-base font-medium text-text mb-2">{t('common.notes')}</h4>
              <p className="text-sm text-text bg-bg p-3 rounded-input">
                {formData.notes}
              </p>
            </div>
          )}

          <FormActions className="justify-end">
            <Button type="button" variant="secondary" onClick={handleEdit}>
              {t('common.edit')}
            </Button>
            <Button type="button" onClick={handleConfirmSave} disabled={loading}>
              {loading ? t('common.saving') : t('harvest.save')}
            </Button>
          </FormActions>
        </div>
      )}
    </Card>
  )
}

export default HarvestForm
