import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ClipboardCheck, Plus } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  EmptyState,
  Field,
  GhostButton,
  GradientButton,
  IfPermitted,
  Input,
  KpiStrip,
  Modal,
  Pill,
  Select,
  Table,
  Textarea,
} from '../components/ui'
import Attachments from '../components/Attachments'
import { TonePill } from '../components/paperTones'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useToast } from '../components/Toast'
import { errorMessage } from '../lib/errorMessage'
import { addDays, formatDate, localToday } from '../lib/format'
import { usePermission } from '../hooks/usePermission'
import { useLocale, useT } from '../lib/i18n/context'

const KINDS = ['visitor', 'vehicle', 'disinfection', 'other']

/** Share (0 to 100) of a withdrawal period already served on `today` (YYYY-MM-DD). */
function holdProgress(h, today) {
  const start = Date.parse(h.date)
  const end = Date.parse(h.withdrawal_until)
  const now = Date.parse(today)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)))
}
const CARD = 'rounded-card border border-line bg-surface px-[22px] py-6 shadow-[var(--shadow-card)] sm:px-[26px]'
const ROW = 'border-t border-line py-3'

export default function CompliancePage() {
  return (
    <ProtectedRoute>
      <Compliance />
    </ProtectedRoute>
  )
}

function Card({ title, meta, action, children }) {
  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-3 pb-3">
        <h2 className="shrink-0 text-[15px] font-semibold leading-[18px] text-text">{title}</h2>
        <div className="flex min-w-0 items-center gap-3">
          {meta != null && <span className="text-right text-[13px] leading-4 text-muted">{meta}</span>}
          {action}
        </div>
      </div>
      {children}
    </section>
  )
}

