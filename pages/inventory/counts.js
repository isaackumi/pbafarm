import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Button, Pill, Table, FormCard, FormSection, FormActions, Field, Input, Select, Textarea } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useLocation } from '../../contexts/LocationContext'
import { useToast } from '../../components/Toast'
import { usePermission } from '../../hooks/usePermission'
import { useT } from '../../lib/i18n/context'
import { formatDate, localToday } from '../../lib/format'
import NavTabs from '../../components/ui/NavTabs'
import { inventoryTabs } from '../../lib/sectionTabs'
import { errorMessage } from '../../lib/errorMessage'

export default function StockCountsPage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout title={t('ops.inventory.title')} eyebrow={t('ops.counts.eyebrow')}>
        <StockCounts />
      </Layout>
    </ProtectedRoute>
  )
}

const COUNT_TONE = { draft: 'amber', posted: 'green', cancelled: 'neutral' }

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 }))

function StockCounts() {
  const t = useT()
  const { showToast } = useToast()
  const { activeLocationId, activeLocation } = useLocation()
  const canCount = usePermission('inventory.issue')
  const canPost = usePermission('inventory.adjust')
  const counts = useQuery(api.stockCounts.listCounts, activeLocationId ? { locationId: activeLocationId } : 'skip')
  const startCount = useMutation(api.stockCounts.startCount)
  const [form, setForm] = useState({ countDate: localToday(), include: 'all', notes: '' })
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(false)

  const start = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const id = await startCount({
        locationId: activeLocationId,
        countDate: form.countDate,
        include: form.include,
        notes: form.notes.trim() || undefined,
      })
      showToast('success', t('stockCount.started'))
      setSelectedId(id)
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const hasDraft = (counts || []).some((c) => c.status === 'draft')

  return (
    <div className="flex flex-col gap-[28px]">
      <NavTabs tabs={inventoryTabs(t)} label={t('ops.tabs.inventory')} />
      <p className="max-w-2xl text-sm text-muted">{t('stockCount.description', { site: activeLocation?.name || '—' })}</p>

      {canCount && !hasDraft && activeLocationId && (
        <FormCard>
          <form onSubmit={start}>
            <FormSection title={t('stockCount.newCount')}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label={t('stockCount.countDate')} htmlFor="count-date" required>
                  <Input
                    id="count-date"
                    type="date"
                    value={form.countDate}
                    onChange={(e) => setForm((p) => ({ ...p, countDate: e.target.value }))}
                    required
                  />
                </Field>
                <Field label={t('stockCount.include')} htmlFor="count-include">
                  <Select
                    id="count-include"
                    value={form.include}
                    onChange={(e) => setForm((p) => ({ ...p, include: e.target.value }))}
                  >
                    <option value="all">{t('stockCount.includeAll')}</option>
                    <option value="feed">{t('stockCount.includeFeed')}</option>
                    <option value="items">{t('stockCount.includeItems')}</option>
                  </Select>
                </Field>
                <Field label={t('common.notes')} htmlFor="count-notes">
                  <Input
                    id="count-notes"
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  />
                </Field>
              </div>
              <p className="mt-3 text-sm text-muted">{t('stockCount.snapshotHint')}</p>
            </FormSection>
            <FormActions>
              <Button type="submit" disabled={busy}>
                {t('stockCount.start')}
              </Button>
            </FormActions>
          </form>
        </FormCard>
      )}

      {selectedId && (
        <CountSheet
          key={selectedId}
          id={selectedId}
          canCount={canCount}
          canPost={canPost}
          onClose={() => setSelectedId(null)}
        />
      )}

      <Table
        title={t('stockCount.history')}
        columns={[
          { key: 'date', header: t('stockCount.countDate'), render: (c) => formatDate(c.count_date) },
          {
            key: 'status',
            header: t('stockCount.status'),
            width: 140,
            render: (c) => <Pill tone={COUNT_TONE[c.status] || 'neutral'}>{t(`stockCount.statuses.${c.status}`)}</Pill>,
          },
          { key: 'counted', header: t('stockCount.counted'), width: 120, align: 'right', render: (c) => `${c.counted_count}/${c.line_count}` },
          {
            key: 'diff',
            header: t('stockCount.differences'),
            width: 120,
            align: 'right',
            render: (c) => <span className={c.difference_count ? 'text-warn' : ''}>{c.difference_count}</span>,
          },
          {
            key: 'open',
            header: <span className="sr-only">{t('stockCount.open')}</span>,
            width: 90,
            align: 'right',
            render: (c) => (
              <button
                type="button"
                className="rounded-sm text-sm text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                onClick={() => setSelectedId(c.id)}
              >
                {t('stockCount.open')}
              </button>
            ),
          },
        ]}
        rows={counts || []}
        empty={counts === undefined ? t('common.loading') : t('stockCount.none')}
      />
    </div>
  )
}

