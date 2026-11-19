import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, ErrorState, Field, FormPage, Input, PageHeader, Select, Skeleton, StatCard } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { downloadCsv } from '../lib/csv'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'
import { buildExport, EXPORT_FORMATS, journalEntries, journalTotals } from '../convex/lib/accountingExport'

/**
 * Accounting export (INT-008): sales, payments received, feed purchases and
 * expenses for a date range (and optionally one site) as balanced journal
 * lines, in a generic layout or ready for QuickBooks Online / Xero import.
 * The account codes are a default chart (see docs/architecture/09 §9);
 * accountants map them on import.
 */

const FORMAT_KEYS = { journal: 'integ.acct.formatJournal', quickbooks: 'integ.acct.formatQuickbooks', xero: 'integ.acct.formatXero' }
const SOURCE_KEYS = { sale: 'integ.acct.sales', payment: 'integ.acct.payments', purchase: 'integ.acct.purchases', expense: 'integ.acct.expenses' }

function isoDay(d) {
  return d.toISOString().slice(0, 10)
}

function monthStart() {
  const d = new Date()
  return isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)))
}

function money(n, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

/** useQuery throws on server errors; keep the page up and show the message. */
function useEntries(args) {
  try {
    return { data: useQuery(api.accountingExport.entries, args), error: null }
  } catch (err) {
    return { data: undefined, error: err }
  }
}

function AccountingExportPage() {
  const t = useT()
  const { locations = [] } = useLocation() || {}
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(() => isoDay(new Date()))
  const [locationId, setLocationId] = useState('')
  const [format, setFormat] = useState('journal')
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to
  const { data, error } = useEntries(valid ? { from, to, ...(locationId ? { locationId } : {}) } : 'skip')

  const entries = useMemo(() => (data ? journalEntries(data.rows) : []), [data])
  const totals = useMemo(() => journalTotals(entries), [entries])

  const download = () => {
    const table = buildExport(entries, { format, currency: data.currency })
    downloadCsv(`accounting-${format}-${from}-to-${to}.csv`, table.header, table.rows)
  }

  return (
    <FormPage>
      <PageHeader title={t('integ.acct.title')} description={t('integ.acct.description')} />
      <div className="space-y-6">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('integ.acct.from')} htmlFor="acct-from">
              <Input id="acct-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('integ.acct.to')} htmlFor="acct-to">
              <Input id="acct-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label={t('integ.acct.site')} htmlFor="acct-site">
              <Select id="acct-site" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">{t('integ.acct.allSites')}</option>
                {locations.map((l) => (
                  <option key={l._id || l.id} value={l._id || l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('integ.acct.format')} htmlFor="acct-format">
              <Select id="acct-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {t(FORMAT_KEYS[f.id])}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {!valid && <p className="mt-3 text-sm text-signal">{t('integ.acct.badRange')}</p>}
        </Card>

        {error ? (
          <ErrorState title={t('integ.acct.errorTitle')} message={errorMessage(error)} />
        ) : valid && data === undefined ? (
          <Skeleton className="h-40" />
        ) : data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(SOURCE_KEYS).map(([k, key]) => (
                <StatCard key={k} label={t(key)} value={money(totals.bySource[k] || 0, data.currency)} />
              ))}
            </div>
            <Card>
              <CardHeader
                title={t('integ.acct.summaryTitle', { count: totals.count })}
                subtitle={t('integ.acct.balanced', {
                  debit: money(totals.debit, data.currency),
                  credit: money(totals.credit, data.currency),
                })}
              />
              {data.truncated.length > 0 && (
                <p className="mb-3 text-sm text-signal">
                  {t('integ.acct.truncated', { sources: data.truncated.map((s) => t(SOURCE_KEYS[s === 'sales' ? 'sale' : s === 'payments' ? 'payment' : s === 'purchases' ? 'purchase' : 'expense'])).join(', ') })}
                </p>
              )}
              <Button onClick={download} disabled={!entries.length}>
                {t('integ.acct.download')}
              </Button>
              <p className="mt-3 text-xs text-muted">{t('integ.acct.accountsHint')}</p>
            </Card>
          </>
        ) : null}
      </div>
    </FormPage>
  )
}

export default function AccountingExport() {
  return (
    <ProtectedRoute permission="reports.export">
      <Layout>
        <AccountingExportPage />
      </Layout>
    </ProtectedRoute>
  )
}
