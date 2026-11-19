import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import OutboxPanel from '../components/OutboxPanel'
import { SettingsCard } from '../components/settings'
import { useOnline } from '../hooks/useOutbox'
import { useT } from '../lib/i18n/context'

export default function OutboxPage() {
  return (
    <ProtectedRoute>
      <Outbox />
    </ProtectedRoute>
  )
}

/** Everything saved on this phone that has not reached the server yet (MOBILE-002, Paper 57). */
function Outbox() {
  const t = useT()
  const online = useOnline()
  return (
    <Layout title={t('settingsUi.outbox.title')} eyebrow={t('settingsUi.outbox.eyebrow')}>
      <div className="flex max-w-3xl flex-col gap-5">
        <p className="text-[14px] leading-[18px] text-muted">{t('settingsUi.outbox.description')}</p>
        <SettingsCard title={t('settingsUi.outbox.cardTitle')}>
          <OutboxPanel online={online} />
        </SettingsCard>
      </div>
    </Layout>
  )
}
