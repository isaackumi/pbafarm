import { ClipboardList, PackagePlus } from 'lucide-react'
import { GradientButton } from '../ui'
import { usePermission } from '../../hooks/usePermission'
import { useT } from '../../lib/i18n/context'

/** Header actions on the inventory pages (Paper 51): receive stock, start a count. */
export default function InventoryActions() {
  const t = useT()
  const canPurchase = usePermission('inventory.purchase.record')
  const canCount = usePermission('inventory.issue')
  return (
    <>
      {canPurchase && (
        <GradientButton href="/feed-purchases" icon={PackagePlus}>
          {t('ops.inventory.receive')}
        </GradientButton>
      )}
      {canCount && (
        <GradientButton reverse href="/inventory/counts" icon={ClipboardList}>
          {t('ops.inventory.startCount')}
        </GradientButton>
      )}
    </>
  )
}
