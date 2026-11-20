import { PenLine, Plus } from 'lucide-react'
import { GradientButton } from '../ui'
import { usePermission } from '../../hooks/usePermission'
import { useT } from '../../lib/i18n/context'

/**
 * Header actions on the inventory pages (Paper 51): "Receive stock" on a lime
 * fill and ring with a plus, "Start count" on the sky ring with a pen.
 */
export default function InventoryActions() {
  const t = useT()
  const canPurchase = usePermission('inventory.purchase.record')
  const canCount = usePermission('inventory.issue')
  return (
    <>
      {canPurchase && (
        <GradientButton variant="lime" href="/feed-purchases" icon={Plus}>
          {t('ops.inventory.receive')}
        </GradientButton>
      )}
      {canCount && (
        <GradientButton ring="sky" href="/inventory/counts" icon={PenLine}>
          {t('ops.inventory.startCount')}
        </GradientButton>
      )}
    </>
  )
}
