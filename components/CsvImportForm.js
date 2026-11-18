import { useState } from 'react'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'
import {
  buildBiweeklyRecords,
  buildDailyRecords,
  parseCsv,
  toServerRecords,
} from '../lib/csvImport'
import { errorMessage } from '../lib/errorMessage'
import { localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { Button, FormActions, FormSection, Field } from './ui'

const KINDS = {
  daily: {
    columns: 'cage_name, date, feed_amount, feed_type, feed_price, mortality, notes',
    mutation: () => api.dailyRecords.createMany,
    async lookups() {
      const [cages, feedTypes] = await Promise.all([
        cageService.getAllCages(),
        feedTypeService.getAllFeedTypes(),
      ])
      if (cages.error) throw cages.error
      if (feedTypes.error) throw feedTypes.error
      return { cages: cages.data, feedTypes: feedTypes.data }
    },
    build: buildDailyRecords,
  },
  biweekly: {
    columns: 'cage_name, date, batch_code, average_body_weight, total_fish_count, total_weight',
    mutation: () => api.biweeklyRecords.createMany,
    async lookups() {
      const cages = await cageService.getAllCages()
      if (cages.error) throw cages.error
      return { cages: cages.data }
    },
    build: buildBiweeklyRecords,
  },
}

/**
 * Bulk CSV upload (MOBILE-009). The file is parsed in the browser with a real
 * CSV parser and checked with the same rules as interactive entry; every row
 * that is not sent is listed with its line number and reason.
 */
export default function CsvImportForm({ kind, onSuccess, onCancel }) {
  const t = useT()
  const config = KINDS[kind]
  const inputId = `${kind}-csv`
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!file) {
      setError(t('csvImport.chooseFile'))
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      let parsed
      try {
        parsed = parseCsv(await file.text())
      } catch (err) {
        if (err.code === 'UNCLOSED_QUOTE') throw new Error(t('csvImport.unclosedQuote', { line: err.line }))
        if (err.code === 'EMPTY') throw new Error(t('csvImport.empty'))
        throw err
      }
      const lookups = await config.lookups()
      const { records, skipped } = config.build(parsed.rows, { ...lookups, today: localToday() })
      let inserted = 0
      if (records.length) {
        const ids = await getConvexHttpClient().mutation(config.mutation(), {
          records: toServerRecords(records),
        })
        inserted = Array.isArray(ids) ? ids.length : 0
      }
      setResult({
        rows: parsed.rows.length,
        inserted,
        existing: records.length - inserted,
        skipped,
      })
      if (inserted > 0) onSuccess?.()
    } catch (err) {
      setError(errorMessage(err, t('csvImport.failed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <FormSection
        title={t(`csvImport.title.${kind}`)}
        description={t('csvImport.header', { columns: config.columns })}
      >
        {error && (
          <div
            role="alert"
            className="mb-4 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3"
          >
            {error}
          </div>
        )}
        {result && <CsvImportReport result={result} />}
        <form onSubmit={handleSubmit} className="space-y-5">
          <Field
            label={t('csvImport.file')}
            htmlFor={inputId}
            hint={t('csvImport.fileHint')}
            required
          >
            <input
              id={inputId}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-chart-ink file:mr-4 file:rounded-xl file:border-0 file:bg-foam file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-chart-ink hover:file:bg-zinc-200/80"
            />
          </Field>
          <FormActions className="mt-4 pt-4">
            <Button type="submit" disabled={loading} size="lg">
              {loading ? t('csvImport.uploading') : t('csvImport.upload')}
            </Button>
            {onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel}>
                {t('common.cancel')}
              </Button>
            )}
          </FormActions>
        </form>
      </FormSection>
    </div>
  )
}

export function CsvImportReport({ result }) {
  const t = useT()
  const { rows, inserted, existing, skipped } = result
  const tone =
    inserted > 0 && skipped.length === 0
      ? 'text-kelp border-kelp/20 bg-kelp/10'
      : 'text-chart-ink border-amber-500/40 bg-amber-500/10'
  return (
    <div role="status" className={`mb-4 text-sm border rounded-xl p-3 space-y-2 ${tone}`}>
      <p className="font-semibold">{t('csvImport.summary', { inserted, rows })}</p>
      {existing > 0 && <p>{t('csvImport.existing', { count: existing })}</p>}
      {skipped.length > 0 && (
        <div>
          <p className="font-semibold">{t('csvImport.skippedTitle', { count: skipped.length })}</p>
          <ul className="mt-1 max-h-60 overflow-auto list-disc pl-5 space-y-0.5">
            {skipped.map((s, i) => (
              <li key={`${s.line}-${i}`}>
                {t('csvImport.lineReason', {
                  line: s.line,
                  reason: t(s.reason.key, s.reason.params),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
