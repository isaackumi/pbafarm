import React, { useState } from 'react'
import Layout from '../components/Layout'
import ProtectedRoute from '../components/ProtectedRoute'
import { GradientButton, Segmented } from '../components/ui'
import { SettingsFrame, SettingsCard, SettingsRow, InlineError, FIELD } from '../components/settings'
import { useT } from '../lib/i18n/context'
import { useConvex } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { localToday } from '../lib/format'
import { useLocation } from '../contexts/LocationContext'
import { customCell, customColumns } from '../components/CustomFields'

/** Sheet name → custom field entity (D-007): custom values become one column per field. */
const SHEET_ENTITY = {
  daily_records: 'dailyRecords',
  biweekly_records: 'biweeklyRecords',
  harvest_records: 'harvestRecords',
  cages: 'cages',
  stocking_history: 'stockingHistory',
}

function flattenCustom(sheets, defs) {
  const out = {}
  for (const [name, rows] of Object.entries(sheets)) {
    const entity = SHEET_ENTITY[name]
    if (!entity || !Array.isArray(rows)) {
      out[name] = rows
      continue
    }
    const cols = customColumns((defs || []).filter((d) => d.entity === entity))
    out[name] = rows.map((row) => {
      if (!row || typeof row !== 'object') return row
      const { custom: _custom, ...rest } = row
      for (const c of cols) rest[c.header] = customCell(c, row)
      return rest
    })
  }
  return out
}

// xlsx (~400 kB) loads only when someone exports a workbook (MOBILE-008).
async function downloadWorkbook(sheets, filename) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    const data = Array.isArray(rows) ? rows : [rows]
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ note: 'No rows' }])
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

function ExportPageInner() {
  // Exports cover the header site only (FARM-003).
  const { locationArgs } = useLocation()
  const t = useT()
  const client = useConvex()
  const [exportType, setExportType] = useState('daily_records')
  const [format, setFormat] = useState('xlsx')
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split('T')[0],
    endDate: localToday(),
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleExport = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const bundle = await client.query(api.reports.exportBundle, {
        dateFrom: dateRange.startDate,
        dateTo: dateRange.endDate,
        ...locationArgs,
      })

      let sheets = {}
      let payload = bundle

      if (exportType === 'daily_records') {
        payload = bundle.daily_records || []
        sheets = { daily_records: payload }
      } else if (exportType === 'biweekly_records') {
        payload = bundle.biweekly_records || []
        sheets = { biweekly_records: payload }
      } else if (exportType === 'harvest_records') {
        payload = bundle.harvest_records || []
        sheets = { harvest_records: payload }
      } else if (exportType === 'cages') {
        payload = await client.query(api.cages.list, locationArgs)
        sheets = { cages: payload || [] }
      } else if (exportType === 'stocking_history') {
        payload = await client.query(api.stocking.listStockingHistory, locationArgs)
        sheets = { stocking_history: payload || [] }
      } else {
        sheets = {
          daily_records: bundle.daily_records || [],
          biweekly_records: bundle.biweekly_records || [],
          harvest_records: bundle.harvest_records || [],
          summary: [bundle.totals || bundle.summary || {}],
        }
        payload = bundle
      }

      const base = `${exportType}-${dateRange.startDate}-to-${dateRange.endDate}`

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${base}.json`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      } else {
        const defs = await client.query(api.customFields.allDefs, {})
        await downloadWorkbook(flattenCustom(sheets, defs), `${base}.xlsx`)
      }
    } catch (err) {
      setError(errorMessage(err, String(err)))
    } finally {
      setLoading(false)
    }
  }

  const datasets = ['daily_records', 'biweekly_records', 'harvest_records', 'stocking_history', 'cages', 'all']
  const formats = ['xlsx', 'csv', 'json']
  return (
    <Layout title={t('settingsUi.export.title')} eyebrow={t('settingsUi.export.eyebrow')}>
      <SettingsFrame active={null}>
        <SettingsCard title={t('settingsUi.export.card')} meta={t('settingsUi.export.meta')}>
          <form onSubmit={handleExport} className="flex flex-col">
            <SettingsRow label={t('settingsUi.export.dataset')} helper={t('settingsUi.export.datasetHelper')} htmlFor="exportType">
              <select
                id="exportType"
                value={exportType}
                onChange={(e) => setExportType(e.target.value)}
                required
                className={`${FIELD} w-auto min-w-[220px] py-[9px]`}
              >
                {datasets.map((d) => (
                  <option key={d} value={d}>
                    {t(`settingsUi.export.ds.${d}`)}
                  </option>
                ))}
              </select>
            </SettingsRow>
            <SettingsRow label={t('settingsUi.export.format')} helper={t('settingsUi.export.formatHelper')}>
              <Segmented
                label={t('settingsUi.export.format')}
                value={format}
                onChange={setFormat}
                options={formats.map((f) => ({ value: f, label: t(`settingsUi.export.fmt.${f}`) }))}
              />
            </SettingsRow>
            <SettingsRow label={t('settingsUi.export.range')} helper={t('settingsUi.export.rangeHelper')}>
              <label htmlFor="startDate" className="sr-only">
                {t('settingsUi.export.from')}
              </label>
              <input
                id="startDate"
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                required
                className={`${FIELD} w-auto py-[9px]`}
              />
              <span className="text-[13px] text-muted" aria-hidden>
                –
              </span>
              <label htmlFor="endDate" className="sr-only">
                {t('settingsUi.export.to')}
              </label>
              <input
                id="endDate"
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                required
                className={`${FIELD} w-auto py-[9px]`}
              />
            </SettingsRow>
            <SettingsRow label={t('settingsUi.export.download')} helper={t('settingsUi.export.downloadHelper')}>
              <GradientButton type="submit" size="sm" disabled={loading}>
                {loading ? t('settingsUi.export.exporting') : t(`settingsUi.export.downloadAs.${format}`)}
              </GradientButton>
            </SettingsRow>
            <InlineError className="mt-2">{error}</InlineError>
          </form>
        </SettingsCard>
      </SettingsFrame>
    </Layout>
  )
}

export default function ExportPage() {
  return (
    <ProtectedRoute>
      <ExportPageInner />
    </ProtectedRoute>
  )
}
