import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import FieldsBuilder from '../components/customization/FieldsBuilder'
import TerminologyEditor from '../components/customization/TerminologyEditor'
import FormLayoutEditor from '../components/customization/FormLayoutEditor'
import DashboardLayoutEditor from '../components/customization/DashboardLayoutEditor'
import { LineTabs, RouteGate, SettingsCard, useSettingsEyebrow } from '../components/settings'
import { usePermission } from '../hooks/usePermission'
import { SKY_TEXT } from '../components/paperTones'
import { useT } from '../lib/i18n/context'

/** Settings → Customization (D-007, Paper 32): one place for the organization's configuration. */
const TAB_IDS = ['forms', 'fields', 'words', 'dashboard']

export default function CustomizationPage() {
  return (
    <ProtectedRoute>
      <Customization />
    </ProtectedRoute>
  )
}

function Customization() {
  const router = useRouter()
  const t = useT()
  const eyebrow = useSettingsEyebrow(t('settingsUi.custom.crumb'))
  const tabs = TAB_IDS.map((value) => ({ value, label: t(`settingsUi.custom.tab.${value}`) }))
  const canManage = usePermission('customization.manage')
  const [tab, setTab] = useState('forms')
  useEffect(() => {
    const q = router.query.tab
    if (typeof q === 'string' && TAB_IDS.includes(q)) setTab(q)
  }, [router.query.tab])
  const choose = (id) => {
    setTab(id)
    router.replace({ pathname: router.pathname, query: { tab: id } }, undefined, { shallow: true })
  }

  return (
    <Layout title={t('settingsUi.custom.title')} eyebrow={eyebrow}>
      <div className="flex flex-col gap-7" data-tour="page-customization">
        <p className="text-[14px] leading-[18px] text-muted">
          {t('settingsUi.custom.description')}{' '}
          <RouteGate href="/company-settings">
            <Link href="/company-settings" className={`${SKY_TEXT} underline-offset-2 hover:underline`}>
              {t('settingsUi.nav.company')}
            </Link>
          </RouteGate>
        </p>
        {!canManage ? (
          <SettingsCard title={t('settingsUi.custom.deniedTitle')} className="max-w-xl">
            <p className="text-[13px] leading-4 text-muted">{t('settingsUi.custom.deniedBody')}</p>
          </SettingsCard>
        ) : (
          <>
            <LineTabs label={t('settingsUi.custom.title')} tabs={tabs} value={tab} onChange={choose} />
            <div role="tabpanel" aria-label={tabs.find((x) => x.value === tab)?.label}>
              {tab === 'fields' && <FieldsBuilder />}
              {tab === 'words' && <TerminologyEditor />}
              {tab === 'forms' && <FormLayoutEditor />}
              {tab === 'dashboard' && <DashboardLayoutEditor />}
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
