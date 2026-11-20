import { useEffect, useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Modal, SearchField } from '../ui'
import LimeButton from './LimeButton'
import KeeperAvatar from './KeeperAvatar'
import { TickIcon } from './icons'
import { useLocale, useT } from '../../lib/i18n/context'
import { addDaysIso, coverLoad, handoverNote, nearDate, nextMonday, shortDate } from '../../lib/keepers'
import { localToday } from '../../lib/format'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
const FIELD = 'h-11 w-full rounded-[12px] border border-line-strong bg-bg px-3.5 text-[14px] leading-[18px] text-text'

/**
 * Plan cover (Paper 56): who looks after a keeper's units while they are
 * away. Dates, a cover with the load it would carry (suggested / heavy
 * load), an optional split between two people, what moves, and a handover
 * note drafted from the units. "Set cover" drafts it; the Anowa card
 * confirms it and tells the cover.
 */
export default function PlanCoverSheet({ open, keeperId: initialKeeper, onClose, onSubmit, busy }) {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const lang = formatLocale || locale
  const today = localToday()
  const [keeperId, setKeeperId] = useState(initialKeeper || null)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState(() => nextMonday(today))
  const [to, setTo] = useState(() => addDaysIso(nextMonday(today), 3))
  const [coverId, setCoverId] = useState(null)
  const [split, setSplit] = useState(false)
  const [splitTo, setSplitTo] = useState({})
  const [note, setNote] = useState('')
  const [noteTouched, setNoteTouched] = useState(false)

  useEffect(() => {
    if (open) {
      setKeeperId(initialKeeper || null)
      setCoverId(null)
      setSplit(false)
      setSplitTo({})
      setNoteTouched(false)
      setSearch('')
    }
  }, [open, initialKeeper])

  const people = useQuery(api.keepers.board.people, open && !keeperId && search.trim().length >= 2 ? { search: search.trim() } : 'skip')
  const preview = useQuery(api.keepers.board.coverPreview, open && keeperId ? { keeperId, asOf: today } : 'skip')

  const candidates = useMemo(() => {
    if (!preview) return []
    // Room first, then the same row, then the lightest load; only a cover with room is "Suggested".
    const list = preview.candidates
      .map((c) => ({ ...c, ...coverLoad(c.units, preview.units.length, preview.capacity) }))
      .sort((a, b) => Number(a.heavy) - Number(b.heavy) || (a.heavy ? 0 : Number(b.sameRow) - Number(a.sameRow)) || a.during - b.during)
    return list.map((c, i) => ({ ...c, suggested: i === 0 && !c.heavy }))
  }, [preview])
  const cover = candidates.find((c) => c.id === coverId) || candidates.find((c) => c.suggested) || candidates[0] || null
  const second = candidates.find((c) => c.id !== cover?.id) || null

  // The note is drafted from the units until the manager edits it.
  useEffect(() => {
    if (!preview || noteTouched) return
    const parts = [handoverNote(t, preview.units)]
    if (preview.openTasks) parts.push(t('keepers.cover.note.tasks', { count: preview.openTasks }))
    setNote(parts.filter(Boolean).join(' '))
  }, [preview, noteTouched, t])

  const keeperName = preview?.keeper.name || ''
  const valid = keeperId && cover && from && to && to > from
  const submit = () => {
    if (!valid) return
    const splitList = split && second ? Object.entries(splitTo).filter(([, who]) => who === second.id).map(([unitId]) => ({ unitId, coverId: second.id })) : []
    onSubmit({
      kind: 'keeper_cover',
      keeperId,
      coverId: cover.id,
      fromDate: from,
      toDate: to,
      ...(splitList.length ? { split: splitList } : {}),
      ...(note.trim() ? { note: note.trim().slice(0, 1000) } : {}),
    })
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" showClose className="!max-w-[560px] !bg-surface" bodyClassName="flex flex-col gap-[22px]" aria-label={t('keepers.cover.eyebrow')}>
      <div className="flex flex-col gap-[6px]">
        <span className="text-[13px] leading-4 text-muted">{t('keepers.cover.eyebrow')}</span>
        <h2 className="text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-text">
          {keeperId ? (preview ? t('keepers.cover.title', { name: keeperName, count: preview.units.length }) : t('keepers.loading')) : t('keepers.cover.whoAway')}
        </h2>
      </div>

      {!keeperId && (
        <div className="flex flex-col gap-2">
          <SearchField value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('keepers.cover.findKeeper')} aria-label={t('keepers.cover.findKeeper')} />
          <ul className="flex flex-col gap-1.5">
            {(people || []).map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setKeeperId(p.id)} className={`flex w-full items-center gap-3 rounded-[14px] border border-line px-3.5 py-2.5 text-left ${FOCUS}`}>
                  <KeeperAvatar name={p.name} size={32} />
                  <span className="grow text-sm font-semibold text-text">{p.name}</span>
                  <span className="text-xs text-muted">{t('keepers.assign.loadNow', { count: p.units })}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {keeperId && preview && (
        <>
          {preview.units.length === 0 ? (
            <p className="text-sm text-muted">{t('keepers.cover.noUnits', { name: keeperName })}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="flex flex-col gap-[6px] text-xs leading-4 text-muted">
                  {t('keepers.cover.from')}
                  <input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} className={FIELD} />
                </label>
                <label className="flex flex-col gap-[6px] text-xs leading-4 text-muted">
                  {t('keepers.cover.backOn')}
                  <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={FIELD} />
                </label>
              </div>
              {preview.existing.length > 0 && (
                <p className="text-xs text-warn">
                  {t('keepers.cover.existing', { from: shortDate(preview.existing[0].fromDate, lang), to: shortDate(preview.existing[0].toDate, lang) })}
                </p>
              )}

              <div className="flex flex-col gap-2">
                <span className="text-xs leading-4 text-muted">{t('keepers.cover.cover')}</span>
                {candidates.length === 0 && <p className="text-sm text-muted">{t('keepers.cover.noCandidates')}</p>}
                <ul className="flex flex-col gap-2" role="radiogroup" aria-label={t('keepers.cover.cover')}>
                  {candidates.slice(0, 4).map((c) => {
                    const on = cover?.id === c.id
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setCoverId(c.id)}
                          className={`flex w-full items-center gap-3 rounded-[14px] px-3.5 py-3 text-left ${FOCUS} ${on ? 'border-[1.5px] border-cover' : 'border border-line'}`}
                        >
                          <KeeperAvatar name={c.name} size={32} />
                          <span className="flex min-w-0 grow flex-col gap-[2px]">
                            <span className="truncate text-[14px] font-semibold leading-[18px] text-text">{c.name}</span>
                            <span className="text-xs leading-4 text-muted">
                              {t('keepers.cover.load', { now: c.now, count: c.during })}
                              {c.sameRow ? ` · ${t('keepers.cover.sameRow')}` : ''}
                            </span>
                          </span>
                          {c.heavy ? (
                            <span className="shrink-0 text-xs leading-4 text-warn">{t('keepers.cover.heavy')}</span>
                          ) : c.suggested ? (
                            <span className="shrink-0 text-xs leading-4 text-cover">{t('keepers.cover.suggested')}</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {second && (
                  <button type="button" onClick={() => setSplit((s) => !s)} className={`self-start pl-[2px] text-[13px] leading-[18px] text-cover hover:underline ${FOCUS}`} aria-expanded={split}>
                    {split ? t('keepers.cover.noSplit') : t('keepers.cover.split')}
                  </button>
                )}
                {split && second && cover && (
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {preview.units.map((u) => (
                      <li key={u.id} className="flex items-center justify-between gap-2 rounded-[12px] border border-line px-3 py-2 text-sm">
                        <span className="font-semibold text-text">{u.name}</span>
                        <select
                          value={splitTo[u.id] || cover.id}
                          onChange={(e) => setSplitTo((m) => ({ ...m, [u.id]: e.target.value }))}
                          aria-label={t('keepers.cover.splitWho', { unit: u.name })}
                          className="rounded-[8px] border border-line-strong bg-bg px-2 py-1 text-xs text-text"
                        >
                          <option value={cover.id}>{cover.name}</option>
                          <option value={second.id}>{second.name}</option>
                        </select>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {cover && (
                <div className="flex flex-col gap-2.5 rounded-2xl bg-bg p-4">
                  <span className="text-[13px] font-semibold leading-[18px] text-text">{t('keepers.cover.gets', { keeper: keeperName, name: cover.name })}</span>
                  {[
                    t('keepers.cover.getsUnits', { count: preview.units.length }),
                    t('keepers.cover.getsReminders'),
                    t('keepers.cover.getsTasks', { count: preview.openTasks }),
                  ].map((line) => (
                    <span key={line} className="flex items-center gap-[10px] text-[13px] leading-[18px] text-muted">
                      <TickIcon size={16} className="shrink-0 text-good" />
                      {line}
                    </span>
                  ))}
                  <span className="pt-[2px] text-xs leading-[17px] text-faint">{t('keepers.cover.returns', { date: nearDate(to, lang, today), keeper: keeperName, name: cover.name })}</span>
                </div>
              )}

              <label className="flex flex-col gap-[6px] text-xs leading-4 text-muted">
                {t('keepers.cover.noteLabel')}
                <textarea
                  value={note}
                  rows={3}
                  maxLength={1000}
                  onChange={(e) => {
                    setNote(e.target.value)
                    setNoteTouched(true)
                  }}
                  className="rounded-[12px] border border-line-strong bg-bg px-3.5 py-3 text-[14px] leading-[21px] text-text"
                />
              </label>
            </>
          )}
        </>
      )}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className={`rounded-pill px-[18px] py-[11px] text-[14px] font-medium leading-[18px] text-muted hover:text-text ${FOCUS}`}>
          {t('common.cancel')}
        </button>
        <LimeButton size="cta" onClick={submit} disabled={!valid || busy}>
          {cover ? t('keepers.cover.submit', { name: cover.name }) : t('keepers.cover.submitNone')}
        </LimeButton>
      </div>
    </Modal>
  )
}
