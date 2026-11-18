import React, { useState, useEffect, useMemo } from 'react'
import { useQuery } from 'convex/react'
import { harvestRecordService, cageService } from '../lib/databaseService'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { useToast } from './Toast'
import DependencyEmpty from './DependencyEmpty'
import LocationMetaField from './LocationMetaField'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useOnline } from '../hooks/useOutbox'
import { useAuth } from '../contexts/AuthContext'
import { cleanError } from '../lib/offlineOutbox'
import { saveOrQueue } from '../lib/outboxSenders'
import OutboxPanel from './OutboxPanel'
import {
  Button,
  Card,
  Field,
  FormActions,
  FormSection,
  Input,
  Select,
  Textarea,
} from './ui'
import { localToday } from '../lib/format'
import { getActiveLocationId } from '../lib/locationScope'
import { readReferenceList, saveReferenceData } from '../lib/referenceCache'
import { usePermission } from '../hooks/usePermission'
import CustomFields, { CustomFieldValues, customPayload } from './CustomFields'
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
  const [cages, setCages] = useState([])
  const [cagesReady, setCagesReady] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [fcrCalc, setFcrCalc] = useState(null)
  const [fcrTouched, setFcrTouched] = useState(false)
  const { showToast } = useToast()
  const { user, hasRole } = useAuth()
  const online = useOnline()
  const isAdmin = usePermission('production.withdrawal.override')
  const t = useT()
  const speciesList = useQuery(api.species.list, user ? {} : 'skip')
  const [withdrawal, setWithdrawal] = useState(null)

  // A treatment withdrawal period refuses the harvest (PROD-012); say so up front.
  useEffect(() => {
    if (!formData.cageId || !formData.harvestDate || !online) {
      setWithdrawal(null)
      return
    }
    let cancelled = false
    getConvexHttpClient()
      .query(api.traceability.withdrawalStatus, {
        cageId: formData.cageId,
        date: formData.harvestDate,
      })
      .then((res) => !cancelled && setWithdrawal(res))
      .catch(() => !cancelled && setWithdrawal(null))
    return () => {
      cancelled = true
    }
  }, [formData.cageId, formData.harvestDate, online])

  useEffect(() => {
    const fetchCages = async () => {
      try {
        const { data, error } = await cageService.getActiveCages()
        if (error) throw error
        setCages(data || [])
        saveReferenceData(user?.id, getActiveLocationId(), { cages: data || [] })
      } catch (error) {
        // No signal: the cage list this user last saw on this device.
        const cached = readReferenceList(user?.id, getActiveLocationId(), 'cages')
        if (cached) {
          setCages(cached)
        } else {
          console.error('Error fetching cages:', error)
          showToast(t('harvest.errorFetchingCages'), 'error')
        }
      } finally {
        setCagesReady(true)
      }
    }

    fetchCages()
  }, [showToast, t, user?.id])

  // Work out FCR from the feed logged since stocking once cage, date and weight are known.
  useEffect(() => {
    const weight = parseFloat(formData.totalWeight)
    if (!formData.cageId || !formData.harvestDate || !(weight > 0)) {
      setFcrCalc(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await getConvexHttpClient().query(api.harvest.suggestFcr, {
          cageId: formData.cageId,
          harvestDate: formData.harvestDate,
          totalWeight: weight,
        })
        if (cancelled) return
        setFcrCalc(res)
        if (res?.fcr != null && !fcrTouched) {
          setFormData((prev) => ({ ...prev, fcr: String(res.fcr) }))
        }
      } catch {
        if (!cancelled) setFcrCalc(null)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.cageId, formData.harvestDate, formData.totalWeight])

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

  const num = (v) => (v === '' || v == null ? null : Number(v))

  // Size grades are optional: blanks count as 0. Missing totals are filled in
  // where they can be worked out, and every problem is named in one message.
  const validateForm = () => {
    const problems = []
    const next = {}
    if (!formData.cageId || !cages.some((c) => (c.id || c._id) === formData.cageId)) {
      problems.push(t('harvest.problem.pickCage'))
    }
    if (!formData.harvestDate) problems.push(t('harvest.problem.setDate'))

    const badGrade = (formData.sizeBreakdown || []).find((s) => {
      const n = num(s.weight)
      return n != null && (!Number.isFinite(n) || n < 0)
    })
    if (badGrade) problems.push(t('harvest.problem.fixGrade', { grade: badGrade.category }))
    const gradeSum = calculateTotalWeight()

    let total = num(formData.totalWeight)
    if (total == null && gradeSum > 0) {
      total = Math.round(gradeSum * 100) / 100
      next.totalWeight = String(total)
    }
    const abw = num(formData.averageBodyWeight)
    let count = num(formData.estimatedCount)
    if (count == null && total > 0 && abw > 0) {
      count = Math.round((total * 1000) / abw)
      next.estimatedCount = String(count)
    }
    let fcrVal = num(formData.fcr)
    if (fcrVal == null && fcrCalc?.fcr != null) {
      fcrVal = fcrCalc.fcr
      next.fcr = String(fcrVal)
    }

    if (!(total > 0)) problems.push(t('harvest.problem.totalWeight'))
    if (!(abw > 0)) problems.push(t('harvest.problem.abw'))
    if (!(count > 0)) problems.push(t('harvest.problem.count'))
    if (!(fcrVal > 0)) {
      problems.push(
        fcrCalc && fcrCalc.fcr == null
          ? t('harvest.problem.fcrNoFeed')
          : t('harvest.problem.fcr'),
      )
    }
    if (total > 0 && gradeSum > 0 && Math.abs(gradeSum - total) > 0.5) {
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
      const harvestData = {
        cage_id: formData.cageId,
        harvest_date: formData.harvestDate,
        harvest_type: formData.harvestType,
        status: formData.harvestType === 'complete' ? 'completed' : 'in_progress',
        total_weight: parseFloat(formData.totalWeight),
        average_body_weight: parseFloat(formData.averageBodyWeight),
        estimated_count: parseInt(formData.estimatedCount, 10),
        fcr: parseFloat(formData.fcr),
        size_breakdown: (formData.sizeBreakdown || []).map((size) => ({
          category: size.category,
          range: size.range,
          weight: parseFloat(size.weight) || 0,
        })),
        notes: formData.notes,
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
    <div className="flex justify-between gap-4 py-2 border-b border-foam-deep text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-chart-ink tabular-nums text-right">{value}</dd>
    </div>
  )

  return (
    <Card>
      <OutboxPanel compact online={online} kinds={['harvest']} />
      {!showPreview ? (
        <form onSubmit={handleSubmit} noValidate className="space-y-8">
          <FormSection
            title={t('harvest.details')}
            description={t('harvest.draftsSurvive')}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <LocationMetaField />
              </div>
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
                    onCreated={async () => {
                      try {
                        const { data, error } = await cageService.getActiveCages()
                        if (error) throw error
                        setCages(data || [])
                        showToast(
                          t('harvest.afterApproval'),
                          'success',
                        )
                      } catch (err) {
                        showToast(err.message || t('harvest.failedRefresh'), 'error')
                      }
                    }}
                  />
                )}
              </Field>

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

              {withdrawal?.blocked && (
                <div
                  role="alert"
                  className="md:col-span-2 rounded-lg border border-signal/40 bg-signal/10 px-4 py-3 text-sm text-chart-ink space-y-3"
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

              <Field label={t('harvest.fcrLong')} htmlFor="harvest-fcr" required>
                <Input
                  id="harvest-fcr"
                  type="number"
                  name="fcr"
                  value={formData.fcr}
                  onChange={(e) => {
                    setFcrTouched(true)
                    handleChange(e)
                  }}
                  step="0.01"
                  className="tabular-nums"
                  required
                />
                {fcrCalc && (
                  <p className="text-xs text-muted tabular-nums">
                    {fcrCalc.fcr != null
                      ? t('harvest.fcrCalculated', {
                          fcr: fcrCalc.fcr.toFixed(2),
                          feed: Number(fcrCalc.feed_kg),
                          since: fcrCalc.stocking_date,
                          stocked: Number(fcrCalc.stocked_biomass_kg || 0),
                        })
                      : t('harvest.fcrNotEnough')}
                    {fcrCalc.fcr != null && fcrTouched && Number(formData.fcr) !== fcrCalc.fcr && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="text-lake underline underline-offset-2"
                          onClick={() => {
                            setFcrTouched(false)
                            setFormData((prev) => ({ ...prev, fcr: String(fcrCalc.fcr) }))
                          }}
                        >
                          {t('harvest.useCalculated')}
                        </button>
                      </>
                    )}
                  </p>
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection title={t('harvest.sizeBreakdown')}>
            <p className="text-xs text-muted -mt-2 tabular-nums">
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
          </FormSection>

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

          <CustomFields
            entity="harvestRecords"
            value={formData.custom}
            onChange={(custom) => setFormData((prev) => ({ ...prev, custom }))}
            locationId={selectedCageObject?.location_id}
            core={{ harvestType: formData.harvestType, totalWeight: Number(formData.totalWeight) || 0 }}
            title="More details"
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
          <h3 className="font-display text-lg font-medium text-chart-ink">
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
            {previewRow('FCR', formData.fcr)}
          </dl>

          <p className="rounded-lg border border-foam-deep bg-foam p-3 text-sm text-chart-ink tabular-nums">
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
            <h4 className="text-base font-medium text-chart-ink mb-3">{t('harvest.sizeBreakdown')}</h4>
            <ul className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {sizeBreakdown.map((size) => (
                <li
                  key={size.category}
                  className="rounded-lg border border-foam-deep bg-foam p-3 text-sm text-chart-ink"
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
              <h4 className="text-base font-medium text-chart-ink mb-2">{t('common.notes')}</h4>
              <p className="text-sm text-chart-ink bg-foam p-3 rounded-lg">
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
