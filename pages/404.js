import Link from 'next/link'
import { Fish } from 'lucide-react'

export default function Custom404() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-foam px-4">
      <Fish className="h-10 w-10 text-kelp mb-4" aria-hidden />
      <p className="font-display text-3xl text-lagoon-950 tracking-tight">PBA Farm</p>
      <div className="waterline mt-3 mb-6 max-w-[6rem] w-full" />
      <h1 className="page-title mb-2">Page not found</h1>
      <p className="page-subtitle mb-8 text-center max-w-sm">
        That route doesn’t exist. Head back to the dashboard to keep working.
      </p>
      <Link href="/dashboard" className="btn-primary">
        Back to dashboard
      </Link>
    </div>
  )
}
