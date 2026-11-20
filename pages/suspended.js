import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import BareShell from '../components/billing/BareShell'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { balanceDue } from '../lib/billingBalance'
import { formatMinor } from '../lib/billingFormat'
import { useT } from '../lib/i18n/context'
import { BRAND } from '../lib/brand'

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || BRAND.email

/**
 * Where members of a suspended organization land (PLAT-104, Paper 46).
 * Billing (org.settings.manage, readable while suspended) tells us the name
 * and what is owed; other members cannot read it, so they see the note
 * to contact their owner instead of the pay button.
 */
export default function SuspendedPage() {
  const t = useT()
  const { accessState, user } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (user && accessState === 'ok') router.replace('/dashboard')
  }, [user, accessState, router])
  const billing = useOptionalQuery(api.billing.tenant.myBilling, user ? {} : 'skip', null)
  const isOwner = Boolean(billing)
  const due = balanceDue(billing?.invoices)
  const open = (billing?.invoices || []).filter((i) => i.status === 'open')

  return (
    <BareShell title={t('suspended.title')} centered>
      <section
        aria-labelledby="suspended-title"
        className="flex w-full max-w-[520px] flex-col gap-[18px] rounded-card border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-9"
      >
        <div className="flex size-11 items-center justify-center rounded-[12px] bg-[color-mix(in_oklab,var(--warn)_12%,transparent)]">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="text-warn">
            <path
              d="M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="flex flex-col gap-2">
          <h1 id="suspended-title" className="text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-text">
            {billing?.companyName ? t('suspended.heading', { org: billing.companyName }) : t('suspended.headingGeneric')}
          </h1>
          <p className="text-[14px] leading-[21px] text-muted">{due.length > 0 ? t('suspended.bodyPastDue') : t('suspended.body')}</p>
          {billing?.suspensionReason ? <p className="text-[14px] leading-[21px] text-muted">{billing.suspensionReason}</p> : null}
        </div>
        {isOwner && due.length > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-4 py-[14px]">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] leading-4 text-muted">{t('suspended.balanceDue')}</span>
              {open.length > 1 ? <span className="text-xs leading-4 text-faint">{t('suspended.openInvoices', { count: open.length })}</span> : null}
            </div>
            <span className="text-[13px] font-semibold leading-4 tabular-nums text-text">
              {due.map(([currency, minor]) => formatMinor(minor, currency)).join(' + ')}
              {open.length === 1 ? ` · ${open[0].number}` : ''}
            </span>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-[10px]">
          {/* Plain links: permission-aware buttons hide while the app's permission query is paused. */}
          {isOwner ? (
            <Link
              href="/billing"
              className="inline-flex shrink-0 rounded-pill bg-lime p-[1.5px] hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <span className="whitespace-nowrap rounded-pill bg-lime px-5 py-[10px] text-[14px] font-semibold leading-[18px] text-ink">
                {t('suspended.pay')}
              </span>
            </Link>
          ) : null}
          {SUPPORT_EMAIL ? (
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex shrink-0 whitespace-nowrap rounded-pill border border-line-strong px-5 py-[11px] text-[14px] leading-[18px] text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {t('suspended.contactSupport')}
            </a>
          ) : null}
        </div>
        <p className="text-xs leading-4 text-faint">{isOwner ? t('suspended.ownerNote') : t('suspended.notOwner')}</p>
      </section>
    </BareShell>
  )
}
