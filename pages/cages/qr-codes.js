import { useEffect, useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import QRCode from 'qrcode'
import { Printer } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { EmptyState, GradientButton, LoadingState } from '../../components/ui'
import FarmSetupNav from '../../components/units/FarmSetupNav'
import { useT } from '../../lib/i18n/context'
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
      <CageQrSheet />
    </ProtectedRoute>
  )
}

function CageQrSheet() {
  const t = useT()
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
    <Layout
      title={t('qrUi.title')}
      eyebrow={t('qrUi.eyebrow')}
      actions={
        <GradientButton icon={Printer} onClick={() => window.print()} disabled={!cages?.length}>
          {t('qrUi.print')}
        </GradientButton>
      }
    >
      <div className="flex flex-col gap-8 md:flex-row">
        <FarmSetupNav className="print:hidden" />
        <div className="flex min-w-0 grow flex-col gap-5">
          <p className="max-w-2xl text-[14px] leading-[20px] text-muted print:hidden">{t('qrUi.help')}</p>
          {!ready ? (
            <LoadingState label={t('qrUi.loading')} />
          ) : cages.length === 0 ? (
            <EmptyState
              title={t('qrUi.emptyTitle')}
              description={t('qrUi.emptyDescription')}
              action={<GradientButton href="/create-cage">{t('qrUi.create')}</GradientButton>}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 print:grid-cols-3 print:gap-6">
              {cages.map((c) => {
                const id = c.id || c._id
                return (
                  // Printed labels stay black on white in both themes so they scan.
                  <li
                    key={id}
                    className="break-inside-avoid rounded-card border border-line bg-white p-5 text-center text-black shadow-[var(--shadow-card)]"
                  >
                    <div
                      className="mx-auto w-full max-w-[10rem] [&>svg]:h-auto [&>svg]:w-full"
                      // qrcode returns a self-contained SVG string
                      dangerouslySetInnerHTML={{ __html: codes[id] || '' }}
                    />
                    <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500">
                      {t('qrUi.cage')} · <span className="font-mono">{shortCodeFor(c, cages)}</span>
                    </p>
                    <p className="text-[20px] font-semibold leading-6 tracking-[-0.01em]">{c.name}</p>
                    <p className="mt-1 text-xs text-neutral-600">{t('qrUi.scanTo')}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Layout>
  )
}
