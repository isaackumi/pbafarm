import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'
import { useToast } from './Toast'
import { DetailList } from './settings'
import { GhostButton, GradientButton, KpiStrip, Pill, Skeleton, Table } from './ui'

const STATUS_TONE = { pending: 'amber', approved: 'green', rejected: 'red' }
const DAY = 24 * 60 * 60 * 1000

function fmtDate(ms, opts = { month: 'short', day: 'numeric' }) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleDateString(undefined, opts)
  } catch {
    return ''
  }
}

function fmtDateTime(ms) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function StatusPill({ status }) {
  const t = useT()
  return <Pill tone={STATUS_TONE[status] || 'neutral'}>{t(`settingsUi.admin.status.${STATUS_TONE[status] ? status : 'pending'}`)}</Pill>
}

/** Paper 59 Platform admin: KPI strip, registration queue and a detail panel. */
export default function AdminCompanyRegistrationsPage() {
  const t = useT()
  const { showToast } = useToast()
  const pending = useQuery(api.companies.listPending, {})
  const all = useQuery(api.companies.list, {})
  const approve = useMutation(api.companies.approve)
  const reject = useMutation(api.companies.reject)
  const [tab, setTab] = useState('pending')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(null)

  const counts = useMemo(() => {
    const c = { approved: 0, rejected: 0 }
    for (const co of all || []) if (co.status in c) c[co.status] += 1
    return c
  }, [all])

  const source = tab === 'pending' ? pending : (all || undefined)?.filter((c) => c.status === tab)
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = source || []
    if (!q) return list
    return list.filter((c) =>
      [c.name, c.code, c.contact_email, c.contact_phone, c.address].some((v) => v && v.toLowerCase().includes(q)),
    )
  }, [source, search])

  const selected = rows.find((c) => c.id === selectedId) || rows[0] || null
  const oldest = (pending || []).reduce((min, c) => Math.min(min, c.created_at), Infinity)
  const oldestDays = Number.isFinite(oldest) ? Math.max(0, Math.floor((Date.now() - oldest) / DAY)) : null

  const handleApprove = async (company) => {
    const userId = company.submitted_by_user_id
    if (!userId) {
      showToast('error', t('settingsUi.admin.noSubmitter'))
      return
    }
    setBusy(`approve-${company.id}`)
    try {
      await approve({ companyId: company.id, userId })
      showToast('success', t('settingsUi.admin.approved', { name: company.name }))
    } catch (err) {
      showToast('error', errorMessage(err, t('settingsUi.admin.approveFailed')))
    } finally {
      setBusy(null)
    }
  }

  const handleReject = async (company) => {
    const reason = window.prompt(t('settingsUi.admin.rejectPrompt', { name: company.name }))
    if (!reason) return
    setBusy(`reject-${company.id}`)
    try {
      await reject({ companyId: company.id, reason })
      showToast('success', t('settingsUi.admin.rejected'))
    } catch (err) {
      showToast('error', errorMessage(err, t('settingsUi.admin.rejectFailed')))
    } finally {
      setBusy(null)
    }
  }

  const decisionButtons = (company, size = 'sm') => (
    <>
      <GhostButton size={size} disabled={!!busy} onClick={() => handleReject(company)} aria-label={t('settingsUi.admin.rejectNamed', { name: company.name })}>
        {t('settingsUi.admin.reject')}
      </GhostButton>
      <GradientButton
        variant="solid"
        size="sm"
        disabled={!!busy}
        onClick={() => handleApprove(company)}
        aria-label={t('settingsUi.admin.approveNamed', { name: company.name })}
      >
        {t('settingsUi.admin.approve')}
      </GradientButton>
    </>
  )

  const columns = [
    {
      key: 'company',
      header: t('settingsUi.admin.col.company'),
      render: (c) => (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setSelectedId(c.id)}
            aria-pressed={selected?.id === c.id}
            className="truncate rounded text-left text-[14px] leading-[18px] text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          >
            {c.name}
          </button>
          <p className="mt-[2px] truncate text-[12px] leading-4 text-muted">{c.contact_email || c.contact_phone || c.code}</p>
        </div>
      ),
    },
    { key: 'code', header: t('settingsUi.admin.col.code'), render: (c) => <span className="font-data text-[13px] text-muted">{c.code}</span> },
    { key: 'sent', header: t('settingsUi.admin.col.sent'), render: (c) => fmtDate(c.created_at) },
    {
      key: 'actions',
      header: <span className="sr-only">{t('settingsUi.admin.col.actions')}</span>,
      align: 'right',
      render: (c) =>
        c.status === 'pending' ? <div className="flex justify-end gap-2">{decisionButtons(c)}</div> : <StatusPill status={c.status} />,
    },
  ]

  const loading = source === undefined

  return (
    <div className="flex flex-col gap-6">
      <KpiStrip
        items={[
          { key: 'tenants', label: t('settingsUi.admin.kpi.tenants'), value: all ? counts.approved : '—' },
          {
            key: 'pending',
            label: t('settingsUi.admin.kpi.pending'),
            value: pending ? pending.length : '—',
            valueTone: pending?.length ? 'warn' : undefined,
            suffix: oldestDays != null ? t('settingsUi.admin.kpi.oldest', { count: oldestDays }) : undefined,
          },
          { key: 'rejected', label: t('settingsUi.admin.kpi.rejected'), value: all ? counts.rejected : '—' },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {loading ? (
          <Skeleton className="h-72" />
        ) : (
          <Table
            title={t('settingsUi.admin.queue')}
            tabsLabel={t('settingsUi.admin.queue')}
            tabs={[
              { value: 'pending', label: t('settingsUi.admin.status.pending') },
              { value: 'approved', label: t('settingsUi.admin.status.approved') },
              { value: 'rejected', label: t('settingsUi.admin.status.rejected') },
            ]}
            tab={tab}
            onTabChange={(v) => {
              setTab(v)
              setSelectedId(null)
            }}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('settingsUi.admin.search')}
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            empty={tab === 'pending' ? t('settingsUi.admin.emptyPending') : t('settingsUi.admin.empty')}
          />
        )}

        {selected && (
          <section
            aria-labelledby="reg-detail-title"
            className="flex h-fit flex-col gap-[18px] rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] leading-4 text-muted">
                  <span className="font-data">{selected.code}</span> · {fmtDateTime(selected.created_at)}
                </p>
                <h2 id="reg-detail-title" className="mt-1 text-[20px] font-semibold leading-6 text-text">
                  {selected.name}
                </h2>
              </div>
              <StatusPill status={selected.status} />
            </div>
            <div className="rounded-input border border-line px-4 py-[6px] [&_dl>div]:py-[9px] [&_dl>div]:text-[13px] [&_dl>div]:leading-4">
              <DetailList
                items={[
                  { label: t('settingsUi.admin.detail.email'), value: selected.contact_email },
                  { label: t('settingsUi.admin.detail.phone'), value: selected.contact_phone },
                  { label: t('settingsUi.admin.detail.address'), value: selected.address },
                  { label: t('settingsUi.admin.detail.abbreviation'), value: selected.abbreviation },
                  { label: t('settingsUi.admin.detail.code'), value: selected.code, mono: true },
                  selected.approved_at && { label: t('settingsUi.admin.detail.approvedAt'), value: fmtDateTime(selected.approved_at) },
                  { label: t('settingsUi.admin.detail.reason'), value: selected.rejection_reason },
                ]}
              />
            </div>
            {selected.status === 'pending' && !selected.submitted_by_user_id && (
              <p className="text-[13px] leading-4 text-warn">{t('settingsUi.admin.noSubmitter')}</p>
            )}
            {selected.status === 'pending' && (
              <div className="flex flex-wrap gap-[10px]">
                <GradientButton
                  variant="solid"
                  className="flex-1"
                  disabled={!!busy || !selected.submitted_by_user_id}
                  onClick={() => handleApprove(selected)}
                >
                  {t('settingsUi.admin.approve')}
                </GradientButton>
                <GhostButton size="lg" disabled={!!busy} onClick={() => handleReject(selected)}>
                  {t('settingsUi.admin.reject')}
                </GhostButton>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
