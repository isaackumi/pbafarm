import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '../../contexts/AuthContext'
import { useT } from '../../lib/i18n/context'
import { AnowaLockup } from '../brand/AnowaLogo'

const LINK =
  'rounded-pill px-3 py-[6px] text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

/**
 * Minimal page frame for a suspended organization: the app shell's queries
 * are refused while suspended, so these pages use none of them.
 * `centered` drops the page title and centres the content (Paper 46).
 */
export default function BareShell({ title, children, centered = false }) {
  const t = useT()
  const { signOut } = useAuth()
  const { pathname } = useRouter()
  const link = (href, label) => (
    <Link
      href={href}
      aria-current={pathname === href ? 'page' : undefined}
      className={`${LINK} ${pathname === href ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`}
    >
      {label}
    </Link>
  )
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <Head>
        <title>{`${title} · Anowa`}</title>
      </Head>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <AnowaLockup height={22} className="mr-4" />
          {link('/suspended', t('suspended.navStatus'))}
          {link('/billing', t('suspended.navBilling'))}
          <button type="button" className={`${LINK} ml-auto text-muted hover:text-text`} onClick={() => signOut()}>
            {t('suspended.signOut')}
          </button>
        </div>
      </header>
      {centered ? (
        <main className="flex flex-1 items-center justify-center px-4 py-10">{children}</main>
      ) : (
        <main className="mx-auto w-full max-w-5xl px-4 py-8">
          <h1 className="mb-6 text-[30px] font-semibold leading-9 tracking-[-0.02em] text-text">{title}</h1>
          {children}
        </main>
      )}
    </div>
  )
}
