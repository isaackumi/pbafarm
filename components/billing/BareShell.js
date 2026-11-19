import Head from 'next/head'
import Link from 'next/link'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Minimal page frame for a suspended organization: the app shell's queries
 * are refused while suspended, so these pages use none of them.
 */
export default function BareShell({ title, children }) {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen bg-foam">
      <Head>
        <title>{title} · PBA Farm</title>
      </Head>
      <header className="border-b border-foam-deep bg-surface">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4 text-sm">
          <span className="font-display text-lg">PBA Farm</span>
          <Link href="/suspended" className="hover:underline">Status</Link>
          <Link href="/billing" className="hover:underline">Billing</Link>
          <button type="button" className="ml-auto underline" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="font-display text-2xl font-medium mb-6">{title}</h1>
        {children}
      </main>
    </div>
  )
}
