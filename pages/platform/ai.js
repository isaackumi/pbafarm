import PlatformLayout from '../../components/platform/PlatformLayout'
import { AiHealthDetails } from '../../components/platform/AiHealth'
import { useT } from '../../lib/i18n/context'

/** AI health and budgets (AI protections, D-023). */
export default function PlatformAiPage() {
  const t = useT()
  return (
    <PlatformLayout title={t('platform.nav.ai')}>
      <AiHealthDetails />
    </PlatformLayout>
  )
}