/** The log merges checklist records and biosecurity entries, newest first. */
function logRows(records, bio, t) {
  const out = []
  for (const r of records || []) {
    out.push({
      key: `r-${r.id}`,
      type: 'checklist',
      date: r.completed_on,
      check: r.template_name,
      sub: r.period,
      by: r.completed_by,
      ok: r.passed,
      result: r.passed ? t('compliancePage.passed') : t('compliancePage.issuesN', { count: r.answers.filter((a) => !a.ok).length }),
      frequency: r.frequency,
      record: r,
    })
  }
  for (const b of bio || []) {
    const ok = b.entry_controls_done !== false
    out.push({
      key: `b-${b.id}`,
      type: 'biosecurity',
      date: b.date,
      check: t(`compliancePage.kind.${b.kind}`),
      sub: [b.person, b.organisation, b.vehicle, b.area, b.disinfectant, b.purpose].filter(Boolean).join(' · '),
      by: b.person || '—',
      ok,
      result: ok ? t('compliancePage.logged') : t('compliancePage.controlsMissed'),
      entry: b,
    })
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

function Compliance() {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const { activeLocation, activeLocationId } = useLocation()
  const today = localToday()
  const since = addDays(today, -30)
  const ready = user && activeLocationId
  const due = useQuery(api.compliance.due, ready ? { locationId: activeLocationId, today } : 'skip')
  const templates = useQuery(api.compliance.listTemplates, user ? {} : 'skip')
  const records = useQuery(api.compliance.listRecords, ready ? { locationId: activeLocationId } : 'skip')
  const bio = useQuery(api.compliance.listBiosecurity, ready ? { locationId: activeLocationId } : 'skip')
  const holds = useQuery(api.health.activeWithdrawals, ready ? { locationId: activeLocationId, asOf: today } : 'skip')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [completing, setCompleting] = useState(null)
  const [picking, setPicking] = useState(false)
  const [logging, setLogging] = useState(false)
  const [detail, setDetail] = useState(null)
  const d = (iso) => formatDate(iso, { locale })

  const rows = useMemo(() => logRows(records, bio, t), [records, bio, t])
  const recent = rows.filter((r) => r.date >= since)
  const findings = (records || []).filter((r) => !r.passed && r.completed_on >= since)
  const openDue = (due || []).filter((x) => !x.done)
  const doneDue = (due || []).length - openDue.length
  const holdCages = [...new Set((holds || []).map((h) => h.cage_name).filter(Boolean))]

  const q = search.trim().toLowerCase()
  const shown = rows.filter(
    (r) =>
      (tab === 'all' || (tab === 'issues' ? !r.ok : r.type === tab)) &&
      (!q || [r.check, r.sub, r.by].some((v) => v && String(v).toLowerCase().includes(q))),
  )

  const startChecklist = () => {
    if (openDue.length === 1) setCompleting(openDue[0].template)
    else setPicking(true)
  }

  return (
    <Layout
      title={t('compliancePage.title')}
      eyebrow={t('compliancePage.eyebrow', { site: activeLocation?.name || t('compliancePage.thisSite') })}
      actions={
        activeLocationId ? (
          <IfPermitted permission="production.health.record">
            {openDue.length > 0 && (
              <GradientButton variant="lime" icon={ClipboardCheck} onClick={startChecklist}>
                {t('compliancePage.startChecklist')}
              </GradientButton>
            )}
            <GradientButton ring="sky" icon={Plus} onClick={() => setLogging(true)}>
              {t('compliancePage.logEntry')}
            </GradientButton>
          </IfPermitted>
        ) : null
      }
    >
      {!activeLocationId ? (
        <EmptyState title={t('compliancePage.noSite')} description={t('compliancePage.noSiteHint')} />
      ) : (
        <div className="flex flex-col gap-[28px]">
          <KpiStrip
            items={[
              {
                key: 'checklists',
                label: t('compliancePage.kpi.checklists'),
                value: due && due.length ? `${Math.round((doneDue / due.length) * 100)}%` : '—',
                suffix: due ? t('compliancePage.kpi.doneOf', { done: doneDue, total: due.length }) : undefined,
              },
              {
                key: 'findings',
                label: t('compliancePage.kpi.findings'),
                value: records ? String(findings.length) : '—',
                suffix: t('compliancePage.kpi.last30'),
              },
              {
                key: 'holds',
                label: t('compliancePage.kpi.holds'),
                value: holds ? t('compliancePage.kpi.cagesN', { count: holdCages.length }) : '—',
                suffix: holdCages.slice(0, 3).join(', ') || undefined,
              },
              {
                key: 'bio',
                label: t('compliancePage.kpi.biosecurity'),
                value: bio ? String(recent.filter((r) => r.type === 'biosecurity').length) : '—',
                suffix: t('compliancePage.kpi.last30'),
              },
            ]}
          />

          <div className="grid items-start gap-[20px] xl:grid-cols-[700px_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-[20px]">
            <Table
              title={t('compliancePage.log')}
              tabsLabel={t('compliancePage.logFilter')}
              tabs={[
                { value: 'all', label: t('compliancePage.tab.all') },
                { value: 'issues', label: t('compliancePage.tab.issues') },
                { value: 'checklist', label: t('compliancePage.tab.checklists') },
                { value: 'biosecurity', label: t('compliancePage.tab.biosecurity') },
              ]}
              tab={tab}
              onTabChange={setTab}
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder={t('compliancePage.search')}
              rows={shown}
              rowKey={(r) => r.key}
              onRowClick={setDetail}
              empty={records === undefined || bio === undefined ? t('ui.loading') : t('compliancePage.logEmpty')}
              columns={[
                { key: 'when', header: t('compliancePage.col.when'), width: 90, render: (r) => d(r.date) },
                { key: 'check', header: t('compliancePage.col.check'), render: (r) => r.check, sub: (r) => r.sub || null },
                { key: 'by', header: t('compliancePage.col.by'), width: 120, render: (r) => r.by || '—' },
                {
                  key: 'result',
                  header: t('compliancePage.col.result'),
                  width: 130,
                  render: (r) => <Pill tone={r.ok ? 'green' : 'red'}>{r.result}</Pill>,
                },
              ]}
            />

              <Card title={t('compliancePage.findings')} meta={records ? findings.length : undefined}>
                {findings.length === 0 ? (
                  <p className={`${ROW} text-[13px] leading-[18px] text-muted`}>{t('compliancePage.noFindings')}</p>
                ) : (
                  <ul className="flex flex-col">
                    {findings.slice(0, 6).map((r) => {
                      const bad = r.answers.filter((a) => !a.ok)
                      return (
                        <li key={r.id} className={ROW}>
                          <button
                            type="button"
                            onClick={() => setDetail(rows.find((x) => x.key === `r-${r.id}`))}
                            className="flex w-full items-start justify-between gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                          >
                            <span className="flex min-w-0 flex-col gap-[2px]">
                              <span className="text-[14px] leading-[18px] text-text">
                                {bad[0]?.label || r.template_name}
                                {bad.length > 1 ? ` ${t('compliancePage.more', { n: bad.length - 1 })}` : ''}
                              </span>
                              <span className="text-xs leading-4 text-muted">
                                {[r.template_name, d(r.completed_on), r.completed_by].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                            <Pill tone={bad.length > 1 ? 'red' : 'amber'}>{t('compliancePage.issuesN', { count: bad.length })}</Pill>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>
            </div>

            <div className="flex min-w-0 flex-col gap-[20px]">
              <Card title={t('compliancePage.holds')} meta={holdCages.length ? t('compliancePage.harvestBlocked') : undefined}>
                {!holds || holds.length === 0 ? (
                  <p className={`${ROW} text-[13px] leading-[18px] text-muted`}>{holds ? t('compliancePage.noHolds') : t('ui.loading')}</p>
                ) : (
                  <ul className="flex flex-col">
                    {holds.map((h) => (
                      <li key={h.id} className={`${ROW} flex flex-col gap-2`}>
                        <div className="flex justify-between gap-3">
                          <span className="text-[14px] leading-[18px] text-text">
                            {h.cage_name || '—'} · {h.product_name || h.treatment || h.diagnosis || '—'}
                          </span>
                          <span className="shrink-0 text-[13px] leading-4 text-warn">{t('compliancePage.clears', { date: d(h.withdrawal_until) })}</span>
                        </div>
                        {/* Paper 27: 6px line track, sky gradient fill for the share of the period served. */}
                        <div className="flex h-[6px] rounded-pill bg-line" aria-hidden>
                          <div
                            className="rounded-pill"
                            style={{ width: `${holdProgress(h, today)}%`, backgroundImage: 'linear-gradient(in oklab 90deg, #1562D6 0%, #8EC2F7 100%)' }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <DueChecklists due={due} templates={templates} onComplete={setCompleting} />
            </div>
          </div>

          <IfPermitted permission="org.settings.manage">
            {templates && templates.length > 0 && <TemplatePacks />}
          </IfPermitted>
        </div>
      )}

      {picking && (
        <Modal onClose={() => setPicking(false)} showClose size="sm" title={t('compliancePage.pickTitle')}>
          <ul className="flex flex-col">
            {openDue.map((x) => (
              <li key={x.template.id} className={ROW}>
                <button
                  type="button"
                  onClick={() => {
                    setPicking(false)
                    setCompleting(x.template)
                  }}
                  className="flex w-full flex-col gap-[2px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                >
                  <span className="text-[14px] leading-[18px] text-text">{x.template.name}</span>
                  <span className="text-xs leading-4 text-muted">
                    {t(`compliancePage.freq.${x.template.frequency}`)} · {x.period}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {completing && <CompleteModal template={completing} locationId={activeLocationId} onClose={() => setCompleting(null)} />}
      {logging && <BiosecurityModal locationId={activeLocationId} onClose={() => setLogging(false)} />}
      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}
    </Layout>
  )
}

function DueChecklists({ due, templates, onComplete }) {
  const t = useT()
  const { locale } = useLocale()
  const { showToast } = useToast()
  const canRecord = usePermission('production.health.record')
  const isAdmin = usePermission('org.settings.manage')
  const seed = useMutation(api.compliance.seedDefaultTemplates)

  if (due === undefined || templates === undefined) {
    return (
      <Card title={t('compliancePage.checklists')}>
        <p className={`${ROW} text-[13px] leading-[18px] text-muted`}>{t('ui.loading')}</p>
      </Card>
    )
  }

  if (templates.length === 0) {
    return (
      <Card title={t('compliancePage.checklists')}>
        <EmptyState
          title={t('compliancePage.noChecklists')}
          description={t('compliancePage.noChecklistsHint')}
          action={
            isAdmin ? (
              <GradientButton
                size="sm"
                onClick={async () => {
                  try {
                    const { added } = await seed({})
                    showToast('success', t('compliancePage.added', { count: added.length }))
                  } catch (err) {
                    showToast('error', errorMessage(err))
                  }
                }}
              >
                {t('compliancePage.addStandard')}
              </GradientButton>
            ) : null
          }
        />
        {isAdmin && <TemplatePacks embedded />}
      </Card>
    )
  }

  return (
    <Card title={t('compliancePage.checklists')} meta={t('compliancePage.dueN', { count: due.filter((x) => !x.done).length })}>
      {due.length === 0 ? (
        <p className={`${ROW} text-[13px] leading-[18px] text-muted`}>{t('compliancePage.allOff')}</p>
      ) : (
        <ul className="flex flex-col">
          {due.map((x) => (
            <li key={x.template.id} className={`${ROW} flex items-center justify-between gap-3`}>
              <span className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-[14px] leading-[18px] text-text">{x.template.name}</span>
                <span className="text-xs leading-4 text-muted">
                  {[
                    t('compliancePage.itemsN', { count: x.template.items.length }),
                    t(`compliancePage.freq.${x.template.frequency}`),
                    x.done
                      ? t('compliancePage.doneOn', { date: formatDate(x.done.completed_on, { locale }) })
                      : x.last_completed_on
                        ? t('compliancePage.lastDone', { date: formatDate(x.last_completed_on, { locale }) })
                        : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {x.done ? (
                <Pill tone={x.done.passed ? 'green' : 'amber'}>{x.done.passed ? t('compliancePage.done') : t('compliancePage.doneIssues')}</Pill>
              ) : canRecord ? (
                <GhostButton size="sm" onClick={() => onComplete(x.template)}>
                  {t('compliancePage.complete')}
                </GhostButton>
              ) : (
                <Pill tone="neutral">{t('compliancePage.due')}</Pill>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Country and language checklist packs (I18N-004); admins install one in a click. */
function TemplatePacks({ embedded = false }) {
  const t = useT()
  const { showToast } = useToast()
  const data = useQuery(api.compliance.templatePacks, {})
  const install = useMutation(api.compliance.installTemplatePack)
  const [busy, setBusy] = useState(null)
  if (!data) return null
  const body = (
    <ul className="flex flex-col">
      {data.packs.map((p) => {
        const complete = p.installed_count === p.templates.length
        return (
          <li key={p.id} className={`${ROW} flex flex-col gap-2`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-[2px]">
                <span className="flex items-center gap-2 text-[14px] leading-[18px] text-text">
                  {p.name}
                  {p.recommended && <TonePill tone="sky">{t('country.packs.recommended')}</TonePill>}
                </span>
                <span className="text-xs leading-4 text-muted">{p.description}</span>
                <span className="text-xs leading-4 text-faint">
                  {t('country.packs.language', { language: p.language.toUpperCase() })} ·{' '}
                  {t('country.packs.installed', { installed: p.installed_count, total: p.templates.length })}
                </span>
              </div>
              <GradientButton
                size="sm"
                variant={p.recommended ? 'solid' : 'outline'}
                disabled={complete || busy === p.id}
                onClick={async () => {
                  setBusy(p.id)
                  try {
                    const { added } = await install({ pack: p.id })
                    showToast('success', t('country.packs.added', { count: added.length }))
                  } catch (err) {
                    showToast('error', errorMessage(err))
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {complete ? t('country.packs.done') : t('country.packs.install')}
              </GradientButton>
            </div>
            <ul className="flex flex-wrap gap-2">
              {p.templates.map((tpl) => (
                <li key={tpl.key}>
                  <Pill tone={tpl.installed ? 'green' : 'neutral'}>
                    {tpl.name} · {t(`compliancePage.freq.${tpl.frequency}`)}
                    {tpl.installed ? ` · ${t('country.packs.have')}` : ''}
                  </Pill>
                </li>
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
  if (embedded) return <div className="mt-4">{body}</div>
  return (
    <Card title={t('country.packs.title')} meta={t('country.packs.subtitle', { country: data.country })}>
      {body}
    </Card>
  )
}

function CompleteModal({ template, locationId, onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const complete = useMutation(api.compliance.complete)
  const [date, setDate] = useState(localToday())
  const [answers, setAnswers] = useState(() => Object.fromEntries(template.items.map((i) => [i.id, { ok: true, note: '' }])))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const setAnswer = (id, patch) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await complete({
        templateId: template.id,
        locationId,
        date,
        answers: template.items.map((i) => ({
          itemId: i.id,
          ok: answers[i.id].ok,
          note: answers[i.id].note.trim() || undefined,
        })),
        notes: notes.trim() || undefined,
      })
      showToast(res.passed ? 'success' : 'warning', res.passed ? t('compliancePage.saved') : t('compliancePage.savedIssues'))
      onClose()
    } catch (err) {
      showToast('error', errorMessage(err, t('compliancePage.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={submit}
      noValidate
      onClose={onClose}
      showClose
      size="lg"
      title={template.name}
      description={t('compliancePage.itemsN', { count: template.items.length })}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>{t('common.cancel')}</GhostButton>
          <GradientButton type="submit" variant="solid" size="sm" disabled={saving}>
            {saving ? t('common.saving') : t('compliancePage.saveChecklist')}
          </GradientButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label={t('compliancePage.date')} htmlFor={`c-date-${template.id}`} required className="max-w-xs">
          <Input id={`c-date-${template.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col">
          <legend className="mb-2 text-[13px] font-semibold leading-4 text-text">{t('compliancePage.items')}</legend>
          {template.items.map((i) => (
            <div key={i.id} className={`${ROW} flex flex-col gap-2`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[14px] leading-[18px] text-text">{i.label}</span>
                <span className="flex gap-4 text-[13px]">
                  <label className="inline-flex min-h-11 items-center gap-2 text-text sm:min-h-0">
                    <input type="radio" className="accent-[var(--cyan)]" name={`item-${i.id}`} checked={answers[i.id].ok} onChange={() => setAnswer(i.id, { ok: true })} />
                    {t('compliancePage.ok')}
                  </label>
                  <label className="inline-flex min-h-11 items-center gap-2 text-text sm:min-h-0">
                    <input type="radio" className="accent-[var(--cyan)]" name={`item-${i.id}`} checked={!answers[i.id].ok} onChange={() => setAnswer(i.id, { ok: false })} />
                    {t('compliancePage.notOk')}
                  </label>
                </span>
              </div>
              {!answers[i.id].ok && (
                <Input
                  aria-label={t('compliancePage.whatWrongFor', { item: i.label })}
                  placeholder={t('compliancePage.whatWrong')}
                  value={answers[i.id].note}
                  onChange={(e) => setAnswer(i.id, { note: e.target.value })}
                />
              )}
            </div>
          ))}
        </fieldset>
        <Field label={t('common.notes')} htmlFor={`c-notes-${template.id}`}>
          <Textarea id={`c-notes-${template.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

const BIO_EMPTY = {
  kind: 'visitor',
  person: '',
  organisation: '',
  vehicle: '',
  purpose: '',
  area: '',
  disinfectant: '',
  entryControlsDone: true,
  notes: '',
}

function BiosecurityModal({ locationId, onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const log = useMutation(api.compliance.logBiosecurity)
  const [date, setDate] = useState(localToday())
  const [form, setForm] = useState(BIO_EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await log({
        locationId,
        date,
        kind: form.kind,
        person: form.person || undefined,
        organisation: form.organisation || undefined,
        vehicle: form.vehicle || undefined,
        purpose: form.purpose || undefined,
        area: form.area || undefined,
        disinfectant: form.disinfectant || undefined,
        entryControlsDone: form.kind === 'disinfection' ? undefined : form.entryControlsDone,
        notes: form.notes || undefined,
      })
      showToast('success', t('compliancePage.entryLogged'))
      onClose()
    } catch (err) {
      showToast('error', errorMessage(err, t('compliancePage.entryFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={submit}
      noValidate
      onClose={onClose}
      showClose
      title={t('compliancePage.newEntry')}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>{t('common.cancel')}</GhostButton>
          <GradientButton type="submit" variant="solid" size="sm" disabled={saving}>
            {saving ? t('common.saving') : t('compliancePage.logEntry')}
          </GradientButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('compliancePage.date')} htmlFor="b-date" required>
          <Input id="b-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('compliancePage.type')} htmlFor="b-kind" required>
          <Select id="b-kind" value={form.kind} onChange={set('kind')}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{t(`compliancePage.kind.${k}`)}</option>
            ))}
          </Select>
        </Field>
        {(form.kind === 'visitor' || form.kind === 'vehicle' || form.kind === 'other') && (
          <Field label={form.kind === 'vehicle' ? t('compliancePage.driver') : t('compliancePage.name')} htmlFor="b-person" required={form.kind === 'visitor'}>
            <Input id="b-person" value={form.person} onChange={set('person')} />
          </Field>
        )}
        {form.kind !== 'disinfection' && (
          <Field label={t('compliancePage.organisation')} htmlFor="b-org">
            <Input id="b-org" value={form.organisation} onChange={set('organisation')} />
          </Field>
        )}
        {(form.kind === 'vehicle' || form.kind === 'visitor') && (
          <Field label={t('compliancePage.vehicle')} htmlFor="b-vehicle" required={form.kind === 'vehicle'}>
            <Input id="b-vehicle" value={form.vehicle} onChange={set('vehicle')} />
          </Field>
        )}
        {form.kind !== 'disinfection' && (
          <Field label={t('compliancePage.purpose')} htmlFor="b-purpose">
            <Input id="b-purpose" value={form.purpose} onChange={set('purpose')} />
          </Field>
        )}
        {(form.kind === 'disinfection' || form.kind === 'other') && (
          <Field label={t('compliancePage.area')} htmlFor="b-area" required={form.kind === 'disinfection'}>
            <Input id="b-area" value={form.area} onChange={set('area')} />
          </Field>
        )}
        {form.kind === 'disinfection' && (
          <Field label={t('compliancePage.disinfectant')} htmlFor="b-dis">
            <Input id="b-dis" value={form.disinfectant} onChange={set('disinfectant')} />
          </Field>
        )}
        {form.kind !== 'disinfection' && (
          <label className="inline-flex min-h-11 items-center gap-2 text-[14px] leading-[18px] text-text sm:col-span-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--cyan)]"
              checked={form.entryControlsDone}
              onChange={(e) => setForm((p) => ({ ...p, entryControlsDone: e.target.checked }))}
            />
            {t('compliancePage.entryControls')}
          </label>
        )}
        <Field label={t('common.notes')} htmlFor="b-notes" className="sm:col-span-2">
          <Textarea id="b-notes" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  )
}

function DetailModal({ row, onClose }) {
  const t = useT()
  const { locale } = useLocale()
  const r = row.record
  const b = row.entry
  return (
    <Modal
      onClose={onClose}
      showClose
      title={row.check}
      description={[formatDate(row.date, { locale }), row.type === 'checklist' ? r.period : null, row.by !== '—' ? row.by : null].filter(Boolean).join(' · ')}
    >
      <div className="flex flex-col gap-4">
        <div>
          <Pill tone={row.ok ? 'green' : 'red'}>{row.result}</Pill>
        </div>
        {r ? (
          <ul className="flex flex-col">
            {r.answers.map((a, i) => (
              <li key={i} className={`${ROW} flex items-start justify-between gap-3`}>
                <span className="flex min-w-0 flex-col gap-[2px]">
                  <span className="text-[14px] leading-[18px] text-text">{a.label}</span>
                  {a.note && <span className="text-xs leading-4 text-muted">{a.note}</span>}
                </span>
                <Pill tone={a.ok ? 'green' : 'red'}>{a.ok ? t('compliancePage.ok') : t('compliancePage.notOk')}</Pill>
              </li>
            ))}
          </ul>
        ) : (
          <dl className="grid grid-cols-2 gap-4">
            {[
              ['name', b.person],
              ['organisation', b.organisation],
              ['vehicle', b.vehicle],
              ['purpose', b.purpose],
              ['area', b.area],
              ['disinfectant', b.disinfectant],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1">
                  <dt className="text-xs leading-4 text-muted">{t(`compliancePage.${k}`)}</dt>
                  <dd className="text-[14px] leading-[18px] text-text">{v}</dd>
                </div>
              ))}
          </dl>
        )}
        {(r?.notes || b?.notes) && <p className="text-[13px] leading-[18px] text-muted">{r?.notes || b?.notes}</p>}
        <Attachments entityType={r ? 'complianceRecords' : 'biosecurityLogs'} entityId={r ? r.id : b.id} />
      </div>
    </Modal>
  )
}
