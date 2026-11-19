import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ArrowRight } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GhostButton, GradientButton, Pill, Tabs, Textarea } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { formatDate, formatNumber } from '../lib/format'
import { APPROVAL_TABS, inboxView, requestAge, rowKey, tabCounts } from '../lib/approvalsView'
import { useLocale, useT } from '../lib/i18n/context'

const TYPE_TONE = { stocking: 'cyan', fish_transfer: 'pink', topup: 'neutral' }
const typeLabel = (t, type) => t.or(`approvalsPage.type.${type}`, type)

function useNow(ms = 60000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

function ageText(t, createdAt, now) {
  const age = requestAge(createdAt, now)
  return t.or(`approvalsPage.age.${age.unit}`, `${age.n}${age.unit}`, { n: age.n })
}

function summary(t, r, locale) {
  const n = formatNumber(r.count, { locale })
  if (r.type === 'fish_transfer') return t('approvalsPage.summary.transfer', { route: r.batchNumber, n })
  if (r.type === 'topup') return t('approvalsPage.summary.topup', { cage: r.cageName, n })
  return t('approvalsPage.summary.stocking', { cage: r.cageName, n })
}

function InboxItem({ row, selected, onSelect, now }) {
  const t = useT()
  const { locale } = useLocale()
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(rowKey(row))}
        aria-current={selected ? 'true' : undefined}
        className={`flex w-full flex-col gap-[6px] rounded-[16px] border px-[18px] py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
          selected ? 'border-line-strong bg-surface-2' : 'border-line bg-surface hover:bg-surface-2'
        }`}
      >
        <span className="flex w-full items-center justify-between gap-3">
          <Pill tone={TYPE_TONE[row.type]}>{typeLabel(t, row.type)}</Pill>
          <span className="text-xs leading-4 text-faint tabular-nums">
            {ageText(t, row.createdAt, now)}
          </span>
        </span>
        <span className="text-[14px] font-medium leading-[18px] text-text">{summary(t, row, locale)}</span>
        <span className="text-xs leading-4 text-muted">
          {row.type === 'fish_transfer' ? formatDate(row.date, { locale }) : `${row.batchNumber} · ${formatDate(row.date, { locale })}`}
        </span>
      </button>
    </li>
  )
}

function StatBox({ label, value, sub, subTone = 'text-muted' }) {
  return (
    <div className="flex min-w-0 grow basis-0 flex-col gap-2 rounded-[16px] border border-line bg-bg p-[18px]">
      <div className="text-xs leading-4 text-muted">{label}</div>
      <div className="text-[20px] font-semibold leading-6 text-text tabular-nums">{value}</div>
      {sub && <div className={`text-[13px] leading-4 ${subTone}`}>{sub}</div>}
    </div>
  )
}

