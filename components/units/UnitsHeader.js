import { Plus } from 'lucide-react'
import { GradientButton } from '../ui'
import { usePermissions } from '../../hooks/usePermission'
import { useT } from '../../lib/i18n/context'
import { useLocation } from '../../contexts/LocationContext'

const IDLE = new Set(['fallow', 'empty', 'harvested'])

/** Paper 02 "QR codes" glyph: three finder squares and a corner path (not lucide's QrCode). */
export function PaperQrIcon({ size = 16, strokeWidth = 2, className = '', ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" className={className} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M21 14v7h-7" />
    </svg>
  )
}

/** Header actions shared by the board, table, map and groups views (Paper 02). */
export function UnitsHeaderActions() {
  const t = useT()
  const { can } = usePermissions()
  return (
    <>
      {can('production.units.manage') && (
        <GradientButton href="/create-cage" variant="lime" icon={Plus}>
          {t('unitsUi.newCage')}
        </GradientButton>
      )}
      <GradientButton href="/cages/qr-codes" ring="sky" icon={PaperQrIcon}>
        {t('unitsUi.qrCodes')}
      </GradientButton>
    </>
  )
}

/** Eyebrow for the cage views from api.units.board (Paper 02): "38 active · 6 fallow · Akosombo site". */
export function useUnitsEyebrow(data) {
  const t = useT()
  const { activeLocation } = useLocation()
  if (!data) return undefined
  const idle = data.sections.flatMap((s) => s.units).filter((u) => IDLE.has(u.status)).length
  const site = activeLocation?.name
  return site
    ? t('unitsUi.eyebrowSite', { stocked: data.totals.stocked, idle, site })
    : t('unitsUi.eyebrow', { stocked: data.totals.stocked, idle })
}
