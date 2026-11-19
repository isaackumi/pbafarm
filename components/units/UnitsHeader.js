import { Plus, QrCode } from 'lucide-react'
import { GradientButton } from '../ui'
import { usePermissions } from '../../hooks/usePermission'
import { useT } from '../../lib/i18n/context'

const IDLE = new Set(['fallow', 'empty', 'harvested'])

/** Header actions shared by the board, table, map and groups views (Paper 02). */
export function UnitsHeaderActions() {
  const t = useT()
  const { can } = usePermissions()
  return (
    <>
      {can('production.units.manage') && (
        <GradientButton href="/create-cage" icon={Plus}>
          {t('unitsUi.newCage')}
        </GradientButton>
      )}
      <GradientButton href="/cages/qr-codes" reverse icon={QrCode}>
        {t('unitsUi.qrCodes')}
      </GradientButton>
    </>
  )
}

/** Eyebrow for the cage views from api.units.board: "38 stocked · 6 fallow · 44 units". */
export function useUnitsEyebrow(data) {
  const t = useT()
  if (!data) return undefined
  const idle = data.sections.flatMap((s) => s.units).filter((u) => IDLE.has(u.status)).length
  return t('unitsUi.eyebrow', { stocked: data.totals.stocked, idle, units: data.totals.units })
}