function Detail({ row, now, onDone }) {
  const t = useT()
  const { locale } = useLocale()
  const { showToast } = useToast()
  const approveStocking = useMutation(api.stocking.approveStocking)
  const approveTopup = useMutation(api.stocking.approveTopup)
  const approveFishTransfer = useMutation(api.fishTransfers.approveFishTransfer)
  const rejectStocking = useMutation(api.stocking.rejectStocking)
  const rejectTopup = useMutation(api.stocking.rejectTopup)
  const rejectFishTransfer = useMutation(api.fishTransfers.rejectFishTransfer)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const label = typeLabel(t, row.type)

  const approve = async () => {
    setBusy('approve')
    setError('')
    try {
      if (row.type === 'topup') await approveTopup({ id: row.id })
      else if (row.type === 'fish_transfer') await approveFishTransfer({ id: row.id })
      else await approveStocking({ id: row.id })
      showToast('success', t('approvalsPage.toast.approved', { type: label }))
      onDone()
    } catch (err) {
      const message = errorMessage(err, t('approvalsPage.toast.approveFailed'))
      setError(message)
      showToast('error', message)
    } finally {
      setBusy(null)
    }
  }

  const reject = async () => {
    const reason = note.trim()
    if (!reason) return setError(t('approvalsPage.reasonRequired'))
    setBusy('reject')
    setError('')
    try {
      if (row.type === 'topup') await rejectTopup({ id: row.id, reason })
      else if (row.type === 'fish_transfer') await rejectFishTransfer({ id: row.id, reason })
      else await rejectStocking({ id: row.id, reason })
      showToast('success', t('approvalsPage.toast.rejected', { type: label }))
      onDone()
    } catch (err) {
      const message = errorMessage(err, t('approvalsPage.toast.rejectFailed'))
      setError(message)
      showToast('error', message)
    } finally {
      setBusy(null)
    }
  }

  const [from, to] = row.type === 'fish_transfer' ? row.batchNumber.split(' → ') : [null, row.cageName]
  const detailsHref = row.type === 'fish_transfer' ? '/fish-transfers' : `/${row.type}/${row.id}/details`
  const count = formatNumber(row.count, { locale })

  return (
    <section
      aria-labelledby="approval-title"
      className="flex min-w-0 grow basis-0 flex-col gap-[18px] rounded-card border border-line bg-surface p-[22px] shadow-[var(--shadow-card)] sm:p-[28px]"
    >
      <div className="flex flex-col gap-[6px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <Pill tone={TYPE_TONE[row.type]}>{t('approvalsPage.request', { type: label })}</Pill>
          <span className="text-xs leading-4 text-muted">
            {t('approvalsPage.requestedAgo', { age: ageText(t, row.createdAt, now) })}
          </span>
        </div>
        <h2 id="approval-title" className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text">
          {summary(t, row, locale)}
        </h2>
      </div>

      {row.type === 'fish_transfer' ? (
        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
          <StatBox label={t('approvalsPage.from', { cage: from })} value={`−${count}`} sub={t('approvalsPage.fish')} />
          <ArrowRight size={20} aria-hidden className="hidden shrink-0 text-faint sm:block" />
          <StatBox label={t('approvalsPage.to', { cage: to })} value={`+${count}`} sub={t('approvalsPage.fish')} subTone="text-pearl-cyan" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          <StatBox label={t('approvalsPage.unit')} value={row.cageName} sub={row.batchNumber} />
          <StatBox label={t('approvalsPage.quantity')} value={count} sub={t('approvalsPage.fish')} subTone="text-pearl-cyan" />
        </div>
      )}

      <dl className="flex flex-col">
        {[
          [t('approvalsPage.date'), formatDate(row.date, { locale })],
          [t('approvalsPage.abw'), `${formatNumber(row.abw, { locale, decimals: 1 })} g`],
          [t('approvalsPage.biomass'), `${formatNumber(row.biomass || 0, { locale, decimals: 1 })} kg`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-t border-line py-3">
            <dt className="text-[14px] leading-[18px] text-muted">{k}</dt>
            <dd className="text-[14px] leading-[18px] text-text tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2">
        <label htmlFor="approval-note" className="text-[13px] leading-4 text-muted">
          {t('approvalsPage.noteLabel')}
        </label>
        <Textarea
          id="approval-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('approvalsPage.notePlaceholder')}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-input border border-[var(--pill-red-border)] px-4 py-3 text-[13px] leading-[18px] text-alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-4 text-faint">{t('approvalsPage.auditHint')}</p>
        <div className="flex flex-wrap gap-[10px]">
          <GhostButton href={detailsHref}>{t('approvalsPage.details')}</GhostButton>
          <GhostButton onClick={reject} disabled={Boolean(busy)}>
            {busy === 'reject' ? t('approvalsPage.processing') : t('approvalsPage.reject')}
          </GhostButton>
          <GradientButton variant="solid" size="sm" onClick={approve} disabled={Boolean(busy)}>
            {busy === 'approve' ? t('approvalsPage.processing') : t('approvalsPage.approve', { type: label.toLowerCase() })}
          </GradientButton>
        </div>
      </div>
    </section>
  )
}

function PendingApprovals() {
  const t = useT()
  const { user } = useAuth()
  const approvals = useQuery(api.stocking.listPendingApprovals, user ? {} : 'skip')
  const [tab, setTab] = useState('all')
  const [selectedKey, setSelectedKey] = useState(null)
  const now = useNow()
  const rows = approvals?.all ?? []
  const counts = tabCounts(rows)
  const { list, selected } = inboxView(rows, tab, selectedKey)

  return (
    <Layout
      title={t('approvalsPage.title')}
      eyebrow={approvals === undefined ? t('approvalsPage.eyebrowLoading') : t('approvalsPage.eyebrow', { count: counts.all })}
    >
      <div className="flex flex-col gap-[28px]">
      <div className="-mt-1 border-b border-line">
        <Tabs
          variant="underline"
          label={t('approvalsPage.filter')}
          value={tab}
          onChange={setTab}
          className="gap-[28px] overflow-x-auto [&>[role=tab]]:pt-0 [&>[role=tab]]:pb-3 [&>[aria-selected=true]]:border-button"
          tabs={APPROVAL_TABS.map((k) => ({ value: k, label: `${t.or(`approvalsPage.tab.${k}`, k)} ${counts[k]}` }))}
        />
      </div>
      {approvals === undefined ? (
        <p className="text-[14px] leading-[18px] text-muted">{t('approvalsPage.loading')}</p>
      ) : list.length === 0 ? (
        <div className="rounded-card border border-line bg-surface px-[26px] py-10 text-center shadow-[var(--shadow-card)]">
          <p className="text-[15px] font-semibold leading-[18px] text-text">{t('approvalsPage.emptyTitle')}</p>
          <p className="mt-2 text-[13px] leading-[18px] text-muted">{t('approvalsPage.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex w-full flex-col items-start gap-5 lg:flex-row">
          <ul className="flex w-full flex-col gap-2 lg:w-[420px] lg:shrink-0" aria-label={t('approvalsPage.listLabel')}>
            {list.map((r) => (
              <InboxItem key={rowKey(r)} row={r} selected={selected && rowKey(r) === rowKey(selected)} onSelect={setSelectedKey} now={now} />
            ))}
          </ul>
          {selected && <Detail key={rowKey(selected)} row={selected} now={now} onDone={() => setSelectedKey(null)} />}
        </div>
      )}
      </div>
    </Layout>
  )
}

export default function ApprovalsPage() {
  return (
    <ProtectedRoute permission="production.stocking.approve">
      <PendingApprovals />
    </ProtectedRoute>
  )
}
