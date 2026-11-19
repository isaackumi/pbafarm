import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '../../contexts/AuthContext'
import QueryBoundary from '../QueryBoundary'
import { AppShellSkeleton, Button, Card } from '../ui'

const NAV = [
  { href: '/platform', label: 'Overview' },
  { href: '/platform/tenants', label: 'Tenants' },
  { href: '/platform/billing', label: 'Billing' },
  { href: '/platform/usage', label: 'Usage & cost' },
  { href: '/platform/audit', label: 'Audit log' },
  { href: '/platform/admins', label: 'Platform admins' },
]

function isActive(pathname, href) {
  return href === '/platform' ? pathname === '/platform' : pathname.startsWith(href)
}

/**
 * Shell for the platform console (console.heitechinc.com, PLAT-101). The
 * client check only picks what to draw: every console query and mutation
 * requires a platform admin with a verified two-step session on the server
 * (convex/platform/access.ts). No redirect to /dashboard: on the console
 * host that path bounces back here.
 */
export default function PlatformLayout({ title, children, actions }) {
  const router = useRouter()
  const { user, loading, initialized, signOut } = useAuth()

  if (loading || !initialized) return <AppShellSkeleton />

  const fullTitle = `${title ? `${title} · ` : ''}Platform console`

  if (!user || user.role !== 'super_admin') {
    return (
      <div className="min-h-screen bg-foam flex items-center justify-center p-6">
        <Head>
          <title>{fullTitle}</title>
        </Head>
        <Card className="max-w-md w-full">
          <h1 className="font-display text-xl font-medium text-chart-ink">Platform console</h1>
          <p className="text-sm text-muted mt-2">
            This console is for platform administrators. Sign in with a platform admin account.
          </p>
          <div className="mt-5 flex gap-2">
            {user ? (
              <Button variant="secondary" onClick={() => signOut()}>
                Sign out
              </Button>
            ) : (
              <Button href="/login?next=/platform">Sign in</Button>
            )}
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-foam">
      <Head>
        <title>{fullTitle}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <header className="bg-chart-ink text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
          <Link href="/platform" className="font-display text-lg font-medium">
            pbafarm · Platform
          </Link>
          <nav aria-label="Platform console" className="flex flex-wrap gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(router.pathname, item.href) ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  isActive(router.pathname, item.href) ? 'bg-white/15' : 'hover:bg-white/10'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="opacity-80 hidden sm:inline">{user.email}</span>
            <button type="button" className="underline opacity-90 hover:opacity-100" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <h1 className="font-display text-2xl font-medium text-chart-ink">{title}</h1>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        <QueryBoundary title="Could not load this console page" resetKey={router.asPath}>
          {children}
        </QueryBoundary>
      </main>
    </div>
  )
}

export function StatusPill({ status }) {
  const tone = {
    active: 'bg-kelp/10 text-kelp',
    approved: 'bg-kelp/10 text-kelp',
    trialing: 'bg-lake/10 text-lake',
    pending: 'bg-lake/10 text-lake',
    past_due: 'bg-signal/10 text-signal',
    open: 'bg-signal/10 text-signal',
    suspended: 'bg-red-100 text-red-700',
    uncollectible: 'bg-red-100 text-red-700',
    paid: 'bg-kelp/10 text-kelp',
  }[status] || 'bg-foam-deep text-muted'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {String(status || 'none').replace(/_/g, ' ')}
    </span>
  )
}

/** Plain table used across console pages. */
export function SimpleTable({ columns, rows, empty = 'Nothing to show', rowKey = (r) => r.id }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-muted py-4">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted border-b border-foam-deep">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`py-2 pr-4 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-foam-deep/60 last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={`py-2 pr-4 align-top ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
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
