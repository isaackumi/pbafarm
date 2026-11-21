import Link from 'next/link'
import { useT, useLocale } from '../../lib/i18n/context'

/**
 * Paper 57b channel tiles (dark U02-1, light UEW-1): SMS, WhatsApp, Telegram
 * and Email in a 2 × 2 grid, each with its status pill, sender line and a
 * usage meter for the current month. Values come from
 * messaging.channels.overview and messaging.outbox.usage.
 */

/** Pill tones exactly as drawn: dark border / text, then light. */
const PILL = {
  green: 'border-[#2E5A3E] text-[#86EFAC] [html[data-theme=light]_&]:border-[#BBE5C8] [html[data-theme=light]_&]:text-[#15803D]',
  amber: 'border-[#5E4A1E] text-[#FBBF24] [html[data-theme=light]_&]:border-[#F3D9A4] [html[data-theme=light]_&]:text-[#B45309]',
  sky: 'border-[#1F3E6E] text-[#6AA8F5] [html[data-theme=light]_&]:border-[#B9D3F5] [html[data-theme=light]_&]:text-[#1562D6]',
  red: 'border-[#6B3A3A] text-[#F87171] [html[data-theme=light]_&]:border-[#F5C2C2] [html[data-theme=light]_&]:text-[#DC2626]',
  neutral: 'border-line-strong text-[#C4C8CD] [html[data-theme=light]_&]:border-[#CBD6E3] [html[data-theme=light]_&]:text-[#3F444A]',
}

export function StatusTone({ tone, size = 'md', children, title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-pill border py-1 text-[12px] leading-4 ${
        size === 'sm' ? 'px-[10px]' : 'px-3'
      } ${PILL[tone] || PILL.neutral}`}
    >
      {children}
    </span>
  )
}

/** Meter fills: sky #6AA8F5 / light #3D86E6; amber #FBBF24 / light #D97706. */
const FILL = {
  sky: 'bg-[#6AA8F5] [html[data-theme=light]_&]:bg-[#3D86E6]',
  amber: 'bg-[#FBBF24] [html[data-theme=light]_&]:bg-[#D97706]',
  red: 'bg-[#F87171] [html[data-theme=light]_&]:bg-[#DC2626]',
}

function Meter({ label, used, total, suffix, locale, budget = true }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  // Amber from 75 % of the budget, red when it is used up (Paper: WhatsApp at 81 %).
  const tone = !budget ? 'sky' : pct >= 100 ? 'red' : pct >= 75 ? 'amber' : 'sky'
  const fmt = (n) => n.toLocaleString(locale)
  const value = `${fmt(used)} / ${fmt(total)}${suffix ? ` ${suffix}` : ''}`
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex justify-between gap-2">
        <span className="text-[12px] leading-4 text-muted">{label}</span>
        <span className="text-[12px] leading-4 text-text">{value}</span>
      </div>
      <div
        className="flex h-1 shrink-0 rounded-pill bg-line"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        aria-valuetext={value}
      >
        <div className={`h-1 rounded-pill ${FILL[tone]}`} style={{ width: `${Math.round(pct)}%` }} />
      </div>
    </div>
  )
}

function Tile({ href, title, pill, line1, line2, meter }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold leading-[18px] text-text">{title}</span>
        {pill}
      </div>
      <div className="flex min-w-0 flex-col gap-[2px]">
        <span className="text-[13px] leading-4 text-muted">{line1}</span>
        {line2 ? (
          <span className="truncate font-geist text-[14px] leading-[18px] text-text">{line2}</span>
        ) : null}
      </div>
      {meter}
    </>
  )
  const cls =
    'flex min-w-0 flex-col gap-[14px] rounded-card border border-line bg-surface px-6 py-[22px] shadow-[var(--shadow-card)] hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
  return href.startsWith('#') ? (
    <a href={href} className={cls}>
      {body}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {body}
    </Link>
  )
}

/** Paper 57b first line: "Hubtel · sender ID", "Business number · …", "From address". */
function senderLine(t, spec, provider, platformOn) {
  if (spec === 'email') return t('settingsUi.msg.tile.fromAddress')
  if (spec === 'whatsapp') {
    const via = provider ? provider.label : platformOn ? t('settingsUi.msg.tile.anowaBot') : null
    return via ? t('settingsUi.msg.tile.businessNumber', { via }) : t('settingsUi.msg.channel.whatsapp')
  }
  return provider ? t('settingsUi.msg.tile.senderId', { provider: provider.label }) : t('settingsUi.msg.channel.sms')
}

function companyPill(t, spec, row, platformOn) {
  if (row) {
    if (row.status === 'verified') return <StatusTone tone="green" size="sm">{t('settingsUi.msg.tile.connected')}</StatusTone>
    if (row.status === 'disabled') return <StatusTone tone="red" size="sm">{t('settingsUi.msg.status.disabled')}</StatusTone>
    return (
      <StatusTone tone="amber" size="sm">
        {spec === 'email' ? t('settingsUi.msg.tile.verifyDomain') : t('settingsUi.msg.status.draft')}
      </StatusTone>
    )
  }
  return platformOn ? (
    <StatusTone tone="sky" size="sm">{t('settingsUi.msg.platformChannel')}</StatusTone>
  ) : (
    <StatusTone tone="neutral" size="sm">{t('settingsUi.msg.notConfigured')}</StatusTone>
  )
}

/** Short month name for "Nov usage" in the current language. */
function monthName(period, locale) {
  const [y, m] = period.split('-').map(Number)
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1))
  } catch {
    return period
  }
}

export default function ChannelTiles({ data, usage, byChannel }) {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const fmtLocale = formatLocale || locale || 'en'
  const month = usage ? monthName(usage.period, fmtLocale) : ''
  const tile = (spec, title, meterLabel, key) => {
    const row = byChannel[spec]
    const provider = data.providers.find((p) => p.id === row?.provider)
    const platformOn = !row && data.platform?.[spec]?.available && data.platform[spec].enabled
    const m = usage?.[key]
    return (
      <Tile
        key={spec}
        href={`#${spec}`}
        title={title}
        pill={companyPill(t, spec, row, platformOn)}
        line1={senderLine(t, spec, provider, platformOn)}
        line2={row?.senderId || null}
        meter={m ? <Meter label={meterLabel} used={m.used} total={m.budget} locale={fmtLocale} /> : null}
      />
    )
  }
  const tg = usage?.telegram
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {tile('sms', 'SMS', t('settingsUi.msg.tile.monthUsage', { month }), 'sms')}
      {tile('whatsapp', 'WhatsApp', t('settingsUi.msg.tile.conversations'), 'whatsapp')}
      <Tile
        href="/account#chat-channels-title"
        title="Telegram"
        pill={
          tg?.configured ? (
            <StatusTone tone="green" size="sm">{t('settingsUi.msg.tile.connected')}</StatusTone>
          ) : (
            <StatusTone tone="neutral" size="sm">{t('settingsUi.msg.notConfigured')}</StatusTone>
          )
        }
        line1={t('settingsUi.msg.tile.telegramLine')}
        line2={tg?.botUsername ? `@${tg.botUsername}` : null}
        meter={
          tg ? (
            <Meter
              label={t('settingsUi.msg.tile.peopleLinked')}
              used={tg.linked}
              total={tg.members}
              suffix={t('settingsUi.msg.tile.members')}
              locale={fmtLocale}
              budget={false}
            />
          ) : null
        }
      />
      {tile('email', t('settingsUi.msg.channelName.email'), t('settingsUi.msg.tile.monthUsage', { month }), 'email')}
    </div>
  )
}
