import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import {
  CHART_TYPES,
  DATASETS,
  DATASET_IDS,
  GRANULARITIES,
  LIMITS,
  RANGE_PRESETS,
  checkDefinition,
  defaultDefinition,
} from '../../convex/lib/reportCatalog'
import { Button, Card, Field, Input, Select, Textarea } from '../ui'
import { useT } from '../../lib/i18n/context'
import { usePermission } from '../../hooks/usePermission'
import { useToast } from '../Toast'
import { errorMessage } from '../../lib/errorMessage'
import ReportResult from './ReportResult'
import { datasetLabel, dimensionLabel, measureLabel } from './labels'

const PAYMENT_STATUSES = ['paid', 'partial', 'pending']

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

function Chip({ checked, disabled, onChange, children }) {
  return (
    <label
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
        checked ? 'border-lagoon-700 bg-foam text-chart-ink' : 'border-foam-deep text-muted'
      } ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <input type="checkbox" className="h-4 w-4" checked={checked} disabled={disabled} onChange={onChange} />
      {children}
    </label>
  )
}

function toggle(list, value, max) {
  if (list.includes(value)) return list.filter((x) => x !== value)
  return list.length >= max ? list : [...list, value]
}

/** Values offered for one filter dimension, from reportBuilder.filterOptions. */
function filterChoices(t, dimension, options) {
  if (dimension === 'payment_status') {
    return PAYMENT_STATUSES.map((s) => ({ value: s, label: t(`reportBuilder.paymentStatus.${s}`) }))
  }
  return options?.[dimension] ?? []
}

/**
 * Builder of a saved or new report (ANLY-001): dataset, grouping, measures,
 * range, filters and chart, with a live preview. `report` is a row of
 * reportBuilder.list or null for a new report; render it with a `key` per
 * report so switching reports starts from that report's definition.
 */
