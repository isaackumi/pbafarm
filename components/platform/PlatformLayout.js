import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '../../contexts/AuthContext'
import { useT } from '../../lib/i18n/context'
import { AnowaLockup } from '../brand/AnowaLogo'
import QueryBoundary from '../QueryBoundary'
import { AppShellSkeleton, Badge, GhostButton, SolidButton } from '../ui'

/**
 * Console navigation (Paper 40). "Plans" opens the plans tab of the billing
 * page; there is no console page for bot & messaging yet, so it is omitted.
 */
const NAV = [
  { href: '/platform', key: 'overview' },
  { href: '/platform/tenants', key: 'tenants' },
  { href: '/platform/billing?tab=invoices', key: 'billing' },
  { href: '/platform/billing?tab=plans', key: 'plans' },
  { href: '/platform/usage', key: 'usage' },
  { href: '/platform/audit', key: 'audit' },
  { href: '/platform/admins', key: 'staff' },
]

/**
 * Paper 40 console KPI strip: 11px muted caps label, 34/42 value, 8px gap.
 * KpiStrip's home sizes (12px faint, 26/32) are overridden here only.
 */
export const CONSOLE_KPI =
  'border-y border-line !px-0 py-[22px] [&>div]:gap-2 [&>div>div:first-child]:text-[11px] [&>div>div:first-child]:leading-[14px] [&>div>div:first-child]:tracking-[0.08em] [&>div>div:first-child]:text-muted [&>div>div:last-child]:text-[34px] [&>div>div:last-child]:leading-[42px]'
/** Paper 40 tenant table: 16px radius, 20px side padding, 16px toolbar padding. */
export const CONSOLE_TABLE =
  '!rounded-[16px] [&>div:first-child]:!px-5 [&>div:first-child]:!py-4 [&_th:first-child]:!pl-5 [&_td:first-child]:!pl-5 [&_th:last-child]:!pr-5 [&_td:last-child]:!pr-5'

function isActive(router, href) {
  const [path, query] = href.split('?')
  if (path === '/platform') return router.pathname === '/platform'
  if (!router.pathname.startsWith(path)) return false
  if (path === '/platform/billing') return (router.query?.tab === 'plans') === (query === 'tab=plans')
  return true
}

/**
 * Shell for the platform console (console.getanowa.com, PLAT-101). The
 * client check only picks what to draw: every console query and mutation
 * requires a platform admin with a verified two-step session on the server
 * (convex/platform/access.ts). No redirect to /dashboard: on the console
 * host that path bounces back here.
 */
export default function PlatformLayout({ title, eyebrow, children, actions, hideHeader = false }) {
  const router = useRouter()
  const t = useT()
  const { user, loading, initialized, signOut } = useAuth()

  if (loading || !initialized) return <AppShellSkeleton />

  const fullTitle = `${title ? `${title} · ` : ''}${t('platform.consoleTitle')}`

  if (!user || user.role !== 'super_admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <Head>
          <title>{fullTitle}</title>
          <meta name="robots" content="noindex,nofollow" />
        </Head>
        <div className="w-full max-w-md rounded-card border border-line bg-surface p-8">
          <Brand />
          <h1 className="mt-6 text-[22px] font-semibold leading-7 tracking-[-0.02em] text-text">{t('platform.consoleTitle')}</h1>
          <p className="mt-2 text-sm leading-5 text-muted">{t('platform.adminsOnly')}</p>
          <div className="mt-6 flex gap-2">
            {user ? (
              <GhostButton size="lg" onClick={() => signOut()}>
                {t('platform.signOut')}
              </GhostButton>
            ) : (
              <SolidButton href="/login?next=/platform">{t('platform.signIn')}</SolidButton>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text md:flex-row">
      <Head>
        <title>{fullTitle}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <aside className="flex shrink-0 flex-col gap-5 border-b border-line px-4 py-5 md:sticky md:top-0 md:h-screen md:w-[232px] md:gap-7 md:border-b-0 md:border-r md:py-6">
        <Link href="/platform" className="rounded-[10px] px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
          <Brand />
        </Link>
        <nav aria-label={t('platform.navLabel')} className="flex gap-[2px] overflow-x-auto md:flex-col">
          {NAV.map((item) => {
            const active = isActive(router, item.href)
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-[38px] shrink-0 items-center whitespace-nowrap rounded-[10px] px-3 text-[14px] leading-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                  active ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:bg-surface-2 hover:text-text'
                }`}
              >
                {t(`platform.nav.${item.key}`)}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto hidden flex-col gap-2 px-2 md:flex">
          <span className="truncate text-xs leading-4 text-faint" title={user.email}>
            {user.email}
          </span>
          <button
            type="button"
            className="self-start rounded text-sm leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            onClick={() => signOut()}
          >
            {t('platform.signOut')}
          </button>
        </div>
      </aside>
      <main className="flex min-w-0 grow flex-col gap-8 px-4 py-6 sm:px-6 md:px-[44px] md:py-9">
        {hideHeader ? null : <ConsoleHeader eyebrow={eyebrow ?? t('platform.eyebrow')} title={title} actions={actions} />}
        <QueryBoundary title={t('platform.loadError')} resetKey={router.asPath}>
          {children}
        </QueryBoundary>
        <button
          type="button"
          className="self-start rounded text-sm text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan md:hidden"
          onClick={() => signOut()}
        >
          {t('platform.signOut')}
        </button>
      </main>
    </div>
  )
}

/** Page header: muted eyebrow, 30px title, actions on the right (Paper 40/44). */
export function ConsoleHeader({ eyebrow, title, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-[6px]">
        {eyebrow ? <div className="text-sm leading-4 text-muted">{eyebrow}</div> : null}
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.02em] text-text">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-[10px]">{actions}</div> : null}
    </div>
  )
}

function Brand() {
  return (
    <span className="flex flex-col gap-[6px]">
      <AnowaLockup height={22} />
      <span className="text-[11px] leading-[14px] tracking-[0.12em] text-pearl-cyan">PLATFORM CONSOLE</span>
    </span>
  )
}

const STATUS_TONE = {
  active: 'good',
  approved: 'good',
  paid: 'good',
  ready: 'good',
  succeeded: 'good',
  trialing: 'cyan',
  pending: 'cyan',
  running: 'cyan',
  past_due: 'warn',
  open: 'warn',
  suspended: 'alert',
  uncollectible: 'alert',
  failed: 'alert',
  rejected: 'alert',
}

/** Filled status badge; the text always names the status (colour is never the only signal). */
export function StatusPill({ status }) {
  return <Badge tone={STATUS_TONE[status] || 'neutral'}>{String(status || 'none').replace(/_/g, ' ')}</Badge>
}

/** Card-panel section used across console pages (Paper 44 cards). */
export function ConsolePanel({ title, action, children, className = '', bodyClassName = 'p-5' }) {
  return (
    <section className={`flex flex-col rounded-[12px] border border-line bg-surface ${className}`}>
      {title || action ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          {title ? <h2 className="text-base font-semibold leading-[18px] text-text">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/** Plain table used across console pages, styled like ui/Table (11px caps headers, hairline rows). */
export function SimpleTable({ columns, rows, empty = 'Nothing to show', rowKey = (r) => r.id }) {
  if (!rows || rows.length === 0) return <p className="py-4 text-sm text-muted">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`py-[10px] pr-4 text-[11px] font-normal uppercase leading-[14px] tracking-[0.08em] text-faint ${c.align === 'right' ? 'text-right' : ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-t border-line">
              {columns.map((c) => (
                <td key={c.key} className={`py-3 pr-4 align-top leading-4 text-text ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
