import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Download } from 'lucide-react'
import { ErrorState, Field, GradientButton, Input, KpiStrip, Select, Skeleton } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { ListRow, Panel } from '../components/ui/Panel'
import { financeTabs } from '../lib/sectionTabs'
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

  const truncatedSources = (data?.truncated || [])
    .map((s) => t(SOURCE_KEYS[s === 'sales' ? 'sale' : s === 'payments' ? 'payment' : s === 'purchases' ? 'purchase' : 'expense']))
    .join(', ')

  return (
    <Layout
      title={t('integ.acct.title')}
      eyebrow={t('ops.acct.eyebrow')}
      actions={
        <GradientButton icon={Download} onClick={download} disabled={!data || !entries.length}>
          {t('integ.acct.download')}
        </GradientButton>
      }
    >
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={financeTabs(t)} label={t('ops.tabs.finance')} />
        <p className="max-w-[720px] text-sm leading-5 text-muted">{t('integ.acct.description')}</p>

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
        {!valid && (
          <p role="alert" className="-mt-4 text-sm text-alert">
            {t('integ.acct.badRange')}
          </p>
        )}

        {error ? (
          <ErrorState title={t('integ.acct.errorTitle')} message={errorMessage(error)} />
        ) : valid && data === undefined ? (
          <Skeleton className="h-40" />
        ) : data ? (
          <>
            <KpiStrip
              items={Object.entries(SOURCE_KEYS).map(([k, key]) => ({
                label: t(key),
                value: money(totals.bySource[k] || 0, data.currency),
              }))}
            />
            <Panel title={t('integ.acct.summaryTitle', { count: totals.count })} titleId="acct-summary">
              <ListRow dot="cyan" title={t('ops.acct.debit')} value={money(totals.debit, data.currency)} />
              <ListRow dot="pink" title={t('ops.acct.credit')} value={money(totals.credit, data.currency)} />
              <p className="border-t border-line py-[11px] text-sm text-muted">
                {t('integ.acct.balanced', {
                  debit: money(totals.debit, data.currency),
                  credit: money(totals.credit, data.currency),
                })}
              </p>
              {data.truncated.length > 0 && (
                <p role="alert" className="border-t border-line py-[11px] text-sm text-alert">
                  {t('integ.acct.truncated', { sources: truncatedSources })}
                </p>
              )}
              <p className="border-t border-line pt-[11px] text-xs leading-4 text-muted">{t('integ.acct.accountsHint')}</p>
            </Panel>
          </>
        ) : null}
      </div>
    </Layout>
  )
}

export default function AccountingExport() {
  return (
    <ProtectedRoute permission="reports.export">
      <AccountingExportPage />
    </ProtectedRoute>
  )
}
