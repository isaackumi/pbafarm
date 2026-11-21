import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Skeleton } from '../ui'
import { useToast } from '../Toast'
import { errorMessage } from '../../lib/errorMessage'
import { useLocale, useT } from '../../lib/i18n/context'

/**
 * Bot templates manager (Paper T2b, VQL-1): usage strip, templates table
 * sorted by use (All / Shared / Personal), and the editor with a Telegram
 * preview of the draft a template fills. The server checks every change:
 * personal templates for their owner, shared ones for managers
 * (convex/bot/templates.ts).
 */

const KINDS = ['daily_plan', 'daily_same', 'water_check', 'feed_issue']

const BLANK = {
  id: null,
  name: '',
  kind: 'daily_plan',
  shortcut: '',
  scope: 'personal',
  siteId: null,
  cages: { mode: 'mine' },
  feedTypeId: null,
  quantityKg: '',
}

function draftOf(row) {
  if (!row) return { ...BLANK }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    shortcut: row.shortcut ?? '',
    scope: row.scope,
    siteId: row.siteId,
    cages: row.cages,
    feedTypeId: row.feedTypeId,
    quantityKg: row.quantityKg ?? '',
  }
}

/** Page state shared by the header action ("New template") and the body. */
export function useBotTemplates() {
  const [now] = useState(() => Date.now())
  const data = useQuery(api.bot.templates.list, { now })
  const [selected, setSelected] = useState(undefined)
  const [draft, setDraft] = useState(null)
  // Open the most used template first, as the artboard does.
  useEffect(() => {
    if (!data || selected !== undefined) return
    const first = data.templates[0] ?? null
    setSelected(first ? first.id : null)
    setDraft(draftOf(first))
  }, [data, selected])
  const select = (row) => {
    setSelected(row.id)
    setDraft(draftOf(row))
  }
  const startNew = () => {
    setSelected(null)
    setDraft({ ...BLANK, kind: data?.canIssue === false ? 'daily_plan' : BLANK.kind })
  }
  return { data, selected, draft, setDraft, select, startNew }
}

const num = (n, locale) => Number(n || 0).toLocaleString(locale)