function CountSheet({ id, canCount, canPost, onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const count = useQuery(api.stockCounts.getCount, { id })
  const updateLines = useMutation(api.stockCounts.updateCountLines)
  const postCount = useMutation(api.stockCounts.postCount)
  const cancelCount = useMutation(api.stockCounts.cancelCount)
  const [entries, setEntries] = useState({})
  const [busy, setBusy] = useState(false)

  if (count === undefined) return <p className="mb-6 text-sm text-muted">{t('common.loading')}</p>
  if (count === null) return null

  const editable = count.status === 'draft' && canCount
  const valueFor = (line) => (line.index in entries ? entries[line.index] : line.counted == null ? '' : String(line.counted))

  const save = async () => {
    const lines = Object.entries(entries).map(([index, value]) => ({
      index: Number(index),
      counted: value === '' ? null : Number(value),
    }))
    if (!lines.length) return true
    await updateLines({ id, lines })
    setEntries({})
    return true
  }

  const run = async (fn, ok) => {
    setBusy(true)
    try {
      await fn()
      showToast('success', ok)
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormCard className="mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-lg font-medium text-chart-ink">
            {t('stockCount.sheetTitle', { date: count.count_date, site: count.site_name || '—' })}
          </h3>
          <p className="text-sm text-muted">{t(`stockCount.statuses.${count.status}`)}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-foam-deep text-sm">
          <thead className="bg-foam-deep/40">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted">{t('stockCount.item')}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted">{t('stockCount.unit')}</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted">{t('stockCount.expected')}</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted">{t('stockCount.counted')}</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted">{t('stockCount.difference')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foam-deep">
            {count.lines.map((line) => {
              const raw = valueFor(line)
              const diff = raw === '' ? null : Number(raw) - line.expected
              return (
                <tr key={line.index}>
                  <td className="px-4 py-2">
                    {line.name}
                    <span className="ml-2 text-xs text-muted">{t(`stockCount.kind.${line.kind}`)}</span>
                  </td>
                  <td className="px-4 py-2 text-muted">{line.unit}</td>
                  <td className="px-4 py-2 text-right font-data">{fmt(line.expected)}</td>
                  <td className="px-4 py-2 text-right">
                    {editable ? (
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        aria-label={t('stockCount.countedFor', { name: line.name })}
                        className="font-data text-right w-28 ml-auto"
                        value={raw}
                        onChange={(e) => setEntries((p) => ({ ...p, [line.index]: e.target.value }))}
                      />
                    ) : (
                      <span className="font-data">{fmt(line.counted)}</span>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-data ${diff != null && Math.abs(diff) > 1e-6 ? 'text-signal font-semibold' : ''}`}
                  >
                    {diff == null ? '—' : fmt(Math.round(diff * 1000) / 1000)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {count.notes && <Textarea className="mt-4" readOnly rows={2} value={count.notes} />}
      {count.status === 'draft' && (
        <FormActions>
          {canPost && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('stockCount.cancelConfirm'))) {
                  run(() => cancelCount({ id }), t('stockCount.cancelled'))
                }
              }}
            >
              {t('stockCount.cancelCount')}
            </Button>
          )}
          {canCount && (
            <Button variant="secondary" disabled={busy} onClick={() => run(save, t('stockCount.saved'))}>
              {t('stockCount.saveCounts')}
            </Button>
          )}
          {canPost && (
            <Button
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('stockCount.postConfirm'))) {
                  run(async () => {
                    await save()
                    await postCount({ id })
                  }, t('stockCount.posted'))
                }
              }}
            >
              {t('stockCount.post')}
            </Button>
          )}
        </FormActions>
      )}
      {count.status === 'draft' && !canPost && <p className="mt-3 text-sm text-muted">{t('stockCount.needAdmin')}</p>}
    </FormCard>
  )
}
