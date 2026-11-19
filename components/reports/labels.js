/**
 * Labels and number formats of the report builder (ANLY-001). The catalog in
 * convex/lib/reportCatalog.ts is English; the UI translates by id and falls
 * back to the catalog's label.
 */
import { DATASETS, DIMENSION_LABELS, measureDef } from '../../convex/lib/reportCatalog'
import { formatMoney, formatNumber } from '../../lib/format'

export const datasetLabel = (t, id) => t.or(`reportBuilder.dataset.${id}`, DATASETS[id]?.label ?? id)

export const dimensionLabel = (t, id) => t.or(`reportBuilder.dimension.${id}`, DIMENSION_LABELS[id] ?? id)

export const measureLabel = (t, dataset, id) =>
  t.or(`reportBuilder.measure.${dataset}.${id}`, measureDef(dataset, id)?.label ?? id)

export const columnLabel = (t, dataset, column) =>
  column.kind === 'dimension' ? dimensionLabel(t, column.id) : measureLabel(t, dataset, column.id)

export function formatCell(value, format) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value !== 'number') return value
  switch (format) {
    case 'money':
      return formatMoney(value)
    case 'pct':
      return `${formatNumber(value, { decimals: 1 })} %`
    case 'ratio':
      return formatNumber(value, { decimals: 2 })
    case 'count':
      return formatNumber(value)
    default:
      return formatNumber(value, { decimals: Number.isInteger(value) ? 0 : 2 })
  }
}

/** Display label of a row: its dimension values joined. */
export function rowLabel(row, dimensions) {
  return dimensions.map((d) => row[d] ?? '—').join(' · ') || '—'
}
