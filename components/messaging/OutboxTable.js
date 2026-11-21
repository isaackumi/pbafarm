import { useEffect, useRef, useState } from 'react'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useT, useLocale } from '../../lib/i18n/context'
import { useToast } from '../Toast'
import { errorMessage } from '../../lib/errorMessage'
import { StatusTone } from './ChannelTiles'

/**
 * Paper 57b Outbox (dark U02-1, light UEW-1): every outbound SMS, WhatsApp,
 * Telegram and email message of the organization, newest first, with All /
 * Queued / Failed tabs and a search. Recipients are shown by name and role;
 * addresses only ever arrive masked from messaging.outbox.
 */

const PAGE_SIZE = 10
const FILTERS = ['all', 'queued', 'failed']
const CHANNEL_LABEL = { sms: 'SMS', whatsapp: 'WhatsApp', telegram: 'Telegram' }

function clock(ms, locale) {
  const d = new Date(ms)
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return time
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`
}

function roleLabel(t, row) {
  if (row.roleName) return row.roleName
  if (row.roleKey === 'customer' || row.roleKey === 'supplier') return t(`settingsUi.msg.outboxTable.recipientRole.${row.roleKey}`)
  if (row.roleKey) {
    const key = `settingsUi.team.role.${row.roleKey}`
    const label = t(key)
    return label === key ? row.roleKey : label
  }
  return null
}

function Status({ row, locale, onRetry, busy }) {
  const t = useT()
  if (row.status === 'sent') {
    return (
      <StatusTone tone="green" title={t('settingsUi.msg.outboxTable.deliveredHint')}>
        {t('settingsUi.msg.outboxTable.delivered')}
      </StatusTone>
    )
  }
  if (row.status === 'queued') {
    return (
      <StatusTone tone="sky">
        {row.nextAttemptAt
          ? t('settingsUi.msg.outboxTable.queuedAt', { time: clock(row.nextAttemptAt, locale) })
          : t('settingsUi.msg.outboxTable.queued')}
      </StatusTone>
    )
  }
  if (!row.canRetry) {
    return (
      <StatusTone tone="red" title={row.error || undefined}>
        {t('settingsUi.msg.outboxTable.failed')}
      </StatusTone>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onRetry(row)}
      disabled={busy}
      title={row.error || undefined}
      aria-label={t('settingsUi.msg.outboxTable.retryLabel', { name: row.recipientName || row.toMasked })}
      className="rounded-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
    >
      <StatusTone tone="red">
        {t('settingsUi.msg.outboxTable.failed')} · {t('settingsUi.msg.outboxTable.retry')}
      </StatusTone>
    </button>
  )
}

function Row({ row, locale, onRetry, busy }) {
  const t = useT()
  const name = row.recipientName || row.toMasked
  const role = roleLabel(t, row)
  const sub = [role || (row.recipientName ? row.toMasked : null), clock(row.sentAt ?? row.createdAt, locale)]
    .filter(Boolean)
    .join(' · ')
  const message = row.source === 'code' ? t('settingsUi.msg.outboxTable.code') : row.body || ''
  return (
    <li className="flex items-center gap-6 border-t border-line px-6 py-[14px]">
      <div className="flex w-[170px] shrink-0 flex-col gap-[2px]">
        <span className="truncate text-[14px] leading-[18px] text-text">{name}</span>
        <span className="truncate text-[12px] leading-4 text-muted">{sub}</span>
      </div>
      <span className="w-[90px] shrink-0 text-[13px] leading-4 text-[#C9CDD2] [html[data-theme=light]_&]:text-[#3F444A]">
        {row.channel === 'email' ? t('settingsUi.msg.channelName.email') : CHANNEL_LABEL[row.channel]}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] leading-4 text-muted" title={message}>
        {message}
      </span>
      <div className="flex w-[150px] shrink-0">
        <Status row={row} locale={locale} onRetry={onRetry} busy={busy} />
      </div>
    </li>
  )
}

export default function OutboxTable() {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const fmtLocale = formatLocale || locale || 'en'
  const { showToast } = useToast()
  const [filter, setFilter] = useState('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const retry = useMutation(api.messaging.outbox.retry)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), 250)
    return () => clearTimeout(id)
  }, [text])
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  const searching = searchOpen && debounced.length > 0
  const paged = usePaginatedQuery(api.messaging.outbox.list, searching ? 'skip' : { filter }, {
    initialNumItems: PAGE_SIZE,
  })
  const found = useQuery(api.messaging.outbox.search, searching ? { text: debounced, filter } : 'skip')
  const rows = searching ? found : paged.status === 'LoadingFirstPage' ? undefined : paged.results

  const onRetry = async (row) => {
    setBusy(true)
    try {
      await retry({ messageId: row.id })
      showToast('success', t('settingsUi.msg.outboxTable.retried'))
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="outbox-title"
      className="flex flex-col rounded-card border border-line bg-surface shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-5">
        <div className="flex min-w-0 items-center gap-5">
          <h2 id="outbox-title" className="text-[17px] font-semibold leading-[22px] text-text">
            {t('settingsUi.msg.outboxTable.title')}
          </h2>
          <div role="tablist" aria-label={t('settingsUi.msg.outboxTable.filters')} className="flex gap-4">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`text-[13px] leading-4 focus:outline-none focus-visible:underline ${
                  filter === f ? 'text-text' : 'text-muted hover:text-text'
                }`}
              >
                {t(`settingsUi.msg.outboxTable.filter.${f}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {searchOpen && (
            <input
              ref={inputRef}
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setText('')
                  setSearchOpen(false)
                }
              }}
              placeholder={t('settingsUi.msg.outboxTable.searchPlaceholder')}
              aria-label={t('settingsUi.msg.outboxTable.search')}
              className="h-8 w-56 min-w-0 rounded-pill border border-line bg-transparent px-3 text-[13px] leading-4 text-text placeholder:text-faint focus:border-line-strong focus:outline-none"
            />
          )}
          <button
            type="button"
            onClick={() => {
              if (searchOpen) setText('')
              setSearchOpen((o) => !o)
            }}
            aria-label={searchOpen ? t('settingsUi.msg.outboxTable.closeSearch') : t('settingsUi.msg.outboxTable.search')}
            aria-expanded={searchOpen}
            className="flex shrink-0 items-center justify-center rounded-pill text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div
            className="flex items-center gap-6 px-6 py-3 text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint"
            aria-hidden="true"
          >
            <span className="w-[170px] shrink-0">{t('settingsUi.msg.outboxTable.recipient')}</span>
            <span className="w-[90px] shrink-0">{t('settingsUi.msg.outboxTable.channel')}</span>
            <span className="min-w-0 flex-1">{t('settingsUi.msg.outboxTable.message')}</span>
            <span className="w-[150px] shrink-0">{t('settingsUi.msg.outboxTable.status')}</span>
          </div>
          {rows === undefined ? (
            <p className="border-t border-line px-6 py-[14px] text-[13px] leading-4 text-muted" role="status">
              {t('settingsUi.msg.outboxTable.loading')}
            </p>
          ) : rows.length === 0 ? (
            <p className="border-t border-line px-6 py-[14px] text-[13px] leading-4 text-muted">
              {searching
                ? t('settingsUi.msg.outboxTable.noMatch')
                : t(`settingsUi.msg.outboxTable.empty.${filter}`)}
            </p>
          ) : (
            <ul aria-label={t('settingsUi.msg.outboxTable.title')}>
              {rows.map((row) => (
                <Row key={row.id} row={row} locale={fmtLocale} onRetry={onRetry} busy={busy} />
              ))}
            </ul>
          )}
        </div>
      </div>
      {!searching && paged.status === 'CanLoadMore' && (
        <div className="border-t border-line px-6 py-[14px]">
          <button
            type="button"
            onClick={() => paged.loadMore(PAGE_SIZE)}
            className="text-[13px] leading-4 text-muted hover:text-text focus:outline-none focus-visible:underline"
          >
            {t('settingsUi.msg.outboxTable.more')}
          </button>
        </div>
      )}
    </section>
  )
}
