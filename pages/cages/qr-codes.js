import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Printer } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button, EmptyState } from '../../components/ui'
import { cageService } from '../../lib/cageService'

/**
 * Printable QR stickers, one per cage. Scanning a sticker opens daily entry
 * with that cage already on a line.
 */
export default function CageQrCodes() {
  const [cages, setCages] = useState([])
  const [codes, setCodes] = useState({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await cageService.getAllCages()
      const list = (data || []).filter((c) => c.status !== 'inactive')
      const origin = window.location.origin
      const entries = await Promise.all(
        list.map(async (c) => {
          const id = c.id || c._id
          const url = `${origin}/daily-entry?cage=${encodeURIComponent(id)}`
          const svg = await QRCode.toString(url, {
            type: 'svg',
            margin: 1,
            errorCorrectionLevel: 'M',
            color: { dark: '#18181b', light: '#ffffff' },
          })
          return [id, svg]
        }),
      )
      if (cancelled) return
      setCages(list)
      setCodes(Object.fromEntries(entries))
      setReady(true)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ProtectedRoute>
      <Layout title="Cage QR codes">
        <div className="print:hidden">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Cages', href: '/cages' },
              { label: 'QR codes' },
            ]}
            description="Print these and fix one to each cage. Scanning a code opens daily entry with that cage filled in."
            actions={
              <Button onClick={() => window.print()} disabled={!cages.length}>
                <Printer size={16} aria-hidden />
                Print
              </Button>
            }
          />
        </div>

        {!ready ? (
          <p className="text-sm text-muted">Loading cages…</p>
        ) : cages.length === 0 ? (
          <EmptyState
            title="No cages yet"
            description="Create a cage first, then come back to print its code."
            action={<Button href="/create-cage">Create a cage</Button>}
          />
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 print:grid-cols-3 print:gap-6">
            {cages.map((c) => {
              const id = c.id || c._id
              return (
                <li
                  key={id}
                  className="rounded-xl border border-foam-deep bg-white p-4 text-center break-inside-avoid"
                >
                  <div
                    className="mx-auto w-full max-w-[10rem] [&>svg]:h-auto [&>svg]:w-full"
                    // qrcode returns a self-contained SVG string
                    dangerouslySetInnerHTML={{ __html: codes[id] || '' }}
                  />
                  <p className="mt-3 text-base font-medium text-[#18181b]">{c.name}</p>
                  {c.code && <p className="text-xs text-[#52525b]">{c.code}</p>}
                  <p className="mt-1 text-xs text-[#52525b]">Scan to log feed</p>
                </li>
              )
            })}
          </ul>
        )}
      </Layout>
    </ProtectedRoute>
  )
}
