import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { Check, Loader2, Mic } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import LimeButton from '../components/keepers/LimeButton'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { localToday } from '../lib/format'
import { useLocale, useT } from '../lib/i18n/context'
import { clock, shortDate } from '../lib/keepers'
import { saveOrQueue } from '../lib/outboxSenders'
import { errorMessage } from '../lib/errorMessage'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
const CACHE = 'anowa:my-cages:'

/**
 * My cages (Paper 55): the units I log today, to do first, then done, with a
 * progress ring. "Log today" saves feed and deaths through the offline
 * outbox (lib/outboxSenders): with no signal the entry waits on the phone and
 * is sent when it is back. The last list is kept on the device so the page
 * still opens offline.
 */
export default function MyCagesPage() {
  return (
    <ProtectedRoute permission="production.daily.record">
      <MyCages />
    </ProtectedRoute>
  )
}

function readCache(userId) {
  try {
    const raw = userId && typeof localStorage !== 'undefined' ? localStorage.getItem(CACHE + userId) : null
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function MyCages() {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const lang = formatLocale || locale
  const { user } = useAuth()
  const userId = user?.id
  const { showToast } = useToast()
  const asOf = localToday()
  const live = useQuery(api.keepers.views.myCages, { asOf })
  const [cached, setCached] = useState(null)
  const [queued, setQueued] = useState(() => new Map())
  const [openId, setOpenId] = useState(null)

  useEffect(() => setCached(readCache(userId)), [userId])
  useEffect(() => {
    if (!live || !userId) return
    try {
      localStorage.setItem(CACHE + userId, JSON.stringify(live))
    } catch {
      // Storage full or blocked: the page still works online.
    }
  }, [live, userId])

  const data = live ?? (cached?.date === asOf ? cached : undefined)
  const todo = useMemo(() => (data?.todo || []).filter((c) => !queued.has(c.id)), [data, queued])
  const done = useMemo(
    () => [...(data?.done || []), ...(data?.todo || []).filter((c) => queued.has(c.id)).map((c) => ({ ...c, logged: queued.get(c.id) }))],
    [data, queued],
  )
  const total = data?.total ?? 0
  const featured = todo[0]

  return (
    <Layout title={t('keepers.mine.title')} eyebrow={data ? [shortDate(asOf, lang), data.siteName].filter(Boolean).join(' · ') : ''}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-[18px]">
        {data === undefined ? (
          <p className="text-sm text-muted" role="status">{t('keepers.loading')}</p>
        ) : data.away ? (
          <p className="rounded-2xl border border-line bg-surface px-4 py-3.5 text-sm text-muted">
            {t('keepers.mine.away', { name: data.away.coverName, date: shortDate(data.away.toDate, lang) })}
          </p>
        ) : total === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-4 py-3.5 text-sm text-muted">{t('keepers.mine.none')}</p>
        ) : (
          <>
            <div className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-3.5">
              <Ring done={done.length} total={total} />
              <div className="flex flex-col gap-0.5">
                <span className="text-base font-semibold text-text">{t('keepers.mine.progress', { done: done.length, count: total })}</span>
                <span className="text-[13px] leading-[18px] text-muted">
                  {todo.length
                    ? t('keepers.mine.left', { count: todo.length, deadline: data.deadline })
                    : t('keepers.mine.allDone')}
                  {data.backupName ? ` ${t('keepers.mine.backup', { name: data.backupName })}` : ''}
                </span>
              </div>
            </div>
            {!live && <p className="text-xs text-warn">{t('keepers.mine.offline')}</p>}

            {todo.length > 0 && (
              <section className="flex flex-col gap-2.5" aria-label={t('keepers.mine.todo', { count: todo.length })}>
                <h2 className="text-xs uppercase tracking-wide text-muted">{t('keepers.mine.todo', { count: todo.length })}</h2>
                {todo.map((c) => (
                  <TodoCard
                    key={c.id}
                    card={c}
                    featured={c === featured}
                    open={openId === c.id || (c === featured && openId === null)}
                    onOpen={() => setOpenId(c.id)}
                    canLog={data.canLog}
                    date={asOf}
                    userId={userId}
                    onSaved={(entry, wasQueued) => {
                      setQueued((m) => new Map(m).set(c.id, entry))
                      setOpenId(null)
                      showToast(wasQueued ? t('common.queuedOffline') : t('keepers.mine.saved', { unit: c.name }), wasQueued ? 'info' : 'success')
                    }}
                    onError={(msg) => showToast(msg, 'error')}
                  />
                ))}
              </section>
            )}

            {done.length > 0 && (
              <section className="flex flex-col" aria-label={t('keepers.mine.done', { count: done.length })}>
                <h2 className="pb-1 text-xs uppercase tracking-wide text-muted">{t('keepers.mine.done', { count: done.length })}</h2>
                <ul>
                  {done.map((c, i) => (
                    <li key={c.id} className={`flex items-center gap-3 px-1 py-2.5 ${i < done.length - 1 ? 'border-b border-line' : ''}`}>
                      <span className="flex size-[18px] items-center justify-center rounded-pill bg-good/15 text-good" aria-hidden>
                        <Check size={12} strokeWidth={3} />
                      </span>
                      <span className="grow text-[15px] text-text">{c.name}</span>
                      <span className="text-xs text-muted">
                        {[
                          c.logged?.at ? clock(c.logged.at, lang) : t('keepers.mine.waiting'),
                          c.logged ? `${c.logged.feedKg} kg` : null,
                          c.logged?.mortality ? t('keepers.mine.dead', { count: c.logged.mortality }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}

function Ring({ done, total }) {
  const r = 19.5
  const c = 2 * Math.PI * r
  const pct = total ? done / total : 0
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" className="stroke-line-strong" />
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-lime" strokeDasharray={`${c * pct} ${c}`} />
    </svg>
  )
}

function TodoCard({ card, featured, open, onOpen, canLog, date, userId, onSaved, onError }) {
  const t = useT()
  const [feed, setFeed] = useState(card.rationKg != null ? String(card.rationKg) : '')
  const [dead, setDead] = useState('0')
  const [busy, setBusy] = useState(false)
  const meta = [
    card.rationKg != null ? t('keepers.mine.ration', { kg: card.rationKg }) : null,
    card.deadYesterday ? t('keepers.mine.deadYesterday', { count: card.deadYesterday }) : null,
    card.coverFor ? t('keepers.mine.coverFor', { name: card.coverFor }) : null,
  ].filter(Boolean)

  const save = async (e) => {
    e.preventDefault()
    const feedKg = Number(feed || 0)
    const mortality = Math.round(Number(dead || 0))
    if (!(feedKg >= 0) || !(mortality >= 0)) return onError(t('keepers.mine.invalid'))
    if (feedKg > 0 && !card.feedTypeId) return onError(t('keepers.mine.needFeedType'))
    setBusy(true)
    try {
      const payload = {
        date,
        records: [
          {
            cageId: card.id,
            feedAmount: feedKg,
            ...(feedKg > 0 ? { feedTypeId: card.feedTypeId } : {}),
            mortality,
            ...(mortality > 0 ? { mortalityCause: 'unknown' } : {}),
          },
        ],
      }
      const res = await saveOrQueue({ kind: 'daily-batch', payload, summary: `${date} · ${card.name}`, userId })
      if (res.error) throw res.error
      onSaved({ at: res.queued ? null : Date.now(), feedKg, mortality }, !!res.queued)
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`flex flex-col gap-3 rounded-[18px] bg-surface ${featured ? 'border border-line-strong p-4' : 'border border-line px-4 py-3.5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className={`font-semibold text-text ${featured ? 'text-xl leading-6' : 'text-base'}`}>{card.name}</h3>
          {!featured && meta.length > 0 && <span className="text-[13px] text-muted">{meta.join(' · ')}</span>}
        </div>
        {card.sampleDue && <span className="shrink-0 text-xs text-warn">{t('keepers.mine.sampleDue')}</span>}
        {!featured && !open && canLog && (
          <button type="button" onClick={onOpen} className={`shrink-0 rounded-pill border border-line-strong px-4 py-1.5 text-sm font-medium text-text ${FOCUS}`}>
            {t('keepers.mine.log')}
          </button>
        )}
      </div>
      {featured && (
        <dl className="flex flex-wrap gap-[18px]">
          {[
            [t('keepers.mine.rationLabel'), card.rationKg != null ? `${card.rationKg} kg` : '–'],
            [t('keepers.mine.fish'), card.fish != null ? card.fish.toLocaleString() : '–'],
            [t('keepers.mine.yesterday'), card.deadYesterday != null ? t('keepers.mine.dead', { count: card.deadYesterday }) : '–'],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <dt className="text-[11px] text-faint">{k}</dt>
              <dd className="text-[15px] font-semibold text-text">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {open && canLog && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('keepers.mine.feedKg')}
              <input inputMode="decimal" value={feed} onChange={(e) => setFeed(e.target.value)} className="h-11 rounded-md border border-line-strong bg-bg px-3 text-base text-text" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('keepers.mine.deaths')}
              <input inputMode="numeric" value={dead} onChange={(e) => setDead(e.target.value)} className="h-11 rounded-md border border-line-strong bg-bg px-3 text-base text-text" />
            </label>
          </div>
          <div className="flex items-center gap-2.5">
            <LimeButton type="submit" size="lg" className="grow" disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
              {t('keepers.mine.logToday')}
            </LimeButton>
            <Link
              href="/account"
              title={t('keepers.mine.voiceHint')}
              aria-label={t('keepers.mine.voiceHint')}
              className={`flex size-11 shrink-0 items-center justify-center rounded-pill border border-line-strong text-text ${FOCUS}`}
            >
              <Mic size={18} aria-hidden />
            </Link>
          </div>
          <Link href={`/daily-entry?cage=${card.id}&date=${date}`} className="self-start text-xs text-cover hover:underline">
            {t('keepers.mine.fullForm')}
          </Link>
        </form>
      )}
    </article>
  )
}
