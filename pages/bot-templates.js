import { Send } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GradientButton } from '../components/ui'
import { SettingsFrame } from '../components/settings'
import { LIME_BUTTON } from '../components/paperTones'
import BotTemplates, { useBotTemplates } from '../components/messaging/BotTemplates'
import { useT } from '../lib/i18n/context'

/** Settings › Messaging › Telegram › Bot templates (Paper T2b, VQL-1). */
export default function BotTemplatesPage() {
  return (
    <ProtectedRoute permission="production.daily.record">
      <Page />
    </ProtectedRoute>
  )
}

function Page() {
  const t = useT()
  const state = useBotTemplates()
  return (
    <Layout
      title={t('botTemplates.title')}
      eyebrow={t('botTemplates.eyebrow')}
      actions={
        <GradientButton variant="lime" className={LIME_BUTTON} icon={Send} onClick={state.startNew}>
          {t('botTemplates.new')}
        </GradientButton>
      }
    >
      <SettingsFrame active="messaging">
        <BotTemplates state={state} />
      </SettingsFrame>
    </Layout>
  )
}