function kgText(kg) {
  const r = Math.round(kg * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/** "C-01 to C-06" for a run, else "A-01, A-02 +3" (matches the bot, convex/bot/groups.ts). */
function cagesLabel(t, names) {
  if (!names.length) return ''
  if (names.length === 1) return names[0]
  const parts = names.map((n) => /^(.*?)(\d+)$/.exec(n))
  if (parts.every(Boolean)) {
    const prefix = parts[0][1]
    const nums = parts.map((p) => Number(p[2]))
    if (names.length > 2 && parts.every((p) => p[1] === prefix) && nums.every((x, i) => i === 0 || x === nums[i - 1] + 1)) {
      return t('botTemplates.range', { first: names[0], last: names[names.length - 1] })
    }
  }
  return names.length <= 4 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`
}

/** The cage names a draft covers (null for "my cages": known only in the chat). */
function coveredNames(data, d) {
  const c = d.cages
  if (!c || c.mode === 'none' || c.mode === 'mine') return null
  if (c.mode === 'row') {
    const site = c.siteId ?? d.siteId
    return data.rows
      .filter((r) => r.row.toUpperCase() === c.row.toUpperCase() && (!site || r.siteId === site))
      .flatMap((r) => r.cages)
  }
  const byId = new Map(data.cages.map((x) => [x.id, x.name]))
  return c.cageIds.map((id) => byId.get(id)).filter(Boolean)
}

export default function BotTemplates({ state }) {
  const { data, selected, draft, setDraft, select } = state
  const [tab, setTab] = useState('all')
  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-[78px]" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  const personal = data.templates.filter((r) => r.scope === 'personal')
  const rows = tab === 'shared' ? data.templates.filter((r) => r.scope === 'site') : tab === 'personal' ? personal : data.templates
  return (
    <div className="flex h-fit grow basis-0 flex-col gap-5">
      <UsageStrip totals={data.totals} />
      <TemplatesTable
        rows={rows}
        tab={tab}
        setTab={setTab}
        personalCount={personal.length}
        selected={selected}
        onSelect={select}
        sites={data.sites}
      />
      {draft && <Editor data={data} draft={draft} setDraft={setDraft} key={draft.id ?? 'new'} onDone={state.startNew} />}
    </div>
  )
}

function UsageStrip({ totals }) {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const loc = formatLocale || locale || 'en'
  const hours = Math.round(totals.minutesSaved / 60)
  const stat = (value, label, lime = false) => (
    <div className="flex flex-col gap-[2px]">
      <div className={`text-[22px] font-semibold leading-[28px] tracking-tight ${lime ? 'text-lime-ink [html[data-theme=light]_&]:text-[#4F6B00]' : 'text-text'}`}>
        {value}
      </div>
      <div className="text-[12px] leading-4 text-muted">{label}</div>
    </div>
  )
  return (
    <section className="flex flex-wrap items-center gap-8 rounded-card border border-line bg-surface px-5 py-4">
      {stat(num(totals.count, loc), t('botTemplates.strip.templates'))}
      {stat(num(totals.uses30, loc), t('botTemplates.strip.uses'))}
      {stat(hours >= 1 ? `~${num(hours, loc)} h` : `~${num(totals.minutesSaved, loc)} min`, t('botTemplates.strip.saved'), true)}
      <div className="grow" />
      <p className="max-w-[300px] text-[13px] leading-[18px] text-muted">
        {t('botTemplates.strip.hintBefore')} <span className="font-mono text-text">/t</span> {t('botTemplates.strip.hintAfter')}
      </p>
    </section>
  )
}

function fillsIn(t, row) {
  const kind = t(`botTemplates.kind.${row.kind}`)
  if (row.kind === 'feed_issue') {
    return row.quantityKg ? `${kind} · ${t('botTemplates.fills.issue', { kg: kgText(row.quantityKg) })}` : kind
  }
  const how = row.kind === 'daily_plan' ? t('botTemplates.fills.plan') : row.kind === 'daily_same' ? t('botTemplates.fills.same') : null
  const where = row.cages.mode === 'mine' ? t('botTemplates.fills.mine') : row.cageCount != null ? t('botTemplates.fills.cages', { count: row.cageCount }) : null
  return [kind, how, where].filter(Boolean).join(' · ')
}

function whoCanUse(t, row) {
  if (row.scope === 'personal') return { text: t('botTemplates.who.only', { name: row.ownerName.split(/\s+/)[0] }), muted: true }
  return { text: t('botTemplates.who.site', { site: row.siteName ?? '', count: row.siteMembers ?? 0 }), muted: false }
}

function TemplatesTable({ rows, tab, setTab, personalCount, selected, onSelect, sites }) {
  const t = useT()
  const { showToast } = useToast()
  const share = useMutation(api.bot.templates.share)
  const tabs = [
    { value: 'all', label: t('botTemplates.tabs.all') },
    { value: 'shared', label: t('botTemplates.tabs.shared') },
    { value: 'personal', label: t('botTemplates.tabs.personal', { count: personalCount }) },
  ]
  const onShare = async (row) => {
    const siteId = sites[0]?.id
    if (!siteId) return
    try {
      await share({ id: row.id, siteId })
      showToast('success', t('botTemplates.toast.shared', { site: sites[0].name }))
    } catch (err) {
      showToast('error', errorMessage(err))
    }
  }
  return (
    <section className="flex flex-col rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
        <h2 className="text-[18px] font-semibold leading-[22px] text-text">{t('botTemplates.table.title')}</h2>
        <div role="tablist" aria-label={t('botTemplates.table.title')} className="flex items-center gap-4">
          {tabs.map((x) => (
            <button
              key={x.value}
              type="button"
              role="tab"
              aria-selected={tab === x.value}
              onClick={() => setTab(x.value)}
              className={`text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${tab === x.value ? 'text-text' : 'text-muted hover:text-text'}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="grow" />
        <span className="text-[12px] leading-4 text-muted">{t('botTemplates.table.sorted')}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="flex border-b border-line px-5 py-[10px] text-[11px] leading-[14px] tracking-wide text-faint">
            <div className="w-[230px] shrink-0">{t('botTemplates.table.template')}</div>
            <div className="w-[230px] shrink-0">{t('botTemplates.table.fills')}</div>
            <div className="w-[150px] shrink-0">{t('botTemplates.table.who')}</div>
            <div className="w-[80px] shrink-0 text-right">{t('botTemplates.table.uses')}</div>
            <div className="grow" />
          </div>
          {!rows.length && <p className="px-5 py-4 text-[13px] leading-4 text-muted">{t('botTemplates.table.empty')}</p>}
          <div className="max-h-[520px] overflow-y-auto">
            {rows.map((row, i) => {
              const on = row.id === selected
              const who = whoCanUse(t, row)
              const action = on ? 'editing' : row.canShare ? 'share' : row.canEdit ? 'edit' : 'view'
              return (
                <div
                  key={row.id}
                  className={`flex items-center px-5 py-3 ${i < rows.length - 1 ? 'border-b border-line' : ''} ${on ? 'bg-surface-2' : ''}`}
                >
                  <div className="flex w-[230px] shrink-0 flex-col gap-[2px] pr-3">
                    <button type="button" onClick={() => onSelect(row)} className="text-left text-[14px] font-medium leading-[18px] text-text hover:underline">
                      {row.name}
                    </button>
                    <div className="text-[12px] leading-4 text-muted">
                      {row.scope === 'personal' ? t('botTemplates.table.personalBy', { name: row.ownerName }) : row.ownerName}
                    </div>
                  </div>
                  <div className="w-[230px] shrink-0 pr-3 text-[13px] leading-4 text-muted">{fillsIn(t, row)}</div>
                  <div className={`w-[150px] shrink-0 pr-3 text-[13px] leading-4 ${who.muted ? 'text-muted' : 'text-text'}`}>{who.text}</div>
                  <div className="w-[80px] shrink-0 text-right text-[13px] leading-4 text-text">{row.uses30}</div>
                  <div className="grow text-right text-[13px] leading-4">
                    {action === 'editing' && <span className="text-sky-ink [html[data-theme=light]_&]:text-[#1562D6]">{t('botTemplates.table.editing')}</span>}
                    {action === 'share' && (
                      <button type="button" onClick={() => onShare(row)} className="text-sky-ink hover:underline [html[data-theme=light]_&]:text-[#1562D6]">
                        {t('botTemplates.table.share')}
                      </button>
                    )}
                    {(action === 'edit' || action === 'view') && (
                      <button type="button" onClick={() => onSelect(row)} className="text-muted hover:text-text">
                        {action === 'edit' ? t('botTemplates.table.edit') : t('botTemplates.table.view')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

const BOX = 'h-[40px] w-full shrink-0 rounded-[12px] border border-line-strong bg-transparent px-3 text-[14px] leading-[18px] text-text focus:border-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-60'

function Editor({ data, draft, setDraft, onDone }) {
  const t = useT()
  const { showToast } = useToast()
  const save = useMutation(api.bot.templates.save)
  const remove = useMutation(api.bot.templates.remove)
  const rations = useQuery(api.feedingPlans.rations, {})
  const [busy, setBusy] = useState(null)
  const row = data.templates.find((x) => x.id === draft.id)
  const editable = !row || row.canEdit
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))

  const cageChoices = useMemo(() => {
    const siteName = new Map(data.sites.map((s) => [s.id, s.name]))
    const multi = data.sites.length > 1
    return [
      { key: 'mine', label: t('botTemplates.cages.mine'), value: { mode: 'mine' } },
      ...data.rows.map((r) => ({
        key: `row:${r.siteId ?? ''}:${r.row}`,
        label: multi && r.siteId ? t('botTemplates.cages.rowAt', { row: r.row, site: siteName.get(r.siteId) ?? '' }) : t('botTemplates.cages.row', { row: r.row }),
        value: { mode: 'row', row: r.row, ...(r.siteId ? { siteId: r.siteId } : {}) },
      })),
    ]
  }, [data.rows, data.sites, t])
  const cageKey = (c) => (c.mode === 'row' ? `row:${c.siteId ?? ''}:${c.row}` : c.mode === 'list' ? 'list' : c.mode)
  const names = coveredNames(data, draft)
  const cageHint =
    draft.cages.mode === 'row'
      ? t('botTemplates.cages.rowHint', { cages: cagesLabel(t, names ?? []) })
      : draft.cages.mode === 'mine'
        ? t('botTemplates.cages.mineHint')
        : ''

  const planKg = useMemo(() => {
    if (!rations || !names) return null
    const byName = new Map(rations.rows.map((r) => [r.cageName, r.ration.ok ? r.ration.kgPerDay : null]))
    const kgs = names.map((n) => byName.get(n)).filter((x) => x != null)
    return kgs.length ? kgs.reduce((a, b) => a + b, 0) : null
  }, [rations, names])

  const feedName = data.feedTypes.find((f) => f.id === draft.feedTypeId)?.name
  const shareOptions = [
    { value: 'personal', label: t('botTemplates.share.only') },
    ...(data.canManage ? data.sites.map((s) => ({ value: `site:${s.id}`, label: t('botTemplates.share.site', { site: s.name }) })) : []),
  ]
  const shareValue = draft.scope === 'site' && draft.siteId ? `site:${draft.siteId}` : 'personal'

  const sources =
    draft.kind === 'feed_issue'
      ? null
      : draft.kind === 'water_check'
        ? [
            [t('botTemplates.src.do'), t('botTemplates.src.doValue')],
            [t('botTemplates.src.temp'), t('botTemplates.src.tempValue')],
          ]
        : [
            [t('botTemplates.src.feedKg'), draft.kind === 'daily_plan' ? t('botTemplates.src.feedPlan') : t('botTemplates.src.feedSame')],
            [t('botTemplates.src.feedType'), draft.kind === 'daily_plan' ? t('botTemplates.src.typePellet') : t('botTemplates.src.typeSame')],
            [t('botTemplates.src.dead'), t('botTemplates.src.deadValue')],
          ]

  const preview = (() => {
    const label = names ? cagesLabel(t, names) : t('botTemplates.fills.mine')
    if (draft.kind === 'feed_issue') {
      return { lines: `${t('botTemplates.kind.feed_issue')}: ${draft.quantityKg || 0} kg ${feedName ?? ''}`.trim(), n: 1 }
    }
    if (draft.kind === 'water_check') return { lines: `${label}\nDO · ${t('botTemplates.preview.temp')}`, n: names?.length ?? 1 }
    const kg = draft.kind === 'daily_plan' && planKg != null ? `${kgText(planKg)} kg` : t('botTemplates.preview.yesterdayKg')
    const feed = data.feedTypes.length === 1 ? data.feedTypes[0].name : t('botTemplates.preview.pellet')
    return { lines: `${label} · ${kg}\n${feed} · ${t('botTemplates.preview.dead')}: 0`, n: names?.length ?? 1 }
  })()

  const onSave = async () => {
    setBusy('save')
    try {
      const id = await save({
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        kind: draft.kind,
        shortcut: draft.shortcut || undefined,
        scope: draft.scope,
        siteId: draft.scope === 'site' ? draft.siteId : undefined,
        cages: draft.kind === 'feed_issue' ? { mode: 'none' } : draft.cages.mode === 'none' ? { mode: 'mine' } : draft.cages,
        feedTypeId: draft.kind === 'feed_issue' ? draft.feedTypeId ?? undefined : undefined,
        quantityKg: draft.kind === 'feed_issue' ? Number(draft.quantityKg) || undefined : undefined,
      })
      set({ id })
      showToast('success', t('botTemplates.toast.saved'))
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const onDelete = async () => {
    if (!draft.id) return onDone()
    setBusy('delete')
    try {
      await remove({ id: draft.id })
      showToast('success', t('botTemplates.toast.deleted'))
      onDone()
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-6 rounded-card border border-line bg-surface p-5 lg:flex-row">
      <div className="flex min-w-0 grow basis-0 flex-col gap-4">
        <input
          aria-label={t('botTemplates.editor.name')}
          placeholder={t('botTemplates.editor.namePlaceholder')}
          value={draft.name}
          disabled={!editable}
          onChange={(e) => set({ name: e.target.value.slice(0, 60) })}
          style={{ fontWeight: 600 }}
          className="w-full bg-transparent text-[18px] font-semibold leading-[22px] text-text placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        />
        <div className="flex gap-3">
          <label className="flex grow basis-0 flex-col gap-[6px]">
            <span className="text-[12px] leading-4 text-muted">{t('botTemplates.editor.type')}</span>
            <select
              className={BOX}
              value={draft.kind}
              disabled={!editable}
              onChange={(e) => set({ kind: e.target.value, cages: e.target.value === 'feed_issue' ? { mode: 'none' } : draft.cages.mode === 'none' ? { mode: 'mine' } : draft.cages })}
            >
              {KINDS.filter((k) => k !== 'feed_issue' || data.canIssue).map((k) => (
                <option key={k} value={k}>
                  {t(`botTemplates.kindLong.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex grow basis-0 flex-col gap-[6px]">
            <span className="text-[12px] leading-4 text-muted">{t('botTemplates.editor.shortcut')}</span>
            <div className={`${BOX} flex items-center font-mono`}>
              <span className="text-text">/t&nbsp;</span>
              <input
                aria-label={t('botTemplates.editor.shortcut')}
                value={draft.shortcut}
                disabled={!editable}
                onChange={(e) => set({ shortcut: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) })}
                className="w-full bg-transparent text-[14px] leading-[18px] text-text focus:outline-none"
              />
            </div>
          </label>
        </div>
        {draft.kind !== 'feed_issue' ? (
          <div className="flex flex-col gap-[6px]">
            <span className="text-[12px] leading-4 text-muted">{t('botTemplates.editor.cages')}</span>
            <div className="flex min-h-[40px] flex-wrap items-center gap-[6px] rounded-[12px] border border-line-strong px-2">
              <span className="rounded-pill bg-surface-2 px-[10px] py-1">
                <select
                  aria-label={t('botTemplates.editor.cages')}
                  className="bg-transparent text-[13px] leading-4 text-text focus:outline-none"
                  value={cageKey(draft.cages)}
                  disabled={!editable}
                  onChange={(e) => {
                    const hit = cageChoices.find((c) => c.key === e.target.value)
                    if (hit) set({ cages: hit.value })
                  }}
                >
                  {draft.cages.mode === 'list' && <option value="list">{t('botTemplates.cages.list', { count: names?.length ?? 0 })}</option>}
                  {cageChoices.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </span>
              {cageHint && <span className="text-[13px] leading-4 text-faint">{cageHint}</span>}
              {draft.cages.mode === 'list' && names && <span className="text-[13px] leading-4 text-faint">{cagesLabel(t, names)}</span>}
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <label className="flex grow basis-0 flex-col gap-[6px]">
              <span className="text-[12px] leading-4 text-muted">{t('botTemplates.src.feedType')}</span>
              <select className={BOX} value={draft.feedTypeId ?? ''} disabled={!editable} onChange={(e) => set({ feedTypeId: e.target.value || null })}>
                <option value="">{t('botTemplates.editor.pickFeed')}</option>
                {data.feedTypes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex grow basis-0 flex-col gap-[6px]">
              <span className="text-[12px] leading-4 text-muted">{t('botTemplates.editor.quantity')}</span>
              <input
                className={BOX}
                inputMode="decimal"
                value={draft.quantityKg}
                disabled={!editable}
                onChange={(e) => set({ quantityKg: e.target.value.replace(/[^0-9.]/g, '') })}
              />
            </label>
          </div>
        )}
        <div className="flex flex-col rounded-[12px] border border-line">
          {(sources ?? []).map(([label, value]) => (
            <div key={label} className="flex border-b border-line px-3 py-[10px]">
              <div className="w-[120px] shrink-0 text-[13px] leading-4 text-muted">{label}</div>
              <div className="text-[13px] leading-4 text-text">{value}</div>
            </div>
          ))}
          <div className="flex items-center px-3 py-[10px]">
            <div className="w-[120px] shrink-0 text-[13px] leading-4 text-muted">{t('botTemplates.src.shared')}</div>
            {editable && shareOptions.length > 1 ? (
              <select
                aria-label={t('botTemplates.src.shared')}
                className="bg-transparent text-[13px] leading-4 text-text focus:outline-none"
                value={shareValue}
                onChange={(e) =>
                  e.target.value === 'personal'
                    ? set({ scope: 'personal', siteId: null })
                    : set({ scope: 'site', siteId: e.target.value.slice('site:'.length) })
                }
              >
                {shareOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-[13px] leading-4 text-text">{shareOptions.find((o) => o.value === shareValue)?.label ?? t('botTemplates.share.only')}</div>
            )}
          </div>
        </div>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-[10px] lg:w-[320px]">
        <div className="text-[12px] leading-4 text-muted">{t('botTemplates.preview.title')}</div>
        <div className="flex flex-col gap-[2px] rounded-[12px] bg-[#0E1621] p-[14px]">
          <div className="flex flex-col gap-[6px] rounded-b-[4px] rounded-t-[12px] bg-[#182533] px-3 py-[10px]">
            <div className="text-[13px] leading-[18px] text-[#F5F5F5]">{t('botTemplates.preview.check')}</div>
            <div className="whitespace-pre-wrap rounded-[4px] border-l-[3px] border-l-[#6AA8F5] bg-[#0E1621] px-[10px] py-2 text-[12px] leading-[18px] text-[#F5F5F5]">
              {preview.lines}
            </div>
          </div>
          <div className="flex gap-[2px]">
            <div className="flex h-[34px] grow basis-0 items-center justify-center rounded-bl-[12px] rounded-br-[6px] rounded-t-[6px] bg-[#1E2C3AD9] text-[12px] font-semibold leading-4 text-[#6AB2F2]">
              {preview.n === 1 ? t('botTemplates.preview.save') : t('botTemplates.preview.saveAll', { count: preview.n })}
            </div>
            <div className="flex h-[34px] grow basis-0 items-center justify-center rounded-[6px] bg-[#1E2C3AD9] text-[12px] leading-4 text-[#6AB2F2]">
              {t('botTemplates.preview.edit')}
            </div>
            <div className="flex h-[34px] grow basis-0 items-center justify-center rounded-bl-[6px] rounded-br-[12px] rounded-t-[6px] bg-[#1E2C3AD9] text-[12px] leading-4 text-[#6AB2F2]">
              {t('botTemplates.preview.cancel')}
            </div>
          </div>
        </div>
        {editable && (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onDelete}
              disabled={!!busy}
              className="flex h-[36px] items-center rounded-pill border border-line-strong px-[14px] text-[13px] leading-4 text-text hover:bg-surface-2 disabled:opacity-50"
            >
              {t('botTemplates.editor.delete')}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!!busy}
              className="flex h-[36px] items-center rounded-pill bg-lime px-4 text-[13px] font-semibold leading-4 text-[#0A0B0C] hover:opacity-90 disabled:opacity-50"
            >
              {t('botTemplates.editor.save')}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
