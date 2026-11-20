import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '../Layout'
import { GhostButton, GradientButton } from '../ui'
import { SettingsCard, SettingsFrame, useSettingsEyebrow } from '../settings'
import { useLocale, useT } from '../../lib/i18n/context'
import { useTabbedPage } from '../nav/tabbedContext'

/**
 * Shared chrome for the integration routes (Paper 56 Integrations FIL-0):
 * /api-keys is the overview; webhooks, inbound webhooks and the API docs are
 * sibling pages reached through the underline links.
 */
const LINKS = [
  { href: '/api-keys', key: 'keys' },
  { href: '/webhooks', key: 'outbound' },
  { href: '/inbound-webhooks', key: 'inbound' },
  { href: '/api-docs', key: 'docs' },
]

export function IntegrationsNav() {
  const t = useT()
  const tabbed = useTabbedPage()
  const { pathname } = useRouter()
  // Shown as tabs of "API keys + webhooks" (Paper 71b): those tabs replace these links.
  if (tabbed) return null
  return (
    <nav aria-label={t('settingsUi.integ.navLabel')} className="mb-5 flex flex-wrap gap-x-7 border-b border-line">
      {LINKS.map((l) => {
        const on = pathname === l.href
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={on ? 'page' : undefined}
            className={`-mb-px rounded-t-sm border-b-2 pb-3 text-[14px] leading-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              on ? 'border-button font-medium text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t(`settingsUi.integ.nav.${l.key}`)}
          </Link>
        )
      })}
    </nav>
  )
}

/** Layout + settings sub-nav + integration links. */
export function IntegrationsShell({ title, actions, children }) {
  const t = useT()
  const eyebrow = useSettingsEyebrow(t('settingsUi.integ.crumb'))
  return (
    <Layout title={title} eyebrow={eyebrow} actions={actions}>
      <SettingsFrame active="api-keys">
        <IntegrationsNav />
        <div className="flex flex-col gap-5">{children}</div>
      </SettingsFrame>
    </Layout>
  )
}

/** A secret shown once after it is created or rotated. */
export function SecretOnce({ title, hint, secret, copyLabel, onCopy, onDone }) {
  const t = useT()
  return (
    <SettingsCard title={title} role="status" style={{ borderColor: 'var(--sky-ink)' }}>
      <p className="mb-3 text-[13px] leading-4 text-muted">{hint}</p>
      <code className="block select-all break-all rounded-input border border-line-strong bg-bg px-[14px] py-3 font-mono text-[13px] leading-[18px] text-text">
        {secret}
      </code>
      <div className="mt-4 flex flex-wrap gap-2">
        <GradientButton size="sm" ring="sky" onClick={onCopy}>
          {copyLabel}
        </GradientButton>
        <GhostButton onClick={onDone}>{t('integ.common.stored')}</GhostButton>
      </div>
    </SettingsCard>
  )
}

/** Checkbox tile used for scopes, sites and event types. */
export function CheckTile({ id, checked, onChange, label, sub }) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-input border px-[14px] py-2.5 text-[14px] leading-[18px] text-text focus-within:ring-2 focus-within:ring-cyan sm:min-h-10 ${
        checked ? 'border-cyan bg-surface-2' : 'border-line hover:bg-surface-2'
      }`}
    >
      <input id={id} type="checkbox" checked={checked} onChange={onChange} className="size-4 shrink-0 accent-[var(--cyan)]" />
      <span className="min-w-0">
        {label}
        {sub && <span className="block truncate font-mono text-[12px] leading-4 text-muted">{sub}</span>}
      </span>
    </label>
  )
}

export function formatTime(ms, fallback = '—') {
  if (!ms) return fallback
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return fallback
  }
}

const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
]

/** "12 min ago" in the current language. */
export function useRelativeTime() {
  const { formatLocale, locale } = useLocale()
  let rtf
  try {
    rtf = new Intl.RelativeTimeFormat(formatLocale || locale || 'en', { numeric: 'auto', style: 'short' })
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })
  }
  return (ms, now = Date.now()) => {
    if (!ms) return null
    const diff = ms - now
    for (const [unit, size] of UNITS) {
      if (Math.abs(diff) >= size || unit === 'second') return rtf.format(Math.round(diff / size), unit)
    }
    return null
  }
}

/** Scope pill tone for `TonePill` (Paper 56): writes lime, reads sky. */
export function scopeTone(scope) {
  return /:(write|manage|create)$/.test(scope) ? 'lime' : 'sky'
}
