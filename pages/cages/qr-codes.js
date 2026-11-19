import { useEffect, useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import QRCode from 'qrcode'
import { Printer } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import {
  PageHeader,
  Button,
  EmptyState,
  LoadingState,
} from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useLocation } from '../../contexts/LocationContext'
import { labelUrl, shortCodeFor } from '../../lib/qrTarget'

/**
 * Printable QR stickers, one per cage. Scanning a sticker opens daily entry
 * with that cage already on a line.
 */
export default function CageQrCodes() {
  return (
    <ProtectedRoute>
      <Layout title="Cage QR codes">
        <CageQrSheet />
      </Layout>
    </ProtectedRoute>
  )
}

function CageQrSheet() {
  const { locationArgs } = useLocation()
  const allCages = useQuery(api.cages.list, locationArgs)
  const cages = useMemo(
    () => (allCages ? allCages.filter((c) => c.status !== 'inactive') : null),
    [allCages],
  )
  const [codes, setCodes] = useState({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!cages) return
    let cancelled = false
    async function render() {
      const origin = window.location.origin
      const entries = await Promise.all(
        cages.map(async (c) => {
          const id = c.id || c._id
          const url = labelUrl(origin, c, cages)
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
      setCodes(Object.fromEntries(entries))
      setReady(true)
    }
    render()
    return () => {
      cancelled = true
    }
  }, [cages])

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Cages', href: '/cages' },
            { label: 'QR codes' },
          ]}
          description="Print these and fix one to each cage. Scanning a code opens daily entry with that cage filled in. Codes stay valid if the app moves to a new address; labels printed earlier keep working."
          actions={
            <Button onClick={() => window.print()} disabled={!cages?.length}>
              <Printer size={16} aria-hidden />
              Print
            </Button>
          }
        />
      </div>

      {!ready ? (
        <LoadingState label="Loading cages…" />
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
                <p className="mt-3 text-base font-medium text-[#18181b]">
                  {c.name}
                </p>
                <p className="text-sm font-mono font-semibold text-[#18181b]">
                  {shortCodeFor(c, cages)}
                </p>
                <p className="mt-1 text-xs text-[#52525b]">Scan to log feed</p>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