export default function ReportBuilder({ report, onSaved, onDeleted }) {
  const t = useT()
  const { showToast } = useToast()
  const canManage = usePermission('reports.manage')
  const options = useQuery(api.reportBuilder.filterOptions, {})
  const save = useMutation(api.reportBuilder.save)
  const remove = useMutation(api.reportBuilder.remove)
  const [def, setDef] = useState(() => report?.definition ?? defaultDefinition('production'))
  const [name, setName] = useState(report?.name ?? '')
  const [description, setDescription] = useState(report?.description ?? '')
  const [visibility, setVisibility] = useState(report?.visibility ?? 'private')
  const [saving, setSaving] = useState(false)
  const editable = canManage && (!report || report.canEdit)
  const ds = DATASETS[def.dataset]

  const debounced = useDebounced(def, 400)
  const problem = useMemo(() => checkDefinition(debounced), [debounced])
  const patch = (p) => setDef((d) => ({ ...d, ...p }))

  const setDataset = (dataset) => setDef({ ...defaultDefinition(dataset), range: def.range })
  const setDimensions = (dimensions) =>
    patch({
      dimensions,
      granularity: dimensions.includes('period') ? def.granularity ?? 'month' : undefined,
      sort: def.sort && [...dimensions, ...def.measures].includes(def.sort.by) ? def.sort : undefined,
    })
  const setMeasures = (measures) =>
    patch({
      measures,
      chart: { ...def.chart, measure: measures.includes(def.chart.measure) ? def.chart.measure : undefined },
      sort: def.sort && [...def.dimensions, ...measures].includes(def.sort.by) ? def.sort : undefined,
    })
  const filterValues = (dimension) => def.filters.find((f) => f.dimension === dimension)?.values ?? []
  const setFilter = (dimension, values) =>
    patch({
      filters: [...def.filters.filter((f) => f.dimension !== dimension), ...(values.length ? [{ dimension, values }] : [])],
    })
  const filterDims = ds.dimensions.filter((d) => ['site', 'cage', 'species', 'payment_status'].includes(d))

  const onSave = async (asNew) => {
    const issue = checkDefinition(def)
    if (issue) return showToast(issue, 'error')
    if (!name.trim()) return showToast(t('reportBuilder.builder.nameRequired'), 'error')
    setSaving(true)
    try {
      const id = await save({
        reportId: asNew ? undefined : report?._id,
        name,
        description: description || undefined,
        visibility,
        definition: def,
      })
      showToast(t('reportBuilder.builder.saved'), 'success')
      onSaved?.(id)
    } catch (e) {
      showToast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!report || !window.confirm(t('reportBuilder.builder.confirmDelete', { name: report.name }))) return
    try {
      await remove({ reportId: report._id })
      showToast(t('reportBuilder.builder.deleted'), 'success')
      onDeleted?.()
    } catch (e) {
      showToast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <Card>
        <div className="space-y-5">
          <Field label={t('reportBuilder.builder.dataset')} htmlFor="rb-dataset">
            <Select id="rb-dataset" value={def.dataset} onChange={(e) => setDataset(e.target.value)}>
              {DATASET_IDS.map((id) => (
                <option key={id} value={id}>
                  {datasetLabel(t, id)}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-chart-ink">
              {t('reportBuilder.builder.groupBy', { max: LIMITS.dimensions })}
            </legend>
            <div className="flex flex-wrap gap-2">
              {ds.dimensions.map((d) => (
                <Chip
                  key={d}
                  checked={def.dimensions.includes(d)}
                  disabled={!def.dimensions.includes(d) && def.dimensions.length >= LIMITS.dimensions}
                  onChange={() => setDimensions(toggle(def.dimensions, d, LIMITS.dimensions))}
                >
                  {dimensionLabel(t, d)}
                </Chip>
              ))}
            </div>
          </fieldset>

          {def.dimensions.includes('period') && (
            <Field label={t('reportBuilder.builder.granularity')} htmlFor="rb-granularity">
              <Select id="rb-granularity" value={def.granularity ?? 'month'} onChange={(e) => patch({ granularity: e.target.value })}>
                {GRANULARITIES.map((g) => (
                  <option key={g} value={g}>
                    {t(`reportBuilder.granularity.${g}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-chart-ink">{t('reportBuilder.builder.measures')}</legend>
            <div className="flex flex-wrap gap-2">
              {ds.measures.map((m) => (
                <Chip
                  key={m.id}
                  checked={def.measures.includes(m.id)}
                  disabled={!def.measures.includes(m.id) && def.measures.length >= LIMITS.measures}
                  onChange={() => setMeasures(toggle(def.measures, m.id, LIMITS.measures))}
                >
                  {measureLabel(t, def.dataset, m.id)}
                </Chip>
              ))}
            </div>
          </fieldset>

          {ds.dated ? (
            <div className="space-y-3">
              <Field label={t('reportBuilder.builder.range')} htmlFor="rb-range">
                <Select
                  id="rb-range"
                  value={def.range.preset}
                  onChange={(e) => patch({ range: { ...def.range, preset: e.target.value } })}
                >
                  {RANGE_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {t(`reportBuilder.range.${p}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {def.range.preset === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('reportBuilder.builder.from')} htmlFor="rb-from">
                    <Input
                      id="rb-from"
                      type="date"
                      value={def.range.from ?? ''}
                      onChange={(e) => patch({ range: { ...def.range, from: e.target.value } })}
                    />
                  </Field>
                  <Field label={t('reportBuilder.builder.to')} htmlFor="rb-to">
                    <Input
                      id="rb-to"
                      type="date"
                      value={def.range.to ?? ''}
                      onChange={(e) => patch({ range: { ...def.range, to: e.target.value } })}
                    />
                  </Field>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">{t('reportBuilder.builder.snapshotNote')}</p>
          )}

          {filterDims.map((d) => {
            const choices = filterChoices(t, d, options)
            if (!choices.length) return null
            const selected = filterValues(d)
            return (
              <Field key={d} label={t('reportBuilder.builder.filter', { dimension: dimensionLabel(t, d) })} htmlFor={`rb-f-${d}`}>
                <Select
                  id={`rb-f-${d}`}
                  multiple
                  size={Math.min(5, choices.length)}
                  value={selected}
                  onChange={(e) =>
                    setFilter(
                      d,
                      [...e.target.selectedOptions].map((o) => o.value).slice(0, LIMITS.filterValues),
                    )
                  }
                >
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted">
                  {selected.length ? t('reportBuilder.builder.filterCount', { count: selected.length }) : t('reportBuilder.builder.filterAll')}
                </p>
              </Field>
            )
          })}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('reportBuilder.builder.chart')} htmlFor="rb-chart">
              <Select
                id="rb-chart"
                value={def.chart.type}
                onChange={(e) => patch({ chart: { ...def.chart, type: e.target.value } })}
              >
                {CHART_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {t(`reportBuilder.chart.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {def.chart.type !== 'table' && def.measures.length > 1 && (
              <Field label={t('reportBuilder.builder.chartMeasure')} htmlFor="rb-chart-measure">
                <Select
                  id="rb-chart-measure"
                  value={def.chart.measure ?? def.measures[0]}
                  onChange={(e) => patch({ chart: { ...def.chart, measure: e.target.value } })}
                >
                  {def.measures.map((m) => (
                    <option key={m} value={m}>
                      {measureLabel(t, def.dataset, m)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <Field label={t('reportBuilder.builder.limit')} htmlFor="rb-limit" hint={t('reportBuilder.builder.limitHint', { max: LIMITS.resultRows })}>
            <Input
              id="rb-limit"
              type="number"
              min={1}
              max={LIMITS.resultRows}
              value={def.limit ?? ''}
              onChange={(e) => patch({ limit: e.target.value ? Math.floor(Number(e.target.value)) : undefined })}
            />
          </Field>

          {editable && (
            <div className="space-y-3 border-t border-foam-deep pt-5">
              <Field label={t('reportBuilder.builder.name')} htmlFor="rb-name" required>
                <Input id="rb-name" maxLength={LIMITS.nameLength} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t('reportBuilder.builder.description')} htmlFor="rb-description">
                <Textarea
                  id="rb-description"
                  rows={2}
                  maxLength={LIMITS.descriptionLength}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label={t('reportBuilder.builder.visibility')} htmlFor="rb-visibility">
                <Select id="rb-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  <option value="private">{t('reportBuilder.visibility.private')}</option>
                  <option value="company">{t('reportBuilder.visibility.company')}</option>
                </Select>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => onSave(false)} disabled={saving}>
                  {report ? t('reportBuilder.builder.update') : t('reportBuilder.builder.save')}
                </Button>
                {report && (
                  <>
                    <Button variant="secondary" onClick={() => onSave(true)} disabled={saving}>
                      {t('reportBuilder.builder.saveAsNew')}
                    </Button>
                    <Button variant="ghost" onClick={onDelete}>
                      {t('reportBuilder.builder.delete')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          {canManage && report && !report.canEdit && (
            <p className="text-sm text-muted">{t('reportBuilder.builder.readOnly', { name: report.createdByName })}</p>
          )}
        </div>
      </Card>
      <Card>
        <ReportResult definition={debounced} name={name || report?.name} problem={problem} />
      </Card>
    </div>
  )
}
